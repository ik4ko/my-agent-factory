# Robinhood sidecar

Wraps [`robin_stocks`](https://github.com/jmfernandes/robin_stocks) in a tiny
FastAPI service that holds the real Robinhood session. This is the **only**
place in the whole project that ever sees Robinhood credentials — the Next.js
app and the loop worker only ever talk to it over `127.0.0.1`.

## Setup

```bash
cd services/robinhood
python -m venv .venv
.venv/Scripts/activate      # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
cp .env.example .env         # fill in RH_USERNAME / RH_PASSWORD / RH_MFA_SECRET
uvicorn main:app --host 127.0.0.1 --port 8787
```

First run logs in interactively (prompts for an MFA code) unless
`RH_MFA_SECRET` is set to your authenticator app's base32 TOTP secret.
`robin_stocks` caches the session to `~/.tokens/robinhood.pickle` afterward,
so restarts don't require re-auth until Robinhood itself expires the session.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | `{ ok, authenticated }` — `DirectAdapter.isReady()` polls this |
| GET | `/quote/{symbol}` | Latest price |
| GET | `/portfolio` | Cash + equity + positions |
| GET | `/positions` | Open positions |
| POST | `/order` | Places a market or limit order, returns `{status, brokerId, reason}` |
| POST | `/cancel` | Cancels an open order by broker id |

## Safety

- Bind to `127.0.0.1` only — never `0.0.0.0`, never behind a public reverse
  proxy, never on a port exposed by a cloud host's default firewall rules.
- This service places REAL orders the instant `/order` is called with
  `TRADING_ENABLED=true` upstream — the risk gate (`src/lib/execution/risk.ts`)
  and the master arm switch (`risk_state.trading_enabled`) are what stand
  between a loop's decision and this endpoint, not anything in this service.
- Automated/unofficial Robinhood API access may violate Robinhood's Terms of
  Service and risk account restriction. Running this sidecar is the
  operator's explicit choice to accept that risk.
