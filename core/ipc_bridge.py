from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import struct
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4


GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


@dataclass(slots=True)
class RoomEvent:
    type: str
    source_room: str
    payload: dict[str, Any]
    target_room: str | None = None
    id: str = field(default_factory=lambda: uuid4().hex)
    ts: float = field(default_factory=time.time)

    def asdict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "event": self.type,
            "source_room": self.source_room,
            "target_room": self.target_room,
            "payload": self.payload,
            "ts": self.ts,
        }


class LocalSocketBridge:
    def __init__(self, host: str = "127.0.0.1", port: int = 8765, backlog: int = 256) -> None:
        self.host = host
        self.port = port
        self._loop: asyncio.AbstractEventLoop | None = None
        self._server: asyncio.AbstractServer | None = None
        self._clients: set[asyncio.StreamWriter] = set()
        self._pending: deque[str] = deque(maxlen=backlog)
        self._lock = threading.RLock()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        with self._lock:
            if self._loop and self._loop.is_running():
                self._loop.call_soon_threadsafe(lambda: asyncio.create_task(self._ensure_server()))
                return
            try:
                loop = asyncio.get_running_loop()
                self._loop = loop
                loop.create_task(self._ensure_server())
            except RuntimeError:
                self._thread = threading.Thread(target=self._run_thread_loop, name="jarvis-ws", daemon=True)
                self._thread.start()

    def emit(self, event_name: str, payload: dict[str, Any]) -> None:
        message = json.dumps(
            {"event": event_name, "payload": payload, "ts": time.time()},
            separators=(",", ":"),
            default=str,
        )
        loop = self._loop
        if not loop or not loop.is_running():
            self._pending.append(message)
            return
        loop.call_soon_threadsafe(lambda: asyncio.create_task(self._broadcast(message)))

    async def emit_async(self, event_name: str, payload: dict[str, Any]) -> None:
        message = json.dumps(
            {"event": event_name, "payload": payload, "ts": time.time()},
            separators=(",", ":"),
            default=str,
        )
        await self._broadcast(message)

    async def serve_forever(self) -> None:
        await self._ensure_server()
        await asyncio.Future()

    def _run_thread_loop(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop
        loop.run_until_complete(self.serve_forever())

    async def _ensure_server(self) -> None:
        if self._server is not None:
            return
        self._server = await asyncio.start_server(self._handle_client, self.host, self.port)

    async def _handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        if not await self._handshake(reader, writer):
            writer.close()
            await writer.wait_closed()
            return

        self._clients.add(writer)
        try:
            while self._pending:
                await self._send_text(writer, self._pending.popleft())
            await self._consume(reader, writer)
        finally:
            self._clients.discard(writer)
            writer.close()
            await writer.wait_closed()

    async def _handshake(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> bool:
        try:
            raw = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=3)
        except (asyncio.TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError):
            return False

        headers: dict[str, str] = {}
        for line in raw.decode("latin1", errors="ignore").split("\r\n")[1:]:
            if ":" in line:
                key, value = line.split(":", 1)
                headers[key.strip().lower()] = value.strip()

        ws_key = headers.get("sec-websocket-key")
        if not ws_key:
            return False

        accept = base64.b64encode(hashlib.sha1((ws_key + GUID).encode("ascii")).digest()).decode("ascii")
        writer.write(
            (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept}\r\n\r\n"
            ).encode("ascii")
        )
        await writer.drain()
        return True

    async def _consume(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        while True:
            head = await reader.readexactly(2)
            opcode = head[0] & 0x0F
            masked = bool(head[1] & 0x80)
            length = head[1] & 0x7F
            if length == 126:
                length = struct.unpack("!H", await reader.readexactly(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", await reader.readexactly(8))[0]

            mask = await reader.readexactly(4) if masked else b""
            payload = await reader.readexactly(length) if length else b""
            if masked:
                payload = bytes(byte ^ mask[idx % 4] for idx, byte in enumerate(payload))

            if opcode == 8:
                return
            if opcode == 9:
                await self._send_frame(writer, payload, opcode=10)

    async def _broadcast(self, message: str) -> None:
        if not self._clients:
            self._pending.append(message)
            return

        dead: list[asyncio.StreamWriter] = []
        for writer in tuple(self._clients):
            try:
                await self._send_text(writer, message)
            except (ConnectionError, asyncio.IncompleteReadError, RuntimeError):
                dead.append(writer)

        for writer in dead:
            self._clients.discard(writer)

    async def _send_text(self, writer: asyncio.StreamWriter, message: str) -> None:
        await self._send_frame(writer, message.encode("utf-8"), opcode=1)

    async def _send_frame(self, writer: asyncio.StreamWriter, payload: bytes, opcode: int) -> None:
        length = len(payload)
        if length <= 125:
            header = bytes((0x80 | opcode, length))
        elif length <= 65535:
            header = bytes((0x80 | opcode, 126)) + struct.pack("!H", length)
        else:
            header = bytes((0x80 | opcode, 127)) + struct.pack("!Q", length)
        writer.write(header + payload)
        await writer.drain()


class SocketEventRouter:
    def __init__(self, socket_bridge: LocalSocketBridge) -> None:
        self.socket_bridge = socket_bridge

    def start(self) -> None:
        self.socket_bridge.start()

    async def publish(self, event: RoomEvent) -> bool:
        await self.socket_bridge.emit_async(event.type, event.asdict())
        return True

    async def publish_snapshot(self, snapshot: dict[str, Any]) -> bool:
        await self.socket_bridge.emit_async("matrix.snapshot", snapshot)
        return True


bridge = LocalSocketBridge()
router = SocketEventRouter(bridge)


def emit(event_name: str, payload: dict[str, Any]) -> None:
    bridge.emit(event_name, payload)


async def main() -> None:
    await bridge.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
