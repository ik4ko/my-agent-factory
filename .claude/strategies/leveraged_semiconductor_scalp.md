# Strategy: Leveraged Semiconductor Scalp (SOXS / NVDA)

Short-horizon mean-reversion scalp on semiconductor exhaustion. Signals come
from the local feed's Python-computed indicators (`market.tick` on port 8765,
via `npm run research-sync`); every intent this strategy produces goes through
the engine's mandatory risk gate and lands as an audit row in `orders`.

## Instruments
- **NVDA** — primary. Directional scalp on the underlying.
- **SOXS** — 3× *inverse* semiconductor ETF. Use ONLY as a bearish-thesis
  expression, ONLY intraday: daily rebalancing makes it decay in chop, so any
  SOXS position held past the close is a strategy violation, not a swing.

## Signal logic
Entry requires BOTH, on the same symbol, within 3 ticks of each other:
1. **RSI exhaustion** — RSI(14) ≥ 72 (fade long / SOXS long) or ≤ 28
   (buy dip). Between 28–72 there is no trade; do not force one.
2. **MACD flip confirmation** — `macd_hist` crosses zero *against* the
   exhausted direction (e.g. RSI ≥ 72 AND hist flips negative). RSI alone is
   not a signal; an unconfirmed exhaustion reading is a watch, not an entry.

Exit: RSI back through 50, or `macd_hist` re-flips, or −1.5% adverse move
from fill — whichever first. One position per symbol, no adds, no averaging.

## Sizing & risk (non-negotiable)
- Per-trade notional = min(**$250 `MAX_TRADE_USD` env cap**, loop
  `config.maxTradeUsd`) × any regime `sizeMultiplier` for the symbol. The
  gate enforces the stricter-of automatically; the strategy must still SIZE
  to it rather than get blocked.
- SOXS leverage rule: treat SOXS notional as 3× exposure — cap SOXS intents
  at **$80 notional** so effective exposure stays inside the $250 gate spirit.
- Respect regime state: if the symbol carries a `blocked` override (NVDA is,
  as of 2026-07-06) or `risk_state.halted` is true, produce NO intent — a
  `risk_blocked` audit row is the gate doing its job, not a retry target.

## Execution & audit
- While `trading_enabled=false`, every intent mock-executes via DryRunAdapter
  at the real quote and MUST appear in `orders` with `status='dry_run'` and a
  `reason` naming this strategy, e.g.
  `reason: "leveraged_semiconductor_scalp — RSI 74.2 + hist flip -0.021"`.
- Review results with `npm run sim-report` before any calibration change.
- Nothing in this template authorizes arming. Going live is exclusively the
  operator's PIN-gated `setArmed` action, never a strategy decision.
