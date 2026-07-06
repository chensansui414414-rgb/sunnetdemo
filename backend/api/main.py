"""霞光预测 FastAPI 应用入口。"""

from __future__ import annotations

import logging
import shutil
import uuid
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend.algorithm.predictor import predict_three_days
from backend.data_fetcher.weather_fetcher import WeatherDataFetcher
from backend.storage.repository import Repository

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "data"
FRONTEND_DIR = ROOT / "frontend"

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
app = FastAPI(title="霞光时刻 API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
fetcher = WeatherDataFetcher(DATA_DIR / "cache")
repository = Repository(DATA_DIR / "forecast.db")


class FeedbackBody(BaseModel):
    """反馈参数。照片 MVP 阶段以本地路径或 URL 字符串记录。"""

    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    forecast_date: str
    result: Literal["命中", "翻车", "一般"]
    note: str = Field(default="", max_length=500)
    photo_path: str = ""


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "message": "霞光预测服务运行正常"}


@app.get("/api/forecast")
def forecast(lat: float = 32.0603, lon: float = 118.7969, period: Literal["morning", "evening"] = "evening") -> dict:
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(status_code=422, detail="经纬度超出有效范围")
    rows = fetcher.fetch_three_days(lat, lon)
    result = predict_three_days(rows, lat, lon, period)
    repository.save_forecast(lat, lon, result)
    is_mock = any(day["source"].startswith("mock") for day in result)
    return {
        "location": {"lat": lat, "lon": lon, "name": "当前坐标"}, "period": period,
        "days": result, "is_mock": is_mock, "is_stale": any(day.get("is_stale") for day in result),
        "data_source": result[0].get("source_label"), "fetched_at": result[0].get("fetched_at"),
        "stats": repository.stats(),
    }


@app.post("/api/feedback")
def feedback(body: FeedbackBody) -> dict[str, int | str]:
    payload = body.model_dump() if hasattr(body, "model_dump") else body.dict()
    feedback_id = repository.save_feedback(**payload)
    return {"message": "反馈已收到，感谢你帮预测变得更准。", "id": feedback_id}


@app.post("/api/feedback/photo")
def feedback_with_photo(
    lat: float = Form(...), lon: float = Form(...), forecast_date: str = Form(...),
    result: Literal["命中", "翻车", "一般"] = Form(...), note: str = Form(default=""),
    photo: UploadFile = File(...),
) -> dict[str, int | str]:
    """保存一份带实拍图片的反馈；文件类型与大小均做基础限制。"""
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise HTTPException(status_code=422, detail="经纬度超出有效范围")
    if photo.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="仅支持 JPG、PNG 或 WebP 图片")
    upload_dir = DATA_DIR / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    suffix = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[photo.content_type]
    target = upload_dir / f"{uuid.uuid4().hex}{suffix}"
    photo.file.seek(0, 2)
    if photo.file.tell() > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="图片不能超过 8MB")
    photo.file.seek(0)
    with target.open("wb") as output:
        shutil.copyfileobj(photo.file, output)
    feedback_id = repository.save_feedback(lat, lon, forecast_date, result, note[:500], str(target.relative_to(ROOT)))
    return {"message": "实拍与反馈已收到。", "id": feedback_id}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/style.css", include_in_schema=False)
def stylesheet() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "style.css", media_type="text/css")


@app.get("/script.js", include_in_schema=False)
def javascript() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "script.js", media_type="text/javascript")


@app.get("/forecast-detail.html", include_in_schema=False)
def forecast_detail() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "forecast-detail.html")


@app.get("/forecast-detail.css", include_in_schema=False)
def forecast_detail_stylesheet() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "forecast-detail.css", media_type="text/css")


@app.get("/forecast-detail.js", include_in_schema=False)
def forecast_detail_javascript() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "forecast-detail.js", media_type="text/javascript")


app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
