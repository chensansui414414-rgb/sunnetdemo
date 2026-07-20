"""基于光路与云层画布的霞光预测算法。"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Union


@dataclass(frozen=True)
class SunPosition:
    """太阳方位结果。"""

    altitude: float
    azimuth: float
    event_time: datetime


def clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    """限制数值范围，避免单个异常字段把评分拖到非物理区间。"""
    return max(lower, min(upper, value))


def calculate_sun_position(lat: float, lon: float, target_date: date, period: str = "evening") -> SunPosition:
    """计算日出或日落时刻和方位；优先 Astral，未安装时使用 NOAA 近似公式。"""
    try:
        from astral import LocationInfo  # type: ignore
        from astral.sun import azimuth, elevation, sun  # type: ignore

        tz = timezone(timedelta(hours=round(lon / 15)))
        city = LocationInfo("目标地点", "", str(tz), lat, lon)
        event = sun(city.observer, date=target_date, tzinfo=tz)["sunrise" if period == "morning" else "sunset"]
        return SunPosition(elevation(city.observer, event), azimuth(city.observer, event), event)
    except Exception:
        # NOAA 日落时角近似，足够支撑离线 MVP 的方向判断。
        day_no = target_date.timetuple().tm_yday
        decl = math.radians(23.44 * math.sin(math.radians((360 / 365) * (day_no - 81))))
        lat_r = math.radians(max(-66, min(66, lat)))
        hour_angle = math.acos(max(-1, min(1, -math.tan(lat_r) * math.tan(decl))))
        signed_hour_angle = -hour_angle if period == "morning" else hour_angle
        azimuth_r = math.atan2(math.sin(signed_hour_angle), math.cos(signed_hour_angle) * math.sin(lat_r) - math.tan(decl) * math.cos(lat_r))
        azimuth_deg = (math.degrees(azimuth_r) + 180) % 360
        utc_hour = 12 + math.degrees(signed_hour_angle) / 15 - lon / 15
        event = datetime.combine(target_date, time.min, timezone.utc) + timedelta(hours=utc_hour)
        return SunPosition(-0.833, azimuth_deg, event)


def check_cloud_optical_depth(cloud_water: float, cloud_ice: float) -> dict[str, Union[float, str]]:
    """以液态水/冰水路径估计云光学厚度，薄而可上色的高云最优。"""
    optical_depth = max(0.0, 0.10 * cloud_water + 0.055 * cloud_ice)
    # 目标光学厚度约 3.8；过薄无画布、过厚不透光，采用对数高斯响应。
    quality = math.exp(-((math.log1p(optical_depth) - math.log1p(3.8)) ** 2) / 0.72)
    label = "薄云透光" if 1.2 <= optical_depth <= 7 else ("云层偏厚" if optical_depth > 7 else "云层偏薄")
    return {"optical_depth": round(optical_depth, 2), "quality": round(quality, 3), "label": label}


def _rh_cloud_probability(rh: float) -> float:
    """把压力层相对湿度转换成云存在概率；高湿层不等于云，但可作为GRIB剖面代理。"""
    # 78%以下通常不认为形成连续云层，96%以上按近似饱和云层处理。
    return clamp((rh - 78) / 18)


def extract_profile_features(profile: dict[str, Any]) -> dict[str, Any]:
    """从GFS/ECMWF太阳方向压力层剖面提取可进入主评分的物理特征。

    剖面数据本身只有等压面温度、湿度和高度，没有直接给出逐公里云量。
    因此这里使用相对湿度作为云层代理：
    - 0—2.5km 的高湿层视为低云/雾墙遮挡；
    - 2.5—6km 视为中云画布；
    - 6—12km 视为高云画布；
    - GFS 与 ECMWF 湿度差决定模型一致性置信度。
    """
    if not profile.get("available") or not profile.get("points"):
        return {
            "available": False,
            "profile_used": False,
            "reason": profile.get("reason") or profile.get("warning") or "压力层剖面不可用",
        }

    low_blocks: list[float] = []
    mid_clouds: list[float] = []
    high_clouds: list[float] = []
    cloud_base_candidates: list[float] = []

    for point in profile.get("points", []):
        low_at_point = 0.0
        mid_at_point = 0.0
        high_at_point = 0.0
        for layer in point.get("layers", []):
            height = float(layer.get("height_m", 0.0))
            rh = float(layer.get("rh", 0.0))
            cloud_probability = _rh_cloud_probability(rh)
            if cloud_probability <= 0:
                continue
            if height <= 2500:
                low_at_point = max(low_at_point, cloud_probability)
            elif height <= 6000:
                mid_at_point = max(mid_at_point, cloud_probability)
                cloud_base_candidates.append(height)
            elif height <= 12000:
                high_at_point = max(high_at_point, cloud_probability)
                cloud_base_candidates.append(height)
        low_blocks.append(low_at_point)
        mid_clouds.append(mid_at_point)
        high_clouds.append(high_at_point)

    # 太阳光路最怕“远端低云墙”，所以不用普通平均，而用最大值和前三高值共同约束。
    remote_low = low_blocks[1:] or low_blocks
    top_low = sorted(remote_low, reverse=True)[:3]
    profile_low_obstruction = clamp(0.58 * max(remote_low, default=0.0) + 0.42 * (sum(top_low) / max(1, len(top_low))))
    profile_light_transmission = math.exp(-2.25 * profile_low_obstruction ** 1.22)

    high_cover = clamp(sum(high_clouds) / max(1, len(high_clouds))) * 100
    mid_cover = clamp(sum(mid_clouds) / max(1, len(mid_clouds))) * 100
    canvas_cover = 0.72 * high_cover + 0.28 * mid_cover
    # 中高层画布仍以30%—70%最佳，过满会挡光，过少没有可上色云。
    cover_quality = math.exp(-(((canvas_cover / 100) - 0.50) ** 2) / 0.075)
    high_cloud_bonus = 0.72 + 0.28 * clamp(high_cover / 55)
    profile_canvas_quality = clamp(cover_quality * high_cloud_bonus)

    mean_delta = (profile.get("comparison") or {}).get("mean_rh_difference")
    if mean_delta is None:
        confidence = 0.90
    elif mean_delta <= 12:
        confidence = 1.0
    elif mean_delta <= 25:
        confidence = 1.0 - (mean_delta - 12) / 13 * 0.08
    else:
        confidence = 0.82

    cloud_base = min(cloud_base_candidates) if cloud_base_candidates else None
    return {
        "available": True,
        "profile_used": True,
        "profile_low_obstruction": round(profile_low_obstruction, 3),
        "profile_light_transmission": round(clamp(profile_light_transmission), 3),
        "profile_canvas_quality": round(profile_canvas_quality, 3),
        "profile_high_cloud_cover": round(high_cover, 1),
        "profile_mid_cloud_cover": round(mid_cover, 1),
        "profile_canvas_cover": round(canvas_cover, 1),
        "profile_cloud_base_m": round(cloud_base) if cloud_base else None,
        "profile_confidence": round(confidence, 3),
        "profile_primary_model": profile.get("primary_model"),
        "profile_run_time": profile.get("run_time"),
        "profile_forecast_hour": profile.get("forecast_hour"),
        "profile_model_agreement": (profile.get("comparison") or {}).get("agreement", "未知"),
    }


def calculate_obstruction(sun_azimuth: float, cloud_cover_data: dict[str, float]) -> dict[str, Union[float, str]]:
    """计算太阳方向低云遮挡；按太阳方位自动选择东向或西向扇区。"""
    is_east = sun_azimuth < 180
    sector = "east_low_cloud_cover" if is_east else "west_low_cloud_cover"
    low = max(0.0, min(100.0, cloud_cover_data.get(sector, cloud_cover_data.get("low_cloud_cover", 0))))
    # 霞光失败常来自窗口内短时低云或远端云墙，不只看日落/日出那个整点。
    corridor_low = max(low, cloud_cover_data.get("corridor_low_cloud_max", low))
    local_low = max(cloud_cover_data.get("low_cloud_cover", 0), cloud_cover_data.get("local_low_cloud_max", 0))
    effective_low = max(0.68 * corridor_low + 0.32 * local_low, corridor_low * 0.86)
    visibility = max(0.1, cloud_cover_data.get("visibility_km", 10))
    aod = max(0.0, cloud_cover_data.get("aod", 0.15))
    precipitation = max(0.0, cloud_cover_data.get("precipitation_mm", 0.0))
    precipitation_probability = max(0.0, cloud_cover_data.get("precipitation_probability", 0.0))
    low_transmission = math.exp(-2.05 * (effective_low / 100) ** 1.30)
    haze_transmission = math.exp(-0.72 * aod) * clamp(visibility / 12)
    rain_transmission = math.exp(-0.58 * precipitation) * (1 - 0.34 * (precipitation_probability / 100) ** 1.25)
    open_meteo_transmission = clamp(low_transmission * haze_transmission * rain_transmission)
    profile_features = cloud_cover_data.get("profile_features") or {}
    if profile_features.get("profile_used"):
        profile_transmission = float(profile_features.get("profile_light_transmission", open_meteo_transmission))
        transmission = clamp(0.45 * open_meteo_transmission + 0.55 * profile_transmission)
    else:
        transmission = open_meteo_transmission
    return {
        "transmission": round(transmission, 3),
        "open_meteo_transmission": round(open_meteo_transmission, 3),
        "obstruction": round((1 - transmission) * 100, 1),
        "direction": ("东北" if sun_azimuth < 90 else "东南") if is_east else ("西北" if sun_azimuth >= 270 else "西南"),
        "label": "光路通透" if transmission >= 0.62 else ("光路一般" if transmission >= 0.38 else "光路受阻"),
        "effective_low_cloud": round(effective_low, 1),
    }


def predict_day(raw: dict[str, Any], lat: float, lon: float, period: str = "evening") -> dict[str, Any]:
    """执行单日物理预测。评分使用几何门控相乘，而非简单加权平均。"""
    # 真实接口分别在日出和日落时刻采样；旧缓存与 Mock 仍兼容扁平结构。
    raw = {**raw, **raw.get("periods", {}).get(period, {})}
    target_date = date.fromisoformat(raw["date"])
    sun = calculate_sun_position(lat, lon, target_date, period)
    optical = check_cloud_optical_depth(raw["cloud_water_gm2"], raw["cloud_ice_gm2"])
    obstruction = calculate_obstruction(sun.azimuth, raw)

    high = raw["high_cloud_cover"] / 100
    mid = raw["mid_cloud_cover"] / 100
    # 画布云量在 30%—70% 为平台峰值，并由云底高度作为物理门槛。
    canvas_cover = 0.72 * high + 0.28 * mid
    window_canvas_cover = raw.get("canvas_cover_window", canvas_cover * 100) / 100
    canvas_variability = raw.get("canvas_variability", 0.0)
    # 当前时刻与前后窗口同时满足，才认为云画布稳定；能过滤“刚好一个整点好看”的假高分。
    event_cover_quality = math.exp(-((canvas_cover - 0.50) ** 2) / 0.075)
    window_cover_quality = math.exp(-((window_canvas_cover - 0.50) ** 2) / 0.075)
    cover_quality = 0.62 * event_cover_quality + 0.38 * window_cover_quality
    stability_gate = clamp(1 - (canvas_variability / 85), 0.58, 1.0)
    height_gate = 1 / (1 + math.exp(-(raw["cloud_base_m"] - 5000) / 700))
    local_low = max(raw.get("low_cloud_cover", 0), raw.get("local_low_cloud_max", 0)) / 100
    local_low_gate = math.exp(-0.70 * local_low ** 1.25)
    open_meteo_canvas = cover_quality * float(optical["quality"]) * (0.42 + 0.58 * height_gate) * stability_gate * local_low_gate
    profile_features = raw.get("profile_features") or {}
    if profile_features.get("profile_used"):
        profile_canvas = float(profile_features.get("profile_canvas_quality", open_meteo_canvas)) * stability_gate * local_low_gate
        canvas = clamp(0.45 * open_meteo_canvas + 0.55 * profile_canvas)
    else:
        profile_canvas = None
        canvas = open_meteo_canvas
    transmission = float(obstruction["transmission"])
    # 只有“光路”和“画布”同时成立才能高分；平方根保留中等条件的分辨率。
    physical_potential = math.sqrt(max(0.0, transmission * canvas))
    color_factor = math.exp(-((raw["aod"] - 0.16) ** 2) / 0.045)
    solar_supply = raw.get("solar_supply_radiation", raw.get("direct_radiation", 0))
    solar_gate = clamp(0.72 + 0.28 * clamp(solar_supply / 120))
    precipitation_gate = math.exp(-0.42 * max(0.0, raw.get("precipitation_mm", 0.0)))
    profile_confidence = float(profile_features.get("profile_confidence", 1.0)) if profile_features.get("profile_used") else 1.0
    score = round(100 * physical_potential * (0.82 + 0.18 * color_factor) * solar_gate * precipitation_gate * profile_confidence)
    score = max(0, min(100, score))
    level = "大烧" if score >= 72 else ("小烧" if score >= 45 else "无烧")
    advice = "值得一蹲！" if score >= 72 else ("有机会，路过可等等。" if score >= 45 else "条件普通，建议轻装观察。")
    event_name = "日出" if period == "morning" else "日落"
    extra_flags = []
    if raw.get("corridor_low_cloud_max", 0) >= 55:
        extra_flags.append("光路窗口内有低云风险")
    if canvas_variability >= 35:
        extra_flags.append("云量变化较快")
    if raw.get("precipitation_probability", 0) >= 45:
        extra_flags.append("降水概率偏高")
    if profile_features.get("profile_used"):
        if profile_features.get("profile_low_obstruction", 0) >= 0.55:
            extra_flags.append("GFS/ECMWF剖面显示远端低层湿区")
        if profile_features.get("profile_model_agreement") == "低":
            extra_flags.append("GFS与ECMWF分歧较大")
    risk_text = f"；{'、'.join(extra_flags)}" if extra_flags else ""
    profile_text = (
        f"；剖面高云约{profile_features.get('profile_high_cloud_cover')}%，模型一致性{profile_features.get('profile_model_agreement')}"
        if profile_features.get("profile_used") else ""
    )
    explanation = f"{event_name}{obstruction['direction']}方向{obstruction['label']}；本地高云画布{round(canvas_cover * 100)}%，{optical['label']}{profile_text}{risk_text}。结论：{advice}"
    return {
        "date": raw["date"],
        "score": score,
        "level": level,
        "summary": explanation,
        "event_time": sun.event_time.isoformat(),
        "sunset": sun.event_time.isoformat(),
        "sun_azimuth": round(sun.azimuth, 1),
        "period": period,
        "metrics": {
            "high_cloud": raw["high_cloud_cover"],
            "mid_cloud": raw["mid_cloud_cover"],
            "low_cloud": raw["low_cloud_cover"],
            "visibility": raw["visibility_km"],
            "aod": raw["aod"],
            "pm2_5": raw.get("pm2_5"),
            "direct_radiation": raw.get("direct_radiation"),
            "corridor_low_cloud": raw.get("east_low_cloud_cover" if period == "morning" else "west_low_cloud_cover", raw["low_cloud_cover"]),
            "effective_low_cloud": obstruction["effective_low_cloud"],
            "corridor_low_cloud_max": raw.get("corridor_low_cloud_max"),
            "local_low_cloud_max": raw.get("local_low_cloud_max"),
            "canvas_cover_window": raw.get("canvas_cover_window"),
            "canvas_variability": raw.get("canvas_variability"),
            "precipitation_mm": raw.get("precipitation_mm"),
            "precipitation_probability": raw.get("precipitation_probability"),
            "solar_supply_radiation": raw.get("solar_supply_radiation"),
            "cloud_base": raw["cloud_base_m"],
            "optical_depth": optical["optical_depth"],
            "light_channel": round(transmission * 100),
            "open_meteo_light_channel": round(float(obstruction["open_meteo_transmission"]) * 100),
            "profile_used": bool(profile_features.get("profile_used")),
            "profile_available": bool(profile_features.get("available")),
            "profile_reason": profile_features.get("reason"),
            "profile_light_channel": round(float(profile_features.get("profile_light_transmission", 0)) * 100) if profile_features.get("profile_used") else None,
            "profile_low_obstruction": profile_features.get("profile_low_obstruction"),
            "profile_canvas_quality": round(float(profile_canvas) * 100) if profile_canvas is not None else None,
            "profile_high_cloud": profile_features.get("profile_high_cloud_cover"),
            "profile_mid_cloud": profile_features.get("profile_mid_cloud_cover"),
            "profile_canvas_cover": profile_features.get("profile_canvas_cover"),
            "profile_confidence": round(profile_confidence * 100),
            "profile_primary_model": profile_features.get("profile_primary_model"),
            "profile_model_agreement": profile_features.get("profile_model_agreement"),
            "stability_gate": round(stability_gate * 100),
            "solar_gate": round(solar_gate * 100),
        },
        "source": raw.get("source", "unknown"),
        "source_label": raw.get("source_label", raw.get("source", "未知数据源")),
        "fetched_at": raw.get("fetched_at"),
        "is_stale": raw.get("is_stale", False),
    }


def predict_three_days(rows: list[dict[str, Any]], lat: float, lon: float, period: str = "evening") -> list[dict[str, Any]]:
    """生成未来三天结果。"""
    return [predict_day(row, lat, lon, period) for row in rows]
