"""GFS / ECMWF 压力层 GRIB 光路剖面。

该模块只在详情页显式请求时工作，避免首页因为大文件下载而阻塞。
"""

from __future__ import annotations

import json
import logging
import math
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlencode
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

PRESSURE_LEVELS = [1000, 925, 850, 700, 500, 300, 200]
PROFILE_DISTANCE_KM = 600
PROFILE_STEP_KM = 50
NOMADS_FILTER_URL = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"


def build_solar_corridor(lat: float, lon: float, azimuth: float, distance_km: int = PROFILE_DISTANCE_KM, step_km: int = PROFILE_STEP_KM) -> list[dict[str, float]]:
    """沿太阳方位角生成大圆路径采样点，默认 0—600 km、间隔 50 km。"""
    radius_km = 6371.0088
    lat1, lon1, bearing = map(math.radians, (lat, lon, azimuth))
    points: list[dict[str, float]] = []
    for distance in range(0, distance_km + 1, step_km):
        angular = distance / radius_km
        lat2 = math.asin(math.sin(lat1) * math.cos(angular) + math.cos(lat1) * math.sin(angular) * math.cos(bearing))
        lon2 = lon1 + math.atan2(math.sin(bearing) * math.sin(angular) * math.cos(lat1), math.cos(angular) - math.sin(lat1) * math.sin(lat2))
        points.append({"distance_km": float(distance), "lat": round(math.degrees(lat2), 5), "lon": round((math.degrees(lon2) + 540) % 360 - 180, 5)})
    return points


