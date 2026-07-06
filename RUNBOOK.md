# Operator Runbook — My Agent Factory

This is the copy-pasteable reference for running the loop engine, arming/
disarming/killing it, reading what it did, and recovering from an incident.
Keep `TRADING_ENABLED=false` until you have deliberately decided otherwise —
see **Go-Live checklist** below.

---

## 1. Start order

Three processes, in this order:

```bash
# 1. (Optional, Direct execution only) Robinhood sidecar — holds the real
#    brokerage session. Skip entirely if you're staying on dry-run/Bridge.
cd services/robinhood
.venv/Scripts/activate      # or `source .venv/bin/activate`
uvicorn main:app --host 127.0.0.1 --port 8787

# 2. Loop worker — the always-on process that actually ticks loops, polls
#    news, runs the regime controller. Nothing moves without this running.
npm run loop-worker

# 3. (Optional, Bridge execution only) Executor agent — polls orders with
#    status='intent' and drives them through the Robinhood MCP.
npm run executor-agent

# 4. The app itself
npm run dev          # or: npm run build && npm start
```

You can develop/inspect with just #4 running — loops simply won't tick.
`/api/loops/tick` (Vercel Cron) is a lightweight heartbeat backup for when
#2 isn't running; it can't hold state or do sub-minute cadence, so don't
rely on it as the primary driver.

---

## 2. Arm / disarm / kill

**From the phone (once Twilio is configured — see §6):** text the number:

