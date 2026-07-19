# My Agent Factory — Handoff: Phase 4 → Finish Line (Mobile PWA, Phone, Go-Live)

> **SUPERSEDED 2026-07-19:** Historical brief only. Live-broker and phone/SMS/voice integrations were removed. Current operation is paper simulation plus Telegram; follow `RUNBOOK.md`.

> Paste into the chat that finished Phase 3 (or a new one). Written **to you, the next agent**. Continue as an elite senior engineer. Phases 0–3 are built and proven against `grtnjhwekvkyawacunde` — do not rebuild them. This is the run to the finish: get the operator full phone control, then go live safely.

---

## 0. Ground truth (do not diverge)

- **Brains:** Claude CEO = direct Anthropic `claude-sonnet-5`. Codex/Hermes via OpenRouter (still **unfunded → Haiku fallback**; functionally correct, not distinct — deferred, not your problem this phase).
- **Supabase** `grtnjhwekvkyawacunde`; **RLS targets `anon`**; realtime already enabled on the loop tables.
- **Tables:** `loops, loop_runs, events, orders, risk_state` (now with `regime, symbol_overrides, feed_degraded, feed_degraded_reason, regime_updated_at`).
- **Built & proven:** Loop Engine + worker (Phase 1); Execution — `ExecutionAdapter`/`selectAdapter()` master-arm gated, `risk.ts` gate (kill switch, halt, daily-loss auto-halt, allowlist, per-symbol `symbol_overrides`, max-trade, max-open, rate limit, stale/fat-finger, fail-closed), Direct sidecar + Bridge/executor-agent, `sms.ts` stub (Phase 2); News ingest + deterministic tighten-only Regime Controller, fail-closed on feed failure (Phase 3).
- **Dashboard** already has: Control Room, Chat, App Building, Stock Trading, Research, Personal, Settings, **Loops** (live via Realtime).
- **Auth:** middleware HMAC session cookie + anon Supabase key. `OPERATOR_PIN` exists for privileged actions.
- **Rules that bite:** use the **file API** (Read/Write/Edit) for all source — the shell mount corrupts files with NUL bytes. Use **`safeUpdate()`** for DB writes (`PostgrestBuilder` has no `.catch()`). **`TRADING_ENABLED` stays `false` until the Phase 5 go-live checklist.** DB is source of truth — never fabricate. git object writes fail in-sandbox → operator commits/deploys.

---

## 1. What "finish line" means (build toward this)

The operator runs the whole thing from their phone with minimal-to-zero interaction:
1. **See results** — live P&L, positions, today's orders, streaming loop runs, current regime/feed health.
2. **Send prompts / author + arm loops** — create, edit, arm, pause a loop from the phone.
3. **One-tap safety** — always-visible KILL and the master arm/disarm, PIN-gated.
4. Then the notification/command channels (SMS, voice) and the go-live checklist.

Priority order: **4A Mobile PWA (no credentials) → 4B SMS (Twilio) → 4C Voice (Vapi/Retell) → 5 Go-Live.** Do 4A fully before anything that needs a credential.

---

## 2. Phase 4A — Mobile PWA (build this first, in full)

### 2a. Make the dashboard responsive
- Sweep `src/app/dashboard/*` for fixed widths / desktop-only panels. Add Tailwind breakpoints; collapse the multi-panel Control Room into a stacked, swipeable mobile layout. Touch targets ≥ 44px.
- Add a **mobile bottom tab bar** (Results · Loops · Chat · More) that only shows < `md`; keep the desktop sidebar ≥ `md`.

### 2b. PWA installability
- `src/app/manifest.ts` (or `public/manifest.webmanifest`): name, short_name, `display:'standalone'`, theme/background colors matching the dark UI, icons (192/512 + maskable), `apple-touch-icon`. Set `viewport-fit=cover` and standalone meta for iOS.
- Service worker (`public/sw.js` + registration): **cache the app shell only.** **Never cache API/mutation responses or trading state.** Read-only data may use a short stale-while-revalidate; **all control endpoints require live network** (see fail-closed below). Provide an offline shell page.
- Add-to-Home-Screen hint on mobile first visit.

### 2c. Results view — `src/app/dashboard/(mobile)/results/page.tsx` (mobile-first)
Live via Supabase Realtime subscriptions on `orders`, `loop_runs`, `risk_state`:
- Header status chips: **regime** (`NORMAL/VOLATILE/CRITICAL_HALT`), **feed** health (degraded?), **armed?**, **halted?**.
- Today's realized/unrealized **P&L**, **open positions** (from the execution adapter's `getPositions()` / `getPortfolio()`), **today's `orders`** (status-colored), and a streaming **`loop_runs`** feed.
- **Sticky KILL button** (always visible) + **master Arm/Disarm** toggle. Both PIN-gated (§2e).

