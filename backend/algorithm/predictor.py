"""基于光路与云层画布的霞光预测算法。"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any


@dataclass(frozen=True)
class SunPosition:
    """太阳方位结果。"""

    altitude: float
    azimuth: float
    event_time: datetime


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


def check_cloud_optical_depth(cloud_water: float, cloud_ice: float) -> dict[str, float | str]:
    """以液态水/冰水路径估计云光学厚度，薄而可上色的高云最优。"""
    optical_depth = max(0.0, 0.10 * cloud_water + 0.055 * cloud_ice)
    # 目标光学厚度约 3.8；过薄无画布、过厚不透光，采用对数高斯响应。
    quality = math.exp(-((math.log1p(optical_depth) - math.log1p(3.8)) ** 2) / 0.72)
    label = "薄云透光" if 1.2 <= optical_depth <= 7 else ("云层偏厚" if optical_depth > 7 else "云层偏薄")
    return {"optical_depth": round(optical_depth, 2), "quality": round(quality, 3), "label": label}


def calculate_obstruction(sun_azimuth: float, cloud_cover_data: dict[str, float]) -> dict[str, float | str]:
    """计算太阳方向低云遮挡；按太阳方位自动选择东向或西向扇区。"""
    is_east = sun_azimuth < 180
    sector = "east_low_cloud_cover" if is_east else "west_low_cloud_cover"
    low = max(0.0, min(100.0, cloud_cover_data.get(sector, cloud_cover_data.get("low_cloud_cover", 0))))
    visibility = max(0.1, cloud_cover_data.get("visibility_km", 10))
    aod = max(0.0, cloud_cover_data.get("aod", 0.15))
    low_transmission = math.exp(-1.7 * (low / 100) ** 1.35)
    haze_transmission = math.exp(-0.75 * aod) * min(1.0, visibility / 12)
    transmission = max(0.0, min(1.0, low_transmission * haze_transmission))
    return {
        "transmission": round(transmission, 3),
        "obstruction": round((1 - transmission) * 100, 1),
        "direction": ("东北" if sun_azimuth < 90 else "东南") if is_east else ("西北" if sun_azimuth >= 270 else "西南"),
        "label": "光路通透" if transmission >= 0.62 else ("光路一般" if transmission >= 0.38 else "光路受阻"),
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
    cover_quality = math.exp(-((canvas_cover - 0.50) ** 2) / 0.075)
    height_gate = 1 / (1 + math.exp(-(raw["cloud_base_m"] - 5000) / 700))
    canvas = cover_quality * float(optical["quality"]) * (0.42 + 0.58 * height_gate)
    transmission = float(obstruction["transmission"])
    # 只有“光路”和“画布”同时成立才能高分；平方根保留中等条件的分辨率。
    physical_potential = math.sqrt(max(0.0, transmission * canvas))
    color_factor = math.exp(-((raw["aod"] - 0.16) ** 2) / 0.045)
    score = round(100 * physical_potential * (0.82 + 0.18 * color_factor))
    score = max(0, min(100, score))
    level = "大烧" if score >= 72 else ("小烧" if score >= 45 else "无烧")
    advice = "值得一蹲！" if score >= 72 else ("有机会，路过可等等。" if score >= 45 else "条件普通，建议轻装观察。")
    event_name = "日出" if period == "morning" else "日落"
    explanation = f"{event_name}{obstruction['direction']}方向{obstruction['label']}；本地高云画布{round(canvas_cover * 100)}%，{optical['label']}。结论：{advice}"
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
            "cloud_base": raw["cloud_base_m"],
            "optical_depth": optical["optical_depth"],
            "light_channel": round(transmission * 100),
        },
        "source": raw.get("source", "unknown"),
        "source_label": raw.get("source_label", raw.get("source", "未知数据源")),
        "fetched_at": raw.get("fetched_at"),
        "is_stale": raw.get("is_stale", False),
    }


def predict_three_days(rows: list[dict[str, Any]], lat: float, lon: float, period: str = "evening") -> list[dict[str, Any]]:
    """生成未来三天结果。"""
    return [predict_day(row, lat, lon, period) for row in rows]
