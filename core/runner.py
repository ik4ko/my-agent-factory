from __future__ import annotations

import argparse
import asyncio
import json
import signal
import time
from pathlib import Path
from typing import Any, Literal

from .mock_feeds import activity_log_tick, dev_watch_tick, options_flow_tick, personal_task_tick
from .state_store import SQLiteStateStore


Room = Literal["Trade", "Dev", "Personal"]
ROOMS: tuple[Room, ...] = ("Trade", "Dev", "Personal")


class RuntimeLoop:
    def __init__(self, db_path: str | Path = "jarvis_state.sqlite3", tick_ms: int = 1000) -> None:
        self.store = SQLiteStateStore(db_path)
        self.tick_s = max(0.2, tick_ms / 1000)
        self._stop = asyncio.Event()
        self._matrix = None
        self._router = None
        self._room_event_cls = None

    async def run_forever(self) -> None:
        self._install_signals()
        self._load_runtime_bridges()

        try:
            while not self._stop.is_set():
                started = time.perf_counter()
                try:
                    room = self.read_active_room()
                    payload = self.build_payload(room)
                    output = await self.run_matrix(room, payload)
                    await self.emit(room, output)
                except Exception as exc:
                    await self.emit_error(exc)

                await asyncio.sleep(max(0, self.tick_s - (time.perf_counter() - started)))
        finally:
            self.store.close()

    def stop(self) -> None:
        self._stop.set()

    def read_active_room(self) -> Room:
        raw = self.store.get("active_room", "Trade").title()
        return raw if raw in ROOMS else "Trade"

    def build_payload(self, room: Room) -> dict[str, Any]:
        if room == "Trade":
            flow = options_flow_tick()
            return {
                "room": room,
                "alpaca_mode": "mock",
                "alpaca_options": flow,
                "symbols": flow["symbols"],
                "activity": activity_log_tick(room),
                "ts": time.time(),
            }

        if room == "Dev":
            return {
                "room": room,
                "file_watch": dev_watch_tick(self._db_array("dev_watch_paths")),
                "tasks": self._db_array("dev_tasks"),
                "ts": time.time(),
            }

        return {
            "room": room,
            "task_state": personal_task_tick(self._db_array("personal_tasks")),
            "calendar": self._db_array("personal_calendar"),
            "ts": time.time(),
        }

    async def run_matrix(self, room: Room, payload: dict[str, Any]) -> dict[str, Any]:
        if self._matrix is None:
            return {"room": room, "payload": payload, "matrix": "unavailable", "ts": time.time()}

        result = self._matrix(room.lower(), payload)
        if asyncio.iscoroutine(result):
            result = await result

        if hasattr(result, "model_dump"):
            return result.model_dump()
        if isinstance(result, dict):
            return result
        return {"room": room, "result": result, "ts": time.time()}

    async def emit(self, room: Room, payload: dict[str, Any]) -> None:
        event = {
            "type": "runtime.tick",
            "source_room": room.lower(),
            "target_room": None,
            "payload": payload,
            "ts": time.time(),
        }

        if self._router is None:
            print(json.dumps(event, separators=(",", ":")), flush=True)
            return

        room_event = self._make_room_event(event)
        publish = getattr(self._router, "publish", None)
        if publish and room_event is not None:
            result = publish(room_event)
            if asyncio.iscoroutine(result):
                await result
            return

        publish_snapshot = getattr(self._router, "publish_snapshot", None)
        if publish_snapshot:
            result = publish_snapshot(event)
            if asyncio.iscoroutine(result):
                await result
            return

        print(json.dumps(event, separators=(",", ":")), flush=True)

    async def emit_error(self, exc: Exception) -> None:
        await self.emit(
            "Dev",
            {
                "status": "error",
                "error": f"{type(exc).__name__}: {exc}",
                "ts": time.time(),
            },
        )

    def _load_runtime_bridges(self) -> None:
        try:
            from .matrix import run_matrix

            self._matrix = run_matrix
        except Exception:
            self._matrix = None

        try:
            from .ipc_bridge import RoomEvent, router

            if hasattr(router, "start"):
                try:
                    router.start()
                except RuntimeError:
                    pass
            self._room_event_cls = RoomEvent
            self._router = router
        except Exception:
            self._room_event_cls = None
            self._router = None

    def _make_room_event(self, event: dict[str, Any]) -> Any:
        if self._room_event_cls is None:
            return None
        try:
            return self._room_event_cls(
                type=event["type"],
                source_room=event["source_room"],
                target_room=event["target_room"],
                payload=event["payload"],
            )
        except TypeError:
            return None

    def _db_array(self, key: str) -> list[Any]:
        return self.store.get_json_list(key)

    def _install_signals(self) -> None:
        try:
            loop = asyncio.get_running_loop()
            for sig in (signal.SIGINT, signal.SIGTERM):
                loop.add_signal_handler(sig, self.stop)
        except (NotImplementedError, RuntimeError):
            pass


async def main() -> None:
    parser = argparse.ArgumentParser(description="Jarvis local background runtime loop")
    parser.add_argument("--db", default="jarvis_state.sqlite3")
    parser.add_argument("--tick-ms", type=int, default=1000)
    args = parser.parse_args()
    await RuntimeLoop(args.db, args.tick_ms).run_forever()


if __name__ == "__main__":
    asyncio.run(main())
