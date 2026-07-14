# My Agent Factory — Handoff: Phase 5 (Go-Live Readiness) → 6 → 7

> Paste into the chat that finished Phase 4B (or a new one). Written **to you, the next agent**. Continue as an elite senior engineer. Phases 0–4B are built and proven against `grtnjhwekvkyawacunde` — do not rebuild them.
>
> **Operator directive: build Phase 5 completely NOW with no third-party credentials.** Phase 7 (live trading cutover) is the final key-gated switch.
> **UPDATE 2026-07-14: Phase 6 (SMS/voice) is PERMANENTLY OUT OF SCOPE — an operator decision, not a deferral. Do not build, key, or roadmap it. The Telegram watcher (omnigent/wrapper/watcher.mjs) is the operator's mobile channel; the built Twilio transport code stays as-is, unkeyed and dead.**

---

## 0. Ground truth (do not diverge)

- **Brains:** Claude CEO = direct Anthropic `claude-sonnet-5`; Codex/Hermes via OpenRouter (unfunded → Haiku fallback; deferred).
- **Supabase** `grtnjhwekvkyawacunde`; **RLS `anon`**; realtime on loop tables. Tables: `loops, loop_runs, events, orders, risk_state, outbound_messages`.
- **Built & proven:** Loop engine + worker; Execution (`selectAdapter()` master-arm gated, `risk.ts` gate, Direct sidecar + Bridge/executor-agent) — all dry-run while `trading_enabled=false`; News ingest + tighten-only Regime Controller (fail-closed); Mobile PWA (Results + Compose); control endpoints `risk-actions.ts` → `/api/control/{arm,kill,halt}` (PIN-gated, audited, notify on arm/kill, kill cancels open orders); **Comms bus** — `command.ts` (parse/run, PIN-first grammar), `transport.ts` (`LocalTransport` default via `notify()`, `TwilioTransport` folded in, `activeTransport()` auto-selects), `/dashboard/comms` simulator, `/api/phone/sms` honest `501` shell, `scripts/demo-seed.mts` (2 armed dry-run trade loops). Two fixes already in: `ORDER_INTENT` line emitted first (600-token budget), `formatTriggerNote()` passes real headline/sentiment to the brain.
- **Secrets:** `OPERATOR_PIN` in `.env.local` is the auto-generated `552487` — **treat the default as unsafe (see §2e).**
- **Rules that bite:** file API for all source (shell mount corrupts with NUL bytes); `safeUpdate()` for DB writes; **`TRADING_ENABLED` stays `false` this entire phase**; DB is source of truth — never fabricate; git object writes fail in-sandbox → operator commits.

---

## 1. Goal — make going live a single safe, reversible switch

Everything that must be true *before* real money moves should be **machine-checked and one-tap**, and the four life-safety behaviors should be **provable on demand in dry-run**. When the operator later adds credentials and flips arm, there should be no guesswork.

---

## 2. Phase 5 build (all credential-free)

### 2a. Preflight checker — `src/lib/golive/preflight.ts` + `/api/golive/preflight` + surfaced on a Go-Live page
Return a red/green checklist with reasons. Checks (each `pass|warn|fail` + detail):
- DB reachable; `risk_state` singleton present and internally consistent.
- Which `ExecutionAdapter` `selectAdapter()` would pick (`dryrun|direct|bridge`) and whether that backend is actually reachable.
- Caps configured and sane: `MAX_TRADE_USD`, `DAILY_LOSS_LIMIT_USD`, `MAX_OPEN_POSITIONS`, `SYMBOL_ALLOWLIST` non-empty.
- Kill switch reachable and currently released; `halted=false`; `feed_degraded=false`.
- Worker heartbeat fresh (recent `loop_runs` / a heartbeat row within N× tick).
- Notification transport resolves (`local` or `twilio`) and a test `notify()` lands in `outbound_messages`.
- `OPERATOR_PIN` set **and not the default `552487`** → `fail` (blocks arm) if unset, `warn`/`fail` if default (see §2e).
- Static guard: grep confirms **nothing sets `trading_enabled=true` except the explicit `/api/control/arm` path.**

### 2b. Safety-verification harness — `scripts/verify-safety.mts` + `/api/golive/selftest`
Automate the four go-live checks **in dry-run/simulation**, each emitting pass/fail with DB evidence. Must be non-destructive and self-cleaning (throwaway loop, reset `risk_state` after):
1. **Fill path:** synthetic decision → `OrderIntent` → risk gate passes → adapter records `dry_run` order at a real quote → `orders` + `loop_runs` rows correct. (Live, this is a real fill; here it proves the plumbing.)
2. **Notification:** that order/fill fires `notify()` → `outbound_messages` row.
3. **Kill:** engage kill → verify new intents are blocked, cancel-all path invoked, then release and confirm recovery.
4. **Daily-loss auto-halt:** set `risk_state.realized_pnl` past `DAILY_LOSS_LIMIT_USD` in a sandboxed way → verify `halt` engages and blocks new orders → reset.
Leave `TRADING_ENABLED=false` and `risk_state` at a clean `NORMAL` baseline afterward.