| Command | Effect |
|---|---|
| `status` | regime, armed/disarmed, kill state, halt state, feed health, adapter |
| `pnl` | today's realized P&L |
| `positions` | open positions from whichever adapter is live |
| `loops` | all loops with kind/status |
| `arm <PIN>` | **flips trading_enabled=true — loops start placing real orders** |
| `disarm <PIN>` | back to dry-run |
| `kill <PIN>` | cancels every open order, blocks all new ones until released |
| `halt <PIN>` | manual halt (blocks new orders, doesn't cancel existing) |
| `resume <PIN>` | clears halt AND releases kill (does not change armed state) |
| `new <PIN> <objective>` | creates a paused `trade` loop with that objective |
| `pause <PIN> <name or id>` | pauses a specific loop |
| `help` | lists all of the above |

**Today, without Twilio:** open `/dashboard/comms` — it's the identical
command core, no phone needed. Type the same commands into the console.

**One-tap safety:** `/dashboard/results` and `/dashboard/golive` both have a
sticky **Kill** button and an **Arm/Disarm** toggle, PIN-gated. Kill works no
matter what else is going on. Arm is blocked entirely if `OPERATOR_PIN` is
unset or still the generated default (`552487`) — change it first.

**Change your PIN:** edit `OPERATOR_PIN` in `.env.local` (and redeploy if
hosted). There's no in-app PIN-change flow yet — it's an env var.

---

## 3. What every alert means

Every notification lands in `outbound_messages` (visible live at
`/dashboard/comms`) and is logged to `logs`. Bodies you'll see:

- `⚠️ TRADING ARMED by <actor>...` — the master switch flipped on. From now
  on, armed trade loops place real orders within their caps, no approval.
- `Trading disarmed by <actor>...` — back to dry-run.
- `🛑 KILL SWITCH engaged by <actor>. N open order(s) canceled...` — kill
  tripped; investigate before releasing it.
- `[loop-name] BUY/SELL SYMBOL → filled/submitted @ $X...` — a real fill (or
  a submitted order awaiting fill). Dry-run orders never send this — only
  live ones.
- `CRITICAL_HALT triggered — [REGIME] ...` — the regime controller detected a
  severe news cluster and halted automatically. This is NOT the daily-loss
  halt; it clears on its own after a cooldown once the news cluster clears
  (see `src/lib/events/regime.ts`), or you can `resume <PIN>` it early.
- `[REGIME] news feed degraded...` — Finnhub is failing; any armed trade
  loop gets halted until the feed recovers (fail-closed, not fail-open).

---

## 4. Reading `orders` and `loop_runs`

- **`orders.status`**: `intent` (queued for the executor-agent, Bridge path
  only) → `risk_blocked` (the risk gate said no — see `reason`) →
  `dry_run` (recorded, nothing placed — TRADING_ENABLED is false) →
  `submitted`/`filled` (real) → `rejected`/`canceled`.
- **`loop_runs`**: one row per evaluation of a loop, either on its cadence or
  triggered by a matching event. `decision` is the brain's raw output,
  `actions` is what it tried to do, `result` is what actually happened.
  `trigger` is null for a cadence tick, or the `events` row that fired it.
- **`risk_state`** (singleton, id=1): the one row that gates everything —
  `trading_enabled`, `kill_switch`, `halted`/`halt_reason`, `regime`,
  `symbol_overrides` (regime-controller tightening), `feed_degraded`.

Quick queries (via the Supabase SQL editor or MCP):
```sql
select * from risk_state;
select * from orders order by created_at desc limit 20;
select l.name, lr.* from loop_runs lr join loops l on l.id = lr.loop_id order by lr.started_at desc limit 20;
```

---

## 5. Incident response

1. **Kill first, ask questions later.** `/dashboard/results` → Kill, or text
   `kill <PIN>`, or `/dashboard/comms` → `kill <PIN>`. This cancels every
   open order and blocks new ones — it does NOT disarm (trading_enabled
   stays whatever it was), so releasing kill alone will resume live trading
   if still armed. If in doubt, also `disarm <PIN>`.
2. **Investigate**: read `orders`, `loop_runs`, `logs` (search for
   `[RISK]`, `[REGIME]`, `[CONTROL]`, `[EXECUTOR]`) for what happened and
   why. Check `risk_state.halt_reason` if halted.
3. **Fix the root cause** (bad loop config, a code bug, a stuck feed) before
   resuming anything.
4. **Reset baseline**: `resume <PIN>` clears halt + kill (not arm). Confirm
   `risk_state` looks sane (`select * from risk_state;`) before re-arming.
   **Known gap**: `resume` does NOT clear per-symbol `symbol_overrides` set
   by the regime controller — a symbol individually blocked for bearish news
   stays blocked until its own cooldown elapses (needs the worker running)
   or you clear it manually: `update risk_state set symbol_overrides = '{}' where id = 1;`.
5. **Re-run the safety harness** (`npm run verify-safety`) after any change
   to risk gate / kill switch / daily-loss logic, before arming again. Run it
   with the loop worker stopped (or expect real live news to occasionally
   interact with the test — it snapshots/restores risk_state around itself,
   but a concurrent worker can still legitimately halt things mid-run).

---

## 6. Go-Live checklist (the actual finish line)

1. Open `/dashboard/golive`. Preflight must be all-green (a `warn` is fine
   to proceed with eyes open; any `fail` blocks arming entirely).
2. Run the selftest button (or `npm run verify-safety`) — all 4 checks pass.
3. Set a real, private `OPERATOR_PIN` (not `552487`).
4. Arm from `/dashboard/golive` — PIN + the explicit "this trades real
   money" confirmation. Do this during market hours with tiny caps
   (`MAX_TRADE_USD`, `MAX_OPEN_POSITIONS` small).
5. Verify, in the DB, all four of: a real fill, the SMS/notification firing,
   the kill switch actually halting everything, and the daily-loss auto-halt
   tripping at the configured limit (you can force this the same way
   `verify-safety` does, deliberately, once — see
   `src/lib/golive/selftest.ts` `checkDailyLossHalt`).
6. Only widen caps after all four pass for real, not just in dry-run.

### 6b. SMS-live smoke test (once TWILIO_ACCOUNT_SID/AUTH_TOKEN/NUMBER + OPERATOR_PHONE are set)

`activeTransport()` auto-selects Twilio the moment those three env vars are
all set — no code changes. Then:

1. **Inbound**: text `status` from `OPERATOR_PHONE` to `TWILIO_NUMBER` →
   confirm you get a real-state reply (not a canned string) and a `logs`
   row `[COMMAND] sms:+1...: status`.
2. **Outbound alert**: trigger any notify() path (e.g. `kill <PIN>` via SMS)
   → confirm a real SMS arrives on your phone and `outbound_messages` shows
   `status='sent'` with a `provider_id`.
3. **Allowlist rejection**: text from any OTHER number → confirm you get
   "not authorized" back and a `logs` row `[SMS] inbound rejected — sender
   ... not on the allowlist`. No command executes.

---

## 7. Commit & deploy

Git object writes fail inside this sandbox — the operator runs these from
their own machine:

```bash
git add -A
git commit -m "describe the change"
git push
```

Then redeploy however this is hosted (Vercel: push to the connected branch,
or `vercel deploy --prod`). Remember to set every env var from `.env.local`
in the hosting provider's environment settings too — `.env.local` is
gitignored and never deployed automatically.

---

## 8. Env reference

See `.env.local` for the full list with current values. The ones that
change behavior meaningfully:

- `TRADING_ENABLED` / `risk_state.trading_enabled` — the master arm. Only
  `/api/control/arm` (via `setArmed()`) writes this — verified by the
  preflight's static single-writer guard.
- `KILL_SWITCH` (env) is an additional hard override on top of
  `risk_state.kill_switch` — set it in the hosting environment if you ever
  need a kill that survives even a DB write failure.
- `OPERATOR_PIN` — required for every state-changing command/control
  action. Arm specifically is blocked if this is unset or still `552487`.
- `MAX_TRADE_USD`, `DAILY_LOSS_LIMIT_USD`, `MAX_OPEN_POSITIONS`,
  `SYMBOL_ALLOWLIST` — the hard caps. A loop's own `config` can only narrow
  these, never widen them (stricter of the two always wins).
