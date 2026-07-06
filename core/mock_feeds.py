from __future__ import annotations

import math
import random
import time
from collections.abc import Iterable
from typing import Any


SYMBOLS = ("SOXS", "NVDA", "SPY")


def options_flow_tick(symbols: Iterable[str] = SYMBOLS, *, seed: int | None = None) -> dict[str, Any]:
    """Cheap deterministic-ish options flow for local Phase 1 runs."""
    rng = random.Random(seed if seed is not None else int(time.time() * 1000))
    now = time.time()
    rows: list[dict[str, Any]] = []

    for idx, symbol in enumerate(symbols):
        base = 50 + idx * 70 + math.sin(now / (9 + idx)) * 4
        spot = round(base + rng.uniform(-1.2, 1.2), 2)
        delta = round(rng.uniform(-0.72, 0.72), 4)
        gamma = round(abs(rng.gauss(0.05 + idx * 0.01, 0.025)), 4)
        premium = round(rng.uniform(18_000, 420_000), 2)
        side = "call" if delta >= 0 else "put"

        rows.append(
            {
                "symbol": symbol,
                "spot": spot,
                "side": side,
                "delta": delta,
                "gamma": gamma,
                "premium": premium,
                "flow_score": round((abs(delta) * 0.65 + gamma * 2.2) * premium / 100_000, 4),
                "ts": now,
            }
        )

    net_gamma = round(sum(row["gamma"] if row["side"] == "call" else -row["gamma"] for row in rows), 4)
    return {
        "provider": "mock.options",
        "symbols": list(symbols),
        "net_gamma": net_gamma,
        "gamma_bias": "positive" if net_gamma >= 0 else "negative",
        "flows": rows,
        "ts": now,
    }


def activity_log_tick(room: str, *, count: int = 3) -> list[dict[str, Any]]:
    now = time.time()
    return [
        {
            "id": f"{room.lower()}-{int(now * 1000)}-{idx}",
            "room": room,
            "level": "info",
            "message": f"{room} local runtime heartbeat {idx + 1}",
            "ts": now,
        }
        for idx in range(max(1, min(count, 8)))
    ]


def dev_watch_tick(paths: Iterable[str] | None = None) -> dict[str, Any]:
    watched = list(paths or ("src", "core", "scripts"))
    return {
        "provider": "mock.file_watch",
        "changed": [{"path": path, "event": "stable"} for path in watched],
        "logs": activity_log_tick("Dev", count=2),
        "ts": time.time(),
    }


def personal_task_tick(tasks: Iterable[dict[str, Any]] | None = None) -> dict[str, Any]:
    task_list = list(tasks or [{"title": "Review inbox", "status": "queued"}])
    return {
        "provider": "mock.tasks",
        "tasks": task_list[:24],
        "logs": activity_log_tick("Personal", count=2),
        "ts": time.time(),
    }

