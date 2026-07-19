# My Agent Factory — Handoff: Phase 4B (Comms Bus — workable now, APIs later)

> **SUPERSEDED 2026-07-19:** Historical brief only. Twilio/Vapi/Retell and every phone route were removed. Telegram is the sole remote messaging channel; follow `RUNBOOK.md`.

> Paste into the chat that finished Phase 4A (or a new one). Written **to you, the next agent**. Continue as an elite senior engineer. Phases 0–4A are built and proven against `grtnjhwekvkyawacunde` — do not rebuild them.
>
> **Operator directive: build something fully workable NOW with no third-party credentials.** Twilio/Vapi keys come later. So build the command + notification layer **provider-agnostic**, ship a **built-in local transport + an in-dashboard SMS simulator** that exercises the *exact* code path the real SMS webhook will use, and prove the whole thing end-to-end today. Adding Twilio later must be a transport swap, **zero changes at the call sites.**

---

## 0. Ground truth (do not diverge)

- **Brains:** Claude CEO = direct Anthropic `claude-sonnet-5`; Codex/Hermes via OpenRouter (unfunded → Haiku fallback; deferred).
- **Supabase** `grtnjhwekvkyawacunde`; **RLS `anon`**; realtime on the loop tables. Tables: `loops, loop_runs, events, orders, risk_state, outbound_messages`.
- **Built & proven:** Loop engine + worker; Execution (`selectAdapter()` master-arm gated, `risk.ts` gate, Direct sidecar + Bridge/executor-agent) all dry-run while `trading_enabled=false`; News ingest + tighten-only Regime Controller (fail-closed); Mobile PWA (Results + Compose), control endpoints `risk-actions.ts` → `/api/control/{arm,kill,halt}` (PIN-gated, audited, SMS-notified, kill cancels open orders); existing **`sms.ts` stub** (logs + audits when Twilio absent, real send when present).
- **Auth/secrets:** middleware HMAC session + anon key; `OPERATOR_PIN` in `.env.local` (currently the auto-generated `552487` — treat as changeable; do not hardcode it anywhere).
- **Rules that bite:** file API for all source (shell mount corrupts with NUL bytes); `safeUpdate()` for DB writes (`PostgrestBuilder` has no `.catch()`); **`TRADING_ENABLED` stays `false`**; DB is source of truth — never fabricate; git object writes fail in-sandbox → operator commits.

---

## 1. Goal for this phase

A single **command + notification bus** that works today over a local transport and later over Twilio/Vapi with no call-site changes. Concretely:
1. One transport-agnostic **command core** (parse → authorize → execute → reply) shared by every channel.
2. One transport-agnostic **outbound notifier** so arm/kill/fill/critical alerts route through whatever transport is active.
3. A **LocalTransport** (default) that persists to `outbound_messages` and streams to the dashboard — so it's all real and visible now.
4. An **in-dashboard SMS simulator** that drives the real command core, proving the full grammar with no phone.
5. A coherent **watchable dry-run demo** tying loops → news/regime → dry-run orders → notifications, end-to-end, no money, no external APIs.

---

## 2. Build

### 2a. Command core — `src/lib/comms/command.ts` (channel-agnostic)
- `parseCommand(text): Command` and `runCommand(cmd, ctx): Promise<{ reply: string; mutated?: boolean }>`.
- Grammar (case-insensitive): `status`, `pnl`, `positions`, `loops`, `arm <PIN>`, `disarm <PIN>`, `kill`, `halt`, `resume <PIN>`, `new <objective>` (creates a loop), `pause <loopName|id>`, `help`.
- **Authorization inside the core, not the transport:** state-changing commands (`arm/disarm/kill/halt/resume/new/pause`) require a valid `OPERATOR_PIN`; read commands don't. Reuse the same PIN check as `risk-actions.ts`. Fail closed if `OPERATOR_PIN` is unset.
- `runCommand` calls the existing services (control endpoints/`risk.ts`, `POST /api/loops` logic, `selectAdapter()` for portfolio/positions) — it does **not** reimplement them. Returns a short SMS-length reply string.
- Every command + result audited to `logs`/`outbound_messages` via `safeUpdate()`.

