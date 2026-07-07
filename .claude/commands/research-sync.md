---
description: Ingest local indicator state + Robinhood account limits into one compact digest before analyzing market conditions
---

The operator said "Research & Sync" (or ran /research-sync). Build ONE compact situational digest, then stop and await direction. Keep total output under ~60 lines — no token bloom, no extra commentary.

1. **Local engine state** — run:

   ```
   npx tsx scripts/research-sync.mts
   ```

   Reproduce its markdown digest verbatim (risk posture, caps, live RSI/MACD indicators from the port-8765 socket, loops, last order audit rows). If the socket section reports offline, note that `python -m core.runner` must be running for live indicators and move on.

2. **Robinhood account (read-only)** — via the Robinhood MCP, call `get_accounts` (buying power) and `get_equity_positions` (open positions). Append a section:

   ```
   ## Robinhood ($650 account)
   - buying power: $X · positions: N
   - <SYMBOL> qty @ avg-cost → market value, unrealized P/L   (one line each)
   ```

   If the MCP is unavailable, say so in one line — do not retry more than once.

3. **Close with the safety line** (always, verbatim):

   > Posture: trading_enabled=<value> — order intents are risk-gated (max $<MAX_TRADE_USD>/trade) and audit-logged to `orders`; while disarmed everything lands as `dry_run`. No order is placed, staged, or modified without an explicit operator instruction naming symbol, side, and size.

Rules: all MCP calls in this command are READ-ONLY — never call any place/cancel/modify order tool from this command. Do not analyze or recommend trades yet; the digest is context for whatever the operator asks next.
