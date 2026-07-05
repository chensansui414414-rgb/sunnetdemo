"""SQLite 预测历史与反馈存储。"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any


class Repository:
    """封装轻量数据库操作，避免业务层直接拼 SQL。"""

    def __init__(self, db_path: Path) -> None:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.db_path = db_path
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS forecasts (
                    id INTEGER PRIMARY KEY, created_at TEXT, lat REAL, lon REAL, payload TEXT
                );
                CREATE TABLE IF NOT EXISTS feedback (
                    id INTEGER PRIMARY KEY, created_at TEXT, lat REAL, lon REAL,
                    forecast_date TEXT, result TEXT, note TEXT, photo_path TEXT
                );
                """
            )

    def save_forecast(self, lat: float, lon: float, payload: Any) -> None:
        with self._connect() as conn:
            conn.execute("INSERT INTO forecasts VALUES (NULL, ?, ?, ?, ?)", (datetime.now().isoformat(), lat, lon, json.dumps(payload, ensure_ascii=False)))

    def save_feedback(self, lat: float, lon: float, forecast_date: str, result: str, note: str, photo_path: str = "") -> int:
        with self._connect() as conn:
            cursor = conn.execute("INSERT INTO feedback VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)", (datetime.now().isoformat(), lat, lon, forecast_date, result, note, photo_path))
            return int(cursor.lastrowid)

    def stats(self) -> dict[str, int]:
        with self._connect() as conn:
            forecasts = conn.execute("SELECT COUNT(*) FROM forecasts").fetchone()[0]
            feedback = conn.execute("SELECT COUNT(*) FROM feedback").fetchone()[0]
        return {"forecasts": forecasts, "feedback": feedback}