class PressureProfileFetcher:
    """按需下载压力层 GRIB，缓存 6 小时并输出统一的距离—高度结构。"""

    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def fetch(self, lat: float, lon: float, event_time: datetime, sun_azimuth: float) -> dict[str, Any]:
        corridor = build_solar_corridor(lat, lon, sun_azimuth)
        if os.getenv("ENABLE_GRIB_PROFILE", "0") != "1":
            return self._unavailable("压力层 GRIB 尚未启用；请设置 ENABLE_GRIB_PROFILE=1。", corridor)

        cache_file = self.cache_dir / f"profile_{lat:.2f}_{lon:.2f}_{event_time:%Y%m%d%H}_{sun_azimuth:.0f}.json"
        cached = self._read_fresh_json(cache_file)
        if cached:
            return cached

        errors: list[str] = []
        gfs = ecmwf = None
        try:
            gfs = self._fetch_gfs(corridor, event_time)
        except Exception as exc:
            errors.append(f"GFS：{exc}")
            logger.warning("GFS 压力层获取失败：%s", exc)
        try:
            ecmwf = self._fetch_ecmwf(corridor, event_time)
        except Exception as exc:
            errors.append(f"ECMWF：{exc}")
            logger.warning("ECMWF 压力层获取失败：%s", exc)

        primary = gfs or ecmwf
        if not primary:
            stale = self._read_json(cache_file)
            if stale:
                stale["is_stale"] = True
                stale["warning"] = "；".join(errors)
                return stale
            return self._unavailable("；".join(errors) or "压力层数据不可用", corridor)

        result = {
            "available": True,
            "is_stale": False,
            "distance_km": PROFILE_DISTANCE_KM,
            "step_km": PROFILE_STEP_KM,
            "levels_hpa": PRESSURE_LEVELS,
            "primary_model": primary["model"],
            "run_time": primary["run_time"],
            "forecast_hour": primary["forecast_hour"],
            "points": primary["points"],
            "comparison": self._compare_profiles(gfs, ecmwf),
            "models": {"gfs": self._model_metadata(gfs), "ecmwf": self._model_metadata(ecmwf)},
            "warning": "；".join(errors) if errors else "",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        cache_file.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        return result

    def _fetch_gfs(self, corridor: list[dict[str, float]], event_time: datetime) -> dict[str, Any]:
        run_time, forecast_hour = self._select_run(event_time, availability_delay_hours=5)
        target = self.cache_dir / f"gfs_{run_time:%Y%m%d%H}_f{forecast_hour:03d}_{corridor[0]['lat']:.2f}_{corridor[0]['lon']:.2f}.grib2"
        if not target.exists() or target.stat().st_size < 1024:
            self._download_gfs_subset(target, corridor, run_time, forecast_hour)
        return {"model": "GFS 0.25°", "run_time": run_time.isoformat(), "forecast_hour": forecast_hour, "points": self._parse_grib(target, corridor)}

    def _download_gfs_subset(self, target: Path, corridor: list[dict[str, float]], run_time: datetime, forecast_hour: int) -> None:
        lats = [point["lat"] for point in corridor]
        lons = [point["lon"] for point in corridor]
        if max(lons) - min(lons) > 180:
            raise ValueError("当前版本暂不支持跨越日期变更线的剖面")
        params: dict[str, str] = {
            "file": f"gfs.t{run_time:%H}z.pgrb2.0p25.f{forecast_hour:03d}",
            "dir": f"/gfs.{run_time:%Y%m%d}/{run_time:%H}/atmos",
            "subregion": "", "leftlon": f"{min(lons)-.5:.2f}", "rightlon": f"{max(lons)+.5:.2f}",
            "toplat": f"{min(90,max(lats)+.5):.2f}", "bottomlat": f"{max(-90,min(lats)-.5):.2f}",
        }
        for level in PRESSURE_LEVELS:
            params[f"lev_{level}_mb"] = "on"
        for variable in ("HGT", "RH", "TMP", "UGRD", "VGRD"):
            params[f"var_{variable}"] = "on"
        request = Request(f"{NOMADS_FILTER_URL}?{urlencode(params)}", headers={"User-Agent": "XiaGuangForecast/1.0"})
        with urlopen(request, timeout=90) as response:  # noqa: S310 - 固定 NOAA HTTPS 域名
            payload = response.read()
        if len(payload) < 1024 or payload[:4] != b"GRIB":
            raise RuntimeError("NOMADS 未返回有效 GRIB；模式时次可能尚未就绪")
        target.write_bytes(payload)

    def _fetch_ecmwf(self, corridor: list[dict[str, float]], event_time: datetime) -> dict[str, Any]:
        try:
            from ecmwf.opendata import Client  # type: ignore
        except ImportError as exc:
            raise RuntimeError("缺少 ecmwf-opendata") from exc
        run_time, forecast_hour = self._select_run(event_time, availability_delay_hours=8)
        target = self.cache_dir / f"ecmwf_{run_time:%Y%m%d%H}_f{forecast_hour:03d}.grib2"
        if not target.exists() or target.stat().st_size < 1024:
            client = Client(source=os.getenv("ECMWF_OPEN_DATA_SOURCE", "aws"))
            client.retrieve(
                date=run_time.strftime("%Y%m%d"), time=run_time.hour, step=forecast_hour,
                stream="oper", type="fc", levtype="pl", param=["gh", "r", "t", "u", "v"],
                levelist=PRESSURE_LEVELS, target=str(target),
            )
        return {"model": "ECMWF IFS Open Data 0.25°", "run_time": run_time.isoformat(), "forecast_hour": forecast_hour, "points": self._parse_grib(target, corridor)}

    @staticmethod
    def _select_run(event_time: datetime, availability_delay_hours: int) -> tuple[datetime, int]:
        event_utc = event_time.astimezone(timezone.utc) if event_time.tzinfo else event_time.replace(tzinfo=timezone.utc)
        available = datetime.now(timezone.utc) - timedelta(hours=availability_delay_hours)
        cycle_hour = available.hour // 6 * 6
        run = available.replace(hour=cycle_hour, minute=0, second=0, microsecond=0)
        forecast_hour = max(0, int(round((event_utc - run).total_seconds() / 10800) * 3))
        return run, min(120, forecast_hour)

    def _parse_grib(self, path: Path, corridor: list[dict[str, float]]) -> list[dict[str, Any]]:
        try:
            import cfgrib  # type: ignore
            import xarray as xr  # type: ignore
        except ImportError as exc:
            raise RuntimeError("缺少 cfgrib/xarray/eccodes") from exc
        datasets = cfgrib.open_datasets(str(path), backend_kwargs={"indexpath": ""})
        pressure_sets = [dataset for dataset in datasets if "isobaricInhPa" in dataset.coords or "isobaricInPa" in dataset.coords]
        if not pressure_sets:
            raise RuntimeError("GRIB 中没有可识别的等压面数据")
        dataset = xr.merge(pressure_sets, compat="override", join="outer")
        level_name = "isobaricInhPa" if "isobaricInhPa" in dataset.coords else "isobaricInPa"
        lat_name = "latitude" if "latitude" in dataset.coords else "lat"
        lon_name = "longitude" if "longitude" in dataset.coords else "lon"
        lon_min = float(dataset[lon_name].min())
        points: list[dict[str, Any]] = []
        for point in corridor:
            query_lon = point["lon"] % 360 if lon_min >= 0 else point["lon"]
            column = dataset.sel({lat_name: point["lat"], lon_name: query_lon}, method="nearest")
            layers = []
            for level in PRESSURE_LEVELS:
                level_key = level * 100 if level_name == "isobaricInPa" else level
                layer = column.sel({level_name: level_key}, method="nearest")
                height = self._value(layer, ("gh", "hgt"), self._standard_height(level))
                temperature = self._value(layer, ("t", "tmp"), 273.15) - 273.15
                rh = max(0.0, min(100.0, self._value(layer, ("r", "rh"), 0.0)))
                u = self._value(layer, ("u", "ugrd"), 0.0)
                v = self._value(layer, ("v", "vgrd"), 0.0)
                layers.append({"level_hpa": level, "height_m": round(height), "temperature_c": round(temperature, 1), "rh": round(rh, 1), "wind_ms": round(math.hypot(u, v), 1)})
            points.append({**point, "layers": layers})
        for item in datasets:
            item.close()
        return points

    @staticmethod
    def _value(layer: Any, names: tuple[str, ...], default: float) -> float:
        for name in names:
            if name in layer:
                try:
                    return float(layer[name].values)
                except (TypeError, ValueError):
                    continue
        return default

    @staticmethod
    def _standard_height(level_hpa: int) -> float:
        return 44330 * (1 - (level_hpa / 1013.25) ** 0.1903)

    @staticmethod
    def _model_metadata(profile: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
        if not profile:
            return None
        return {key: profile[key] for key in ("model", "run_time", "forecast_hour")}

    @staticmethod
    def _compare_profiles(gfs: Optional[dict[str, Any]], ecmwf: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
        if not gfs or not ecmwf:
            return None
        differences = []
        for gfs_point, ecmwf_point in zip(gfs["points"], ecmwf["points"]):
            for gfs_layer, ecmwf_layer in zip(gfs_point["layers"], ecmwf_point["layers"]):
                differences.append(abs(gfs_layer["rh"] - ecmwf_layer["rh"]))
        mean_delta = sum(differences) / max(1, len(differences))
        return {"mean_rh_difference": round(mean_delta, 1), "agreement": "高" if mean_delta <= 12 else ("中" if mean_delta <= 25 else "低")}

    def _read_fresh_json(self, path: Path) -> Optional[dict[str, Any]]:
        if not path.exists() or datetime.now().timestamp() - path.stat().st_mtime >= 6 * 3600:
            return None
        return self._read_json(path)

    @staticmethod
    def _read_json(path: Path) -> Optional[dict[str, Any]]:
        try:
            return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
        except (OSError, json.JSONDecodeError):
            return None

    @staticmethod
    def _unavailable(reason: str, corridor: list[dict[str, float]]) -> dict[str, Any]:
        return {"available": False, "reason": reason, "distance_km": PROFILE_DISTANCE_KM, "step_km": PROFILE_STEP_KM, "corridor": corridor}
