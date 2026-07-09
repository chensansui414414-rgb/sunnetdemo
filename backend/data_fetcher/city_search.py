"""全国城市搜索：使用 Open-Meteo Geocoding，并提供热门城市离线兜底。"""

from __future__ import annotations

import json
import logging
import time
from threading import Lock
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

LOGGER = logging.getLogger(__name__)
GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
SUPPORTED_COUNTRY_CODES = {"CN", "HK", "MO", "TW"}

# 这些城市同时用于首页空白状态和外部服务不可用时的兜底。
POPULAR_CITIES = [
    {"name": "北京", "lat": 39.9042, "lon": 116.4074, "province": "北京市", "region": "华北"},
    {"name": "上海", "lat": 31.2304, "lon": 121.4737, "province": "上海市", "region": "华东"},
    {"name": "广州", "lat": 23.1291, "lon": 113.2644, "province": "广东省", "region": "华南"},
    {"name": "深圳", "lat": 22.5431, "lon": 114.0579, "province": "广东省", "region": "华南"},
    {"name": "杭州", "lat": 30.2741, "lon": 120.1551, "province": "浙江省", "region": "华东"},
    {"name": "南京", "lat": 32.0603, "lon": 118.7969, "province": "江苏省", "region": "华东"},
    {"name": "成都", "lat": 30.5728, "lon": 104.0668, "province": "四川省", "region": "西南"},
    {"name": "重庆", "lat": 29.5630, "lon": 106.5516, "province": "重庆市", "region": "西南"},
    {"name": "武汉", "lat": 30.5928, "lon": 114.3055, "province": "湖北省", "region": "华中"},
    {"name": "西安", "lat": 34.3416, "lon": 108.9398, "province": "陕西省", "region": "西北"},
    {"name": "香港", "lat": 22.3193, "lon": 114.1694, "province": "香港特别行政区", "region": "港澳"},
    {"name": "澳门", "lat": 22.1987, "lon": 113.5439, "province": "澳门特别行政区", "region": "港澳"},
    {"name": "台北", "lat": 25.0330, "lon": 121.5654, "province": "台湾地区", "region": "台湾"},
    {"name": "高雄", "lat": 22.6273, "lon": 120.3014, "province": "台湾地区", "region": "台湾"},
]


class CitySearchService:
    """查询并标准化全国地级行政区、港澳台县市及其城市坐标。"""

    def __init__(self, cache_seconds: int = 24 * 3600) -> None:
        self.cache_seconds = cache_seconds
        self._cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
        self._lock = Lock()

    def popular(self) -> list[dict[str, Any]]:
        return [{**item, "country_code": self._country_code(item["name"], item["region"]), "source": "内置热门城市"} for item in POPULAR_CITIES]

    def search(self, query: str, limit: int = 30) -> tuple[list[dict[str, Any]], bool]:
        """返回匹配城市；第二个值表示是否启用了离线兜底。"""
        normalized = query.strip()[:60]
        if len(normalized) < 2:
            return self.popular()[:limit], False

        cache_key = normalized.casefold()
        with self._lock:
            cached = self._cache.get(cache_key)
        if cached and time.time() - cached[0] < self.cache_seconds:
            return cached[1][:limit], False

        try:
            rows = self._fetch(normalized)
            with self._lock:
                self._cache[cache_key] = (time.time(), rows)
            return rows[:limit], False
        except (OSError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
            LOGGER.warning("全国城市搜索暂不可用，返回本地热门城市：%s", exc)
            fallback = [city for city in self.popular() if normalized in city["name"] or normalized in city["province"]]
            return fallback[:limit], True

    def _fetch(self, query: str) -> list[dict[str, Any]]:
        params = urlencode({"name": query, "count": 100, "language": "zh", "format": "json"})
        request = Request(f"{GEOCODING_URL}?{params}", headers={"User-Agent": "XiaGlow/1.0"})
        with urlopen(request, timeout=8) as response:  # noqa: S310 - URL 为固定可信 HTTPS 服务。
            payload = json.load(response)

        candidates: list[dict[str, Any]] = []
        seen: set[tuple[str, str, float, float]] = set()
        for row in payload.get("results", []):
            country_code = str(row.get("country_code", "")).upper()
            if country_code not in SUPPORTED_COUNTRY_CODES:
                continue
            city = self._normalize(row)
            key = (city["name"], city["province"], round(city["lat"], 3), round(city["lon"], 3))
            if key in seen:
                continue
            seen.add(key)
            candidates.append(city)

        candidates.sort(key=lambda city: self._sort_key(city, query))
        return candidates

    @staticmethod
    def _normalize(row: dict[str, Any]) -> dict[str, Any]:
        country_code = str(row.get("country_code", "")).upper()
        province = str(row.get("admin1") or CitySearchService._area_name(country_code))
        prefecture = str(row.get("admin2") or "")
        return {
            "name": str(row.get("name") or prefecture or province),
            "lat": round(float(row["latitude"]), 6),
            "lon": round(float(row["longitude"]), 6),
            "province": province,
            "prefecture": prefecture,
            "country_code": country_code,
            "timezone": str(row.get("timezone") or "Asia/Shanghai"),
            "feature_code": str(row.get("feature_code") or ""),
            "population": int(row.get("population") or 0),
            "region": CitySearchService._area_name(country_code),
            "source": "Open-Meteo Geocoding / GeoNames",
        }

    @staticmethod
    def _sort_key(city: dict[str, Any], query: str) -> tuple[int, int, int]:
        name = city["name"]
        exact = 0 if name == query or name.rstrip("市县区盟") == query.rstrip("市县区盟") else 1
        administrative = 0 if city["feature_code"].startswith(("PPLA", "ADM")) else 1
        return exact, administrative, -city["population"]

    @staticmethod
    def _area_name(country_code: str) -> str:
        return {"CN": "中国大陆", "HK": "香港特别行政区", "MO": "澳门特别行政区", "TW": "台湾地区"}.get(country_code, "")

    @staticmethod
    def _country_code(name: str, region: str) -> str:
        if name == "香港":
            return "HK"
        if name == "澳门":
            return "MO"
        return "TW" if region == "台湾" else "CN"