### 2c. Go-Live cockpit — `/dashboard/golive` (mobile-friendly)
- Renders live preflight + last selftest results (red/green), current caps, adapter, regime/feed health.
- **Master Arm** is **disabled unless preflight is all-green**; arming requires PIN + an explicit "I understand this trades real money within these caps: …" confirmation summarizing exactly what will happen. Big always-visible KILL. A "Run selftest" button.
- This is the operator's single screen for the final switch — reachable from the phone.

### 2d. Operator runbook — `RUNBOOK.md`
Exact, copy-pasteable: start order (Robinhood sidecar → loop worker → app), how to arm/disarm/kill from phone and from `/dashboard/comms`, what every alert means, how to read `orders`/`loop_runs`, rollback + incident steps (kill → investigate → reset baseline), and the commit/deploy steps (operator runs them; git writes fail in-sandbox).

### 2e. Hardening pass (do all)
- **Default-PIN lockout:** if `OPERATOR_PIN` is unset or equals `552487`, block arm entirely and surface a loud preflight `fail`.
- Arm is impossible while preflight is red; kill works even mid-loop-run; control endpoints rate-limited.
- Re-verify fail-closed everywhere (feed errors, adapter errors, parse errors → tighten/halt, never proceed).
- Confirm the single-writer rule for `trading_enabled` (only `/api/control/arm`).

### 2f. Proof (verify in DB + running server)
- `/api/golive/preflight` returns green except the intentional default-PIN `fail`; set a non-default PIN → all green.
- `scripts/verify-safety.mts` passes all four checks with DB evidence, and leaves `TRADING_ENABLED=false` + `risk_state` clean.
- `/dashboard/golive` renders; Arm stays disabled while preflight red, enabled+confirm-gated when green (do **not** actually arm live).

---

## 3. Phase 6 — ~~Live channels~~ PERMANENTLY OUT OF SCOPE (operator decision, 2026-07-14)
Do not implement, key, or carry forward. Telegram (watcher.mjs) is the mobile channel. Historical scope, for the record only:
- ~~**SMS-live:** with `TWILIO_ACCOUNT_SID/AUTH_TOKEN/NUMBER` + `OPERATOR_PHONE`, `activeTransport()` auto-selects Twilio and `/api/phone/sms` goes live — no call-site changes.~~
- ~~**Voice:** `POST /api/phone/voice` maps a provider transcript → the same `runCommand`/converse core.~~

## 4. Phase 7 — Live trading cutover (keys + operator go/no-go)
- **UPDATE 2026-07-14: Robinhood's OFFICIAL MCP server is available and already connected in the agent layer (the `mcp__849e0f0c-…` toolset — `get_portfolio`, `review_equity_order`, `place_equity_order`, …). Use it as the Bridge path's MCP; the unofficial `robin_stocks` Direct sidecar and its ToS/lockout risk are obsolete.**
- Stand up execution: **Direct** = authenticate the `robin_stocks` sidecar (handle MFA/device token, cache session); **Bridge** = configure the executor-agent's own MCP endpoint (`EXECUTOR_ROBINHOOD_MCP_URL/_COMMAND`).
- Then: **operator flips arm from the Go-Live cockpit with tiny caps during market hours**, and you **rerun the §2b harness LIVE** — a real fill, real SMS, real kill, real daily-loss halt, all verified in the DB. Widen caps only after all four pass live. This is the finish line.

## 5. Env
```
# Phase 5: none. Later:
TWILIO_ACCOUNT_SID=  TWILIO_AUTH_TOKEN=  TWILIO_NUMBER=  OPERATOR_PHONE=
VAPI_API_KEY=        # or RETELL_API_KEY
# Direct: sidecar's own env (RH_USERNAME/RH_PASSWORD/RH_MFA_SECRET) — never in the Next app
# Bridge: EXECUTOR_ROBINHOOD_MCP_URL / EXECUTOR_ROBINHOOD_MCP_COMMAND
# OPERATOR_PIN — operator must change from 552487.
```

## 6. First actions
1. Build `preflight.ts` + `/api/golive/preflight`, then `verify-safety.mts` + `/api/golive/selftest`.
2. Build `/dashboard/golive` (arm disabled until green, PIN + confirm) and add it to nav.
3. Write `RUNBOOK.md`; do the §2e hardening (default-PIN lockout first).
4. Prove §2f against the DB. Keep `TRADING_ENABLED=false`. Report from the DB, not assumptions.

Deliver Phase 5 so that "go live" is one green-gated, PIN-confirmed tap — and so the four things that keep real money safe are provable on demand. Ask the operator only for a real `OPERATOR_PIN` (and, when they reach 6/7, the channel/broker credentials).