### 2b. Outbound transport abstraction — `src/lib/comms/transport.ts`
```ts
export interface MessageTransport {
  name: 'local' | 'twilio';
  send(to: string, body: string, kind?: 'alert'|'reply'|'summary'): Promise<void>;
}
export function activeTransport(): MessageTransport // twilio if TWILIO_* present, else local
```
- `LocalTransport` (default): insert into `outbound_messages` (channel `'sms'`, status `'local'`) and rely on Realtime to surface it in the dashboard. **This is a real, inspectable delivery — not a no-op.**
- `TwilioTransport`: real Twilio REST send; only selected when `TWILIO_ACCOUNT_SID/AUTH_TOKEN/NUMBER` are set. Fold the existing `sms.ts` stub into this so there's one path.
- **Refactor every existing notify call (arm/kill/fill/critical) to go through `activeTransport().send()`** so the later Twilio swap needs zero call-site edits.

### 2c. Inbound endpoint (shell now, live later) — `src/app/api/phone/sms/route.ts`
- `POST` handler: when Twilio is configured, validate `X-Twilio-Signature`, enforce the **number allowlist** (`OPERATOR_PHONE`), then `runCommand(parseCommand(Body), ctx)` and reply TwiML `<Message>`. Until Twilio is configured it returns `501 not configured` (honest, not fake) — but the **command core it would call is already live and tested via the simulator.**

### 2d. In-dashboard SMS simulator — `/dashboard/comms` (+ nav, + mobile tab/"More")
- A phone-style console: a text input that POSTs to `POST /api/comms/simulate` → `runCommand()` (session-authed; treats the operator as the allowlisted sender) → shows the reply. Below it, a **live feed of `outbound_messages`** via Realtime (every notification + reply). This is the workable "SMS" today: type `status`, `arm 552487`, `new buy-the-dip on SPY when news is bearish`, `kill` — and watch the real system respond and notify.

### 2e. Coherent dry-run demo (the "workable now" payoff)
- A one-command/dev-seed path (`scripts/demo-seed.mts` or a Compose preset) that arms 1–2 `trade` loops on allowlist symbols with news triggers, so with the worker running the operator can watch: news ingest → regime flags → loop re-runs → `orders` land as `dry_run` at real quotes → notifications stream into `/dashboard/comms`. All with `TRADING_ENABLED=false`, no external APIs, no money.

---

## 3. Proof (verify in DB + on the running server)
1. From `/dashboard/comms`, run each command: `status`/`positions`/`loops` return real state; `arm <wrongPIN>` → rejected + logged; `arm <OPERATOR_PIN>` → `risk_state.trading_enabled` flips **only if the operator intends it** (for the proof, use `halt`/`resume` or a throwaway so you don't leave it armed) — prefer proving `kill`/`resume` and `new` to avoid touching `trading_enabled`; leave it `false`.
2. `new <objective>` creates a `loops` row (same schema as Compose) — confirm in DB.
3. Send a notification through `activeTransport()` (e.g. trigger the kill path) → row in `outbound_messages` with `name:'local'`, appears live in the comms feed.
4. Confirm `/api/phone/sms` returns `501` (not a fake success) while Twilio is unset, and that it will call the identical `runCommand` core once configured.
5. Run the demo seed with the worker → dry-run orders + streaming notifications visible; `TRADING_ENABLED` untouched.

---

## 4. Deferred (wire when the operator provides keys — no rework required)
- **4B-live SMS:** set `TWILIO_ACCOUNT_SID/AUTH_TOKEN/NUMBER` + `OPERATOR_PHONE` → `activeTransport()` auto-selects Twilio and `/api/phone/sms` goes live. Nothing else changes.
- **4C Voice:** `POST /api/phone/voice` maps a provider transcript to the same `runCommand`/converse core; outbound calls on `critical`. Needs `VAPI_API_KEY`/`RETELL_API_KEY`.
- **Phase 5 go-live checklist** (unchanged): tiny caps, market hours, verify real fill + SMS + kill + daily-loss auto-halt in the DB before widening.

## 5. Env
```
# none required for this phase. Later:
TWILIO_ACCOUNT_SID=  TWILIO_AUTH_TOKEN=  TWILIO_NUMBER=  OPERATOR_PHONE=
VAPI_API_KEY=        # or RETELL_API_KEY
# OPERATOR_PIN already set — operator should change it.
```

## 6. First actions
1. Build `command.ts` (parse/authorize/execute) and `transport.ts` (`LocalTransport` default), fold `sms.ts` into it, and refactor existing notify calls through `activeTransport()`.
2. Build `/dashboard/comms` simulator + `/api/comms/simulate`, and the `/api/phone/sms` shell (501 until configured).
3. Prove the full grammar + notification feed via the simulator, and the dry-run demo, against the DB.
4. Keep `TRADING_ENABLED=false`; report from the DB, not assumptions.

Build the entire bus so it's genuinely usable today over LocalTransport. The only thing a Twilio key should unlock later is the physical SMS pipe — every command, guard, and notification is already real and tested.
