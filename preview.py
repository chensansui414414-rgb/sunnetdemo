"""零依赖预览服务器：仅用于首次看界面，生产与完整开发请使用 FastAPI。"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from backend.algorithm.predictor import predict_three_days
from backend.data_fetcher.weather_fetcher import WeatherDataFetcher
from backend.storage.repository import Repository

ROOT = Path(__file__).parent
FRONTEND = ROOT / "frontend"
fetcher = WeatherDataFetcher(ROOT / "data" / "cache")
repository = Repository(ROOT / "data" / "forecast.db")


class PreviewHandler(BaseHTTPRequestHandler):
    """提供前端静态资源和最小预测接口。"""

    def _json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/forecast":
            query = parse_qs(parsed.query)
            try:
                lat = float(query.get("lat", [32.0603])[0])
                lon = float(query.get("lon", [118.7969])[0])
                period = query.get("period", ["evening"])[0]
                if period not in {"morning", "evening"}:
                    raise ValueError
            except ValueError:
                return self._json({"detail": "经纬度格式不正确"}, 422)
            days = predict_three_days(fetcher.fetch_three_days(lat, lon), lat, lon, period)
            repository.save_forecast(lat, lon, days)
            is_mock = any(day["source"].startswith("mock") for day in days)
            return self._json({
                "location": {"lat": lat, "lon": lon, "name": "当前坐标"}, "period": period,
                "days": days, "is_mock": is_mock, "is_stale": any(day.get("is_stale") for day in days),
                "data_source": days[0].get("source_label"), "fetched_at": days[0].get("fetched_at"),
                "stats": repository.stats(),
            })
        if parsed.path == "/api/health":
            return self._json({"status": "ok", "message": "零依赖预览服务运行正常"})
        if parsed.path == "/api/profile":
            return self._json({"available": False, "reason": "零依赖预览服务未启用 GRIB；请使用 FastAPI 完整服务。", "distance_km": 600, "step_km": 50})
        static_map = {
            "/": "index.html", "/style.css": "style.css", "/script.js": "script.js",
            "/forecast-detail.html": "forecast-detail.html", "/forecast-detail.css": "forecast-detail.css",
            "/forecast-detail.js": "forecast-detail.js", "/static/style.css": "style.css", "/static/script.js": "script.js",
        }
        filename = static_map.get(parsed.path)
        if not filename:
            return self.send_error(404, "页面不存在")
        body = (FRONTEND / filename).read_bytes()
        mime = "text/html; charset=utf-8" if filename.endswith(".html") else ("text/css; charset=utf-8" if filename.endswith(".css") else "text/javascript; charset=utf-8")
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/feedback":
            return self._json({"detail": "预览服务不处理图片上传，请使用 FastAPI"}, 501)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length))
            feedback_id = repository.save_feedback(
                float(payload["lat"]), float(payload["lon"]), payload["forecast_date"],
                payload["result"], payload.get("note", "")[:500]
            )
            self._json({"message": "反馈已收到。", "id": feedback_id})
        except (ValueError, KeyError, json.JSONDecodeError):
            self._json({"detail": "反馈格式不正确"}, 422)

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"预览服务 | {fmt % args}")


if __name__ == "__main__":
    print("霞光时刻预览：http://127.0.0.1:8000")
    ThreadingHTTPServer(("127.0.0.1", 8000), PreviewHandler).serve_forever()
