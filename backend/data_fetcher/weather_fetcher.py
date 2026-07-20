"""气象数据获取器：默认接入 Open-Meteo，失败时使用缓存或确定性 Mock。"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional, Union
from urllib.parse import urlencode
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)
WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"


class RealDataUnavailableError(RuntimeError):
    """严格真实数据模式下，真实数据与真实缓存都不可用。"""


class WeatherDataFetcher:
    """获取并标准化真实天气数据；不依赖 requests 等第三方网络库。"""

    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def fetch_three_days(self, lat: float, lon: float) -> list[dict[str, Any]]:
        """优先读取三小时内缓存，否则请求真实数据；异常时安全降级。"""
        cache_file = self.cache_dir / f"openmeteo_v2_{lat:.2f}_{lon:.2f}_{date.today().isoformat()}.json"
        cached = self._read_cache(cache_file)
        strict_real_data = os.getenv("STRICT_REAL_DATA", "0") == "1"
        if cached and datetime.now().timestamp() - cache_file.stat().st_mtime < 3 * 3600:
            return cached

        if os.getenv("USE_OPEN_METEO", "1") != "0":
            try:
                rows = self._fetch_open_meteo(lat, lon)
                cache_file.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
                return rows
            except Exception as exc:  # 网络、字段变更和上游限流都不能拖垮接口
                logger.warning("Open-Meteo 获取失败：%s", exc)

        if cached:
            logger.warning("使用过期真实数据缓存。")
            for row in cached:
                row["is_stale"] = True
            return cached
        if strict_real_data:
            raise RealDataUnavailableError("严格真实数据模式已开启，但实时天气接口和本地真实缓存均不可用。")
        logger.warning("真实数据和缓存均不可用，使用确定性模拟数据。")
        return self._build_mock_data(lat, lon)

    @staticmethod
    def _read_cache(path: Path) -> Optional[list[dict[str, Any]]]:
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            return payload if isinstance(payload, list) else None
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("缓存读取失败：%s", exc)
            return None

    @staticmethod
    def _get_json(url: str, params: dict[str, Union[str, int, float]]) -> Any:
        request = Request(f"{url}?{urlencode(params)}", headers={"User-Agent": "XiaGuangForecast/1.0"})
        with urlopen(request, timeout=15) as response:  # noqa: S310 - 地址为代码内固定 HTTPS 域名
            return json.loads(response.read().decode("utf-8"))

    def _fetch_open_meteo(self, lat: float, lon: float) -> list[dict[str, Any]]:
        """获取本地以及东西光路扇区的云况，并叠加 CAMS 全球 AOD。"""
        # 东西各约 150 km 的采样点用于近似霞光入射通道，不把本地低云误当成远端遮挡。
        lon_delta = 1.35 / max(0.35, math.cos(math.radians(lat)))
        coordinates_lat = f"{lat:.4f},{lat:.4f},{lat:.4f}"
        east_lon = (lon + lon_delta + 180) % 360 - 180
        west_lon = (lon - lon_delta + 180) % 360 - 180
        coordinates_lon = f"{lon:.4f},{east_lon:.4f},{west_lon:.4f}"
        weather = self._get_json(WEATHER_URL, {
            "latitude": coordinates_lat,
            "longitude": coordinates_lon,
            "hourly": "cloud_cover_low,cloud_cover_mid,cloud_cover_high,visibility,direct_radiation,temperature_2m,dew_point_2m,precipitation,precipitation_probability",
            "daily": "sunrise,sunset",
            "timezone": "auto",
            "forecast_days": 3,
        })
        if not isinstance(weather, list) or len(weather) != 3:
            raise ValueError("天气接口未返回三个空间采样点")
        local, east, west = weather
        air = self._get_json(AIR_URL, {
            "latitude": round(lat, 4), "longitude": round(lon, 4),
            "hourly": "aerosol_optical_depth,pm2_5",
            "domains": "cams_global", "timezone": "auto", "forecast_days": 3,
        })
        fetched_at = datetime.now(timezone.utc).isoformat()
        rows: list[dict[str, Any]] = []
        for day_index, day_text in enumerate(local["daily"]["time"][:3]):
            periods: dict[str, dict[str, float]] = {}
            for period, event_key, corridor in (("morning", "sunrise", east), ("evening", "sunset", west)):
                event_time = local["daily"][event_key][day_index]
                local_index = self._nearest_time_index(local["hourly"]["time"], event_time)
                corridor_index = self._nearest_time_index(corridor["hourly"]["time"], event_time)
                air_index = self._nearest_time_index(air["hourly"]["time"], event_time)
                window_indices = self._time_window_indices(local["hourly"]["time"], event_time, hours=1.5)
                corridor_window_indices = self._time_window_indices(corridor["hourly"]["time"], event_time, hours=1.5)
                supply_index = self._shifted_time_index(
                    local["hourly"]["time"],
                    event_time,
                    hours=1 if period == "morning" else -1,
                )
                high = self._number(local["hourly"]["cloud_cover_high"][local_index])
                mid = self._number(local["hourly"]["cloud_cover_mid"][local_index])
                low = self._number(local["hourly"]["cloud_cover_low"][local_index])
                high_window = [self._number(local["hourly"]["cloud_cover_high"][index]) for index in window_indices]
                mid_window = [self._number(local["hourly"]["cloud_cover_mid"][index]) for index in window_indices]
                low_window = [self._number(local["hourly"]["cloud_cover_low"][index]) for index in window_indices]
                corridor_low_window = [self._number(corridor["hourly"]["cloud_cover_low"][index]) for index in corridor_window_indices]
                canvas_window = [0.72 * high_window[index] + 0.28 * mid_window[index] for index in range(len(window_indices))]
                temperature = self._number(local["hourly"]["temperature_2m"][local_index], 20)
                dew_point = self._number(local["hourly"]["dew_point_2m"][local_index], temperature - 5)
                lcl = max(200.0, 125.0 * max(0.0, temperature - dew_point))
                canvas_height = (high * 9000 + mid * 5500) / max(1.0, high + mid)
                periods[period] = {
                    "high_cloud_cover": high,
                    "mid_cloud_cover": mid,
                    "low_cloud_cover": low,
                    "cloud_base_m": round(max(lcl, canvas_height)),
                    # Open-Meteo 不直接提供云水路径；这里以模式分层云量构造透明的物理代理值。
                    "cloud_water_gm2": round(mid * 0.35, 2),
                    "cloud_ice_gm2": round(high * 0.55, 2),
                    "visibility_km": round(self._number(local["hourly"]["visibility"][local_index], 10000) / 1000, 1),
                    "aod": round(self._number(air["hourly"]["aerosol_optical_depth"][air_index], 0.15), 3),
                    "pm2_5": round(self._number(air["hourly"]["pm2_5"][air_index]), 1),
                    "direct_radiation": self._number(local["hourly"]["direct_radiation"][local_index]),
                    "solar_supply_radiation": self._number(local["hourly"]["direct_radiation"][supply_index]),
                    "precipitation_mm": round(max(self._hourly_number(local, "precipitation", index) for index in window_indices), 2),
                    "precipitation_probability": round(max(self._hourly_number(local, "precipitation_probability", index) for index in window_indices), 1),
                    "local_low_cloud_max": round(max(low_window), 1),
                    "corridor_low_cloud_max": round(max(corridor_low_window), 1),
                    "canvas_cover_window": round(sum(canvas_window) / max(1, len(canvas_window)), 1),
                    "canvas_variability": round(self._spread(canvas_window), 1),
                    "east_low_cloud_cover": self._number(east["hourly"]["cloud_cover_low"][corridor_index]),
                    "west_low_cloud_cover": self._number(west["hourly"]["cloud_cover_low"][corridor_index]),
                }
            rows.append({
                "date": day_text,
                "source": "open-meteo:best-match+cams-global",
                "source_label": "Open-Meteo / CAMS 实时预报",
                "fetched_at": fetched_at,
                "timezone": local.get("timezone", "auto"),
                "is_stale": False,
                "periods": periods,
            })
        if len(rows) != 3:
            raise ValueError("真实接口返回天数不足")
        return rows

    @staticmethod
    def _nearest_time_index(times: list[str], target: str) -> int:
        target_dt = datetime.fromisoformat(target)
        return min(range(len(times)), key=lambda index: abs((datetime.fromisoformat(times[index]) - target_dt).total_seconds()))

    @staticmethod
    def _time_window_indices(times: list[str], target: str, hours: float) -> list[int]:
        """返回目标时刻前后若干小时的小时级索引，用于减少单点采样误差。"""
        target_dt = datetime.fromisoformat(target)
        window = [
            index for index, value in enumerate(times)
            if abs((datetime.fromisoformat(value) - target_dt).total_seconds()) <= hours * 3600
        ]
        return window or [WeatherDataFetcher._nearest_time_index(times, target)]

    @staticmethod
    def _shifted_time_index(times: list[str], target: str, hours: float) -> int:
        """取日出后或日落前的供光时刻，避免直接用太阳刚贴地时的低辐射值。"""
        shifted = datetime.fromisoformat(target) + timedelta(hours=hours)
        return min(range(len(times)), key=lambda index: abs((datetime.fromisoformat(times[index]) - shifted).total_seconds()))

    @staticmethod
    def _number(value: Any, default: float = 0.0) -> float:
        return float(value) if value is not None else default

    @classmethod
    def _hourly_number(cls, payload: dict[str, Any], key: str, index: int, default: float = 0.0) -> float:
        """安全读取小时字段；上游临时缺字段时不让整个预报崩溃。"""
        values = payload.get("hourly", {}).get(key, [])
        if not isinstance(values, list) or index >= len(values):
            return default
        return cls._number(values[index], default)

    @staticmethod
    def _spread(values: list[float]) -> float:
        """简单极差，表达日出/日落窗口内云量是否剧烈变化。"""
        return max(values) - min(values) if values else 0.0

    @staticmethod
    def _build_mock_data(lat: float, lon: float) -> list[dict[str, Any]]:
        """按经纬度与日期生成确定性数据；不使用随机数。"""
        rows: list[dict[str, Any]] = []
        for offset in range(3):
            day = date.today() + timedelta(days=offset)
            digest = hashlib.sha256(f"{lat:.3f}|{lon:.3f}|{day.isoformat()}".encode()).digest()
            unit = [value / 255 for value in digest[:12]]
            base = {
                "high_cloud_cover": round(25 + unit[0] * 58, 1), "mid_cloud_cover": round(10 + unit[2] * 52, 1),
                "low_cloud_cover": round(unit[1] * 52, 1), "cloud_base_m": round(4200 + unit[3] * 5200),
                "cloud_water_gm2": round(10 + unit[4] * 80, 1), "cloud_ice_gm2": round(4 + unit[5] * 48, 1),
                "visibility_km": round(7 + unit[6] * 24, 1), "aod": round(0.04 + unit[7] * 0.42, 3),
                "west_low_cloud_cover": round(unit[8] * 72, 1), "east_low_cloud_cover": round(unit[10] * 72, 1),
            }
            rows.append({"date": day.isoformat(), "source": "mock-physics", "source_label": "确定性模拟数据", "fetched_at": datetime.now(timezone.utc).isoformat(), "is_stale": False, **base})
        return rows