### 2d. Author view — `src/app/dashboard/(mobile)/compose/page.tsx`
Create/edit/arm a loop from the phone — this is "send our prompts/loops":
- Fields: `name`, `kind` (trade/research/build/personal/monitor), `objective` (free-text prompt), `cadence_seconds`, `triggers` (symbol + type + min severity builder), `config` (symbols, per-loop caps), `brain`.
- Actions → existing `POST /api/loops` (create) and `PATCH /api/loops/[id]` (arm/pause/stop). Validate with the same zod schema server-side. Optimistic UI + Realtime confirmation.

### 2e. Privileged-action gate + control endpoints
- New `POST /api/control/arm` (sets `risk_state.trading_enabled`), `POST /api/control/kill` (sets `risk_state.kill_switch` + triggers cancel-all), `POST /api/control/halt`. Each: session-authed **and** requires a correct `OPERATOR_PIN` in the body (defense-in-depth — a phone can be unlocked/stolen). Audit every call to `logs`/`outbound_messages` via `safeUpdate()`, and SMS-notify on arm/kill.
- **Fail-closed UX:** if the device is offline, **disable Arm** and show the KILL result honestly as "offline — could not confirm" rather than faking success. Never show a green state you didn't get from the server.

### 2f. Proof (verify in DB)
- Load Results + Author on a mobile viewport (or real phone); create + arm a loop from the phone → row appears in `loops`, Realtime updates the list.
- Hit KILL with the PIN → `risk_state.kill_switch=true`, cancel-all path runs, audit + SMS-stub fire; wrong PIN → rejected + logged.
- `TRADING_ENABLED` untouched.

---

## 3. Phase 4B — SMS two-way (needs `TWILIO_*`, `OPERATOR_PHONE`, `OPERATOR_PIN`)
- Inbound `POST /api/phone/sms`: validate `X-Twilio-Signature`, allowlist the sender number, require PIN for state changes. Commands: `status`, `pnl`, `positions`, `loops`, `arm <PIN>`, `disarm <PIN>`, `kill`, `new <objective>` (spins up a loop). Reply TwiML `<Message>`.
- Outbound (upgrade the existing `sms.ts` stub to real Twilio when configured): every **live** fill, `critical` news/regime shift, daily P/L summary.
- Proof: inbound `status` returns real state; `kill` from the allowlisted number halts; non-allowlisted number is ignored + logged.

## 4. Phase 4C — Voice two-way (needs Vapi or Retell)
- `POST /api/phone/voice`: provider posts transcript → converse/loop brain → spoken reply. Outbound call on `critical` events ("news hit NVDA, want me to act?"). Twilio `<Gather>/<Say>` is an acceptable basic fallback. Same allowlist + PIN for actions.

## 5. Phase 5 — Go-Live checklist (the actual finish line)
Only after 4A is solid. Flip live with **tiny caps** during market hours and verify **all four**, in the DB, before widening anything:
1. A real order **fills** through the chosen adapter (Direct sidecar or Bridge/executor-agent).
2. **SMS notification** fires on that fill.
3. **KILL switch** halts everything + cancels open orders.
4. **Daily-loss auto-halt** trips at the configured limit and blocks new orders.
Then, and only then, widen `MAX_TRADE_USD` / positions. Document the exact operator steps (start sidecar, start worker, arm from phone).

---

## 6. Env to add
```
# PWA needs none.
# 4B SMS
TWILIO_ACCOUNT_SID=  TWILIO_AUTH_TOKEN=  TWILIO_NUMBER=  OPERATOR_PHONE=  OPERATOR_PIN=
# 4C Voice
VAPI_API_KEY=            # or RETELL_API_KEY
# deferred: OPENROUTER_API_KEY (fund → distinct Codex/Hermes)
```

## 7. First actions
1. Responsive sweep of `dashboard/*` + PWA manifest + service worker (shell-only cache).
2. Build the mobile **Results** view (Realtime) and the **Author** view, plus `/api/control/{arm,kill,halt}` with PIN gating.
3. Prove create-loop-from-phone and PIN-gated KILL against the DB.
4. Keep `TRADING_ENABLED=false`. Report from the DB, not assumptions.

Build 4A end-to-end with **no** new credentials. Ask the operator for Twilio only when you reach 4B, Vapi/Retell only at 4C, and the go/no-go to arm live only at Phase 5.
