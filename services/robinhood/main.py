"""
Robinhood sidecar — the ONLY thing in this whole project that ever holds a
real Robinhood session. It wraps robin_stocks in a tiny FastAPI service bound
to 127.0.0.1 only (never expose this on a public interface or reverse proxy).

The Next.js app / loop worker never sees RH_USERNAME/RH_PASSWORD/RH_MFA_SECRET
— those live only in this process's own .env (services/robinhood/.env),
never in the app's .env.local. src/lib/execution/direct-adapter.ts talks to
this service over plain localhost HTTP.

Run:
    cd services/robinhood
    python -m venv .venv && .venv/Scripts/activate  (or source .venv/bin/activate)
    pip install -r requirements.txt
    cp .env.example .env   # fill in RH_USERNAME / RH_PASSWORD / RH_MFA_SECRET
    uvicorn main:app --host 127.0.0.1 --port 8787

First run prompts for MFA if RH_MFA_SECRET isn't set; robin_stocks caches the
session token to disk afterward (~/.tokens/robinhood.pickle) so restarts
don't require re-auth until Robinhood expires the session.
"""
import os
from datetime import datetime, timezone

import pyotp
import robin_stocks.robinhood as rh
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="robinhood-sidecar")

_authenticated = False


def _login() -> bool:
    global _authenticated
    if _authenticated:
        return True
    username = os.environ.get("RH_USERNAME")
    password = os.environ.get("RH_PASSWORD")
    mfa_secret = os.environ.get("RH_MFA_SECRET")
    if not username or not password:
        return False
    try:
        mfa_code = pyotp.TOTP(mfa_secret).now() if mfa_secret else None
        rh.login(username=username, password=password, mfa_code=mfa_code, store_session=True)
        _authenticated = True
    except Exception:
        _authenticated = False
    return _authenticated


class OrderIntent(BaseModel):
    loopId: str
    symbol: str
    side: str  # 'buy' | 'sell'
    qty: float | None = None
    notional: float | None = None
    type: str = "market"  # 'market' | 'limit'
    limitPrice: float | None = None
    reason: str


class CancelRequest(BaseModel):
    brokerId: str


@app.get("/health")
def health():
    ok = _login()
    return {"ok": True, "authenticated": ok}


@app.get("/quote/{symbol}")
def quote(symbol: str):
    if not _login():
        raise HTTPException(503, "not authenticated")
    data = rh.get_latest_price(symbol.upper())
    if not data or data[0] is None:
        raise HTTPException(404, f"no quote for {symbol}")
    return {"price": float(data[0]), "asOf": datetime.now(timezone.utc).isoformat()}


@app.get("/portfolio")
def portfolio():
    if not _login():
        raise HTTPException(503, "not authenticated")
    profile = rh.load_portfolio_profile()
    positions = _positions()
    cash = float(profile.get("withdrawable_amount") or profile.get("cash") or 0)
    equity = float(profile.get("equity") or cash)
    return {"cash": cash, "equity": equity, "positions": positions, "asOf": datetime.now(timezone.utc).isoformat()}


def _positions():
    holdings = rh.build_holdings() or {}
    out = []
    for symbol, h in holdings.items():
        out.append(
            {
                "symbol": symbol,
                "qty": float(h.get("quantity", 0)),
                "avgCost": float(h.get("average_buy_price", 0)),
                "marketValue": float(h.get("equity", 0)),
            }
        )
    return out


@app.get("/positions")
def positions():
    if not _login():
        raise HTTPException(503, "not authenticated")
    return {"positions": _positions()}


@app.post("/order")
def place_order(intent: OrderIntent):
    if not _login():
        raise HTTPException(503, "not authenticated")

    side = intent.side.lower()
    qty = intent.qty
    if qty is None or qty <= 0:
        return {"status": "rejected", "reason": "order size is required; qty must be positive"}

    try:
        if intent.type == "limit" and intent.limitPrice:
            fn = rh.order_buy_limit if side == "buy" else rh.order_sell_limit
            resp = fn(intent.symbol.upper(), qty, intent.limitPrice)
        else:
            fn = rh.order_buy_market if side == "buy" else rh.order_sell_market
            resp = fn(intent.symbol.upper(), qty)
    except Exception as exc:  # robin_stocks raises on rejected/invalid orders
        return {"status": "rejected", "reason": str(exc)[:300]}

    if not resp or "id" not in resp:
        return {"status": "rejected", "reason": str(resp)[:300] or "no order id returned"}

    return {
        "status": "submitted",
        "brokerId": resp.get("id"),
        "reason": intent.reason,
    }


@app.post("/cancel")
def cancel_order(req: CancelRequest):
    if not _login():
        raise HTTPException(503, "not authenticated")
    rh.cancel_stock_order(req.brokerId)
    return {"ok": True}
