from __future__ import annotations

import argparse
import asyncio
import json
import os
import random
import time
from dataclasses import dataclass
from typing import Any

from .ipc_bridge import bridge

ALPACA_IEX_STREAM = "wss://stream.data.alpaca.markets/v2/iex"
DEFAULT_SYMBOLS = ("SPY", "NVDA", "AAPL")
EMIT_MIN_INTERVAL_S = 0.25
MOCK_TICK_S = 1.0


def _env_keys() -> tuple[str, str] | None:
    key = (
        os.environ.get("ALPACA_API_KEY_ID")
        or os.environ.get("APCA_API_KEY_ID")
        or os.environ.get("ALPACA_API_KEY")
    )
    secret = (
        os.environ.get("ALPACA_API_SECRET_KEY")
        or os.environ.get("APCA_API_SECRET_KEY")
        or os.environ.get("ALPACA_API_SECRET")
    )
    return (key, secret) if key and secret else None


def _ema(prev: float | None, value: float, period: int) -> float:
    if prev is None:
        return value
    k = 2.0 / (period + 1.0)
    return prev + k * (value - prev)


@dataclass(slots=True)
class IndicatorState:
    """Incremental Wilder RSI(14) + MACD(12,26,9) so the frontend only ever
    receives finished indicator values, never raw series to recompute."""

    rsi_period: int = 14
    prev_price: float | None = None
    avg_gain: float = 0.0
    avg_loss: float = 0.0
    seen: int = 0
    ema_fast: float | None = None
    ema_slow: float | None = None
    ema_signal: float | None = None

    def update(self, price: float) -> dict[str, float | None]:
        if self.prev_price is not None:
            delta = price - self.prev_price
            gain, loss = max(delta, 0.0), max(-delta, 0.0)
            self.seen += 1
            if self.seen <= self.rsi_period:
                self.avg_gain += (gain - self.avg_gain) / self.seen
                self.avg_loss += (loss - self.avg_loss) / self.seen
            else:
                self.avg_gain = (self.avg_gain * (self.rsi_period - 1) + gain) / self.rsi_period
                self.avg_loss = (self.avg_loss * (self.rsi_period - 1) + loss) / self.rsi_period
        self.prev_price = price

        self.ema_fast = _ema(self.ema_fast, price, 12)
        self.ema_slow = _ema(self.ema_slow, price, 26)
        macd = self.ema_fast - self.ema_slow
        self.ema_signal = _ema(self.ema_signal, macd, 9)

        rsi: float | None = None
        if self.seen >= self.rsi_period:
            rsi = 100.0 if self.avg_loss == 0 else 100.0 - 100.0 / (1.0 + self.avg_gain / self.avg_loss)

        return {
            "rsi": round(rsi, 2) if rsi is not None else None,
            "macd": round(macd, 4),
            "macd_signal": round(self.ema_signal, 4),
            "macd_hist": round(macd - self.ema_signal, 4),
        }


class MarketTickFeed:
    """Streams Alpaca free-tier (IEX) trades/bars, computes indicators in
    Python, and paints the UI through the local agent socket. Falls back to a
    mock random walk when no Alpaca keys are present so the Trading Room still
    renders without credentials."""

    def __init__(self, symbols: list[str] | tuple[str, ...] = DEFAULT_SYMBOLS) -> None:
        self.symbols = [s.strip().upper() for s in symbols if s.strip()]
        self.indicators: dict[str, IndicatorState] = {s: IndicatorState() for s in self.symbols}
        self._last_emit: dict[str, float] = {}

    async def run(self) -> None:
        keys = _env_keys()
        if keys is None:
            await self._run_mock("no Alpaca keys in env")
            return

        backoff = 1.0
        while True:
            try:
                await self._run_alpaca(*keys)
                backoff = 1.0
            except Exception as exc:
                self._status("reconnecting", error=f"{type(exc).__name__}: {exc}")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2.0, 30.0)

    async def _run_alpaca(self, key: str, secret: str) -> None:
        import websockets

        async with websockets.connect(ALPACA_IEX_STREAM, max_size=2**22) as ws:
            await ws.send(json.dumps({"action": "auth", "key": key, "secret": secret}))
            await ws.send(json.dumps({"action": "subscribe", "trades": self.symbols, "bars": self.symbols}))
            self._status("streaming", provider="alpaca.iex")
            async for raw in ws:
                for msg in json.loads(raw):
                    kind = msg.get("T")
                    if kind == "t":
                        self._on_price(msg["S"], float(msg["p"]), "alpaca.iex")
                    elif kind == "b":
                        # minute bar close keeps indicators moving through thin IEX tape
                        self._on_price(msg["S"], float(msg["c"]), "alpaca.iex.bar")
                    elif kind == "error":
                        raise RuntimeError(f"alpaca stream {msg.get('code')}: {msg.get('msg')}")

    async def _run_mock(self, reason: str) -> None:
        self._status("mock", reason=reason)
        rng = random.Random()
        prices = {s: 80.0 + 60.0 * idx for idx, s in enumerate(self.symbols)}
        while True:
            for symbol in self.symbols:
                prices[symbol] = max(1.0, prices[symbol] * (1.0 + rng.gauss(0.0, 0.0008)))
                self._on_price(symbol, prices[symbol], "mock")
            await asyncio.sleep(MOCK_TICK_S)

    def _on_price(self, symbol: str, price: float, provider: str) -> None:
        state = self.indicators.get(symbol)
        if state is None:
            state = self.indicators[symbol] = IndicatorState()
        indicators = state.update(price)

        now = time.time()
        if now - self._last_emit.get(symbol, 0.0) < EMIT_MIN_INTERVAL_S:
            return
        self._last_emit[symbol] = now
        bridge.emit(
            "market.tick",
            {
                "room": "trade",
                "provider": provider,
                "symbol": symbol,
                "price": round(price, 4),
                "ts": now,
                "indicators": indicators,
            },
        )

    def _status(self, status: str, **extra: Any) -> None:
        bridge.emit("market.status", {"room": "trade", "status": status, "symbols": self.symbols, **extra})


async def main() -> None:
    parser = argparse.ArgumentParser(description="Alpaca IEX tick feed -> local agent socket (port 8765)")
    parser.add_argument("--symbols", default=",".join(DEFAULT_SYMBOLS))
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    bridge.port = args.port
    bridge.start()
    await MarketTickFeed(args.symbols.split(",")).run()


if __name__ == "__main__":
    asyncio.run(main())
