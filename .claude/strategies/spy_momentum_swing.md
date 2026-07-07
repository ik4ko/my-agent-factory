# Strategy: SPY Momentum Swing (IV-filtered MA crossover)

Multi-hour to multi-day momentum swing on SPY. Trend signal from moving-average
crossover; implied volatility acts as a size/veto filter, never as an entry
trigger. All intents flow through the mandatory risk gate and are audit-logged
to `orders`.

## Signal logic
1. **Trend trigger — MA crossover.** The local feed's MACD line is exactly the
   EMA(12)/EMA(26) spread, so use it as the crossover: `macd` crossing above
   `macd_signal` = bullish trigger; crossing below = bearish. Confirm with
   RSI(14) in the 45–65 band — momentum without exhaustion. RSI > 70 at
   trigger time voids the entry (chasing).
2. **IV filter — regime sizing, not timing.** Pull SPY near-the-money IV from
   the broker option chain (Robinhood MCP `get_option_chains`, read-only)
   during `/research-sync`:
   - IV rank low/normal → full size.
   - IV elevated (roughly >1.5× its 1-month norm) → half size.
   - IV spiking with `risk_state.regime` at VOLATILE/CRITICAL_HALT → no trade.
     The regime controller usually gets there first; agree with it.

Exit: opposite MACD/signal cross, RSI > 75, or −2% adverse from fill —
whichever first. Swings may hold overnight; re-validate each session open
against a fresh `/research-sync` digest.

## Sizing & risk (non-negotiable)
- Per-trade notional = min(**$250 `MAX_TRADE_USD` env cap**, loop
  `config.maxTradeUsd`) × regime `sizeMultiplier` × the IV filter above. Size
  to the cap up front; a `risk_blocked` row means the sizing math was wrong.
- One SPY position at a time. `MAX_OPEN_POSITIONS=5` is portfolio-wide — this
  strategy claims at most one slot.
- If `risk_state.halted` is true or SPY carries a `blocked` override, produce
  no intent and note why in the decision log.

## Execution & audit
- While `trading_enabled=false`, every intent mock-executes via DryRunAdapter
  and MUST land in `orders` with `status='dry_run'` and a `reason` naming this
  strategy, e.g. `reason: "spy_momentum_swing — MACD cross ↑ 0.042, RSI 57, IV normal"`.
- Track dry-run PnL with `npm run sim-report`; a calibration change needs at
  least 10 audited dry-run entries behind it.
- Arming is the operator's PIN-gated action only. This template never
  escalates from analysis to live execution on its own.
