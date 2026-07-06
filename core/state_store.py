from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any


class SQLiteStateStore:
    """Tiny WAL-backed room/context store for the local Python runtime."""

    def __init__(self, db_path: str | Path = "jarvis_state.sqlite3") -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.db_path)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=NORMAL")
        self.db.execute("PRAGMA temp_store=MEMORY")
        self.db.execute(
            """
            CREATE TABLE IF NOT EXISTS kv (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at REAL NOT NULL
            )
            """
        )
        self.put_default("active_room", "Trade")

    def close(self) -> None:
        self.db.close()

    def get(self, key: str, default: str = "") -> str:
        row = self.db.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
        return str(row["value"]) if row else default

    def put(self, key: str, value: str) -> None:
        self.db.execute(
            """
            INSERT INTO kv(key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
            """,
            (key, value, time.time()),
        )
        self.db.commit()

    def put_default(self, key: str, value: str) -> None:
        self.db.execute(
            "INSERT OR IGNORE INTO kv(key, value, updated_at) VALUES (?, ?, ?)",
            (key, value, time.time()),
        )
        self.db.commit()

    def get_json_list(self, key: str) -> list[Any]:
        raw = self.get(key, "[]")
        try:
            value = json.loads(raw)
        except json.JSONDecodeError:
            return []
        return value if isinstance(value, list) else []

    def set_json(self, key: str, value: Any) -> None:
        self.put(key, json.dumps(value, separators=(",", ":")))

