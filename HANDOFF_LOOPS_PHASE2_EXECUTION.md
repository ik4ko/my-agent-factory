# My Agent Factory — Handoff: Phase 2+ (Execution, Autonomy, Phone)

> Paste this into the chat that just finished Phase 0/1 (or a new one). Written **to you, the next agent**. Continue as an elite senior engineer. Phase 0/1 are already built and proven against the real `grtnjhwekvkyawacunde` Supabase project — do not rebuild them.

---

## 0. Where we are (done, proven — don't redo)
- Migration `20260705_loops_engine_foundation.sql`: `loops, loop_runs, events, orders, risk_state` tables, anon-read RLS, realtime publication; `risk_state` seeded `trading_enabled=false`.
- `src/lib/loops/engine.ts`: `tick()` (optimistic lock claim, bounded-concurrency pool, cadence reschedule), `dispatchEvents()` (matches unconsumed `events` to armed loops' `triggers`), `runLoop()` (full `loop_runs` audit; `monitor` heartbeats; other kinds call the loop's brain via `AgentRegistry` for a decision — **no execution wired yet, by design**).
- `scripts/loop-worker.mts` (always-on, `npm run loop-worker`, graceful shutdown).
- API: `/api/loops` (list/create), `/api/loops/[id]` (arm/pause/stop/delete), `/api/loops/tick` (CRON_SECRET-gated, middleware-exempt).
- Dashboard: `/dashboard/loops` live via Supabase Realtime.
- Proven: heartbeat loop ticked twice 10s apart, locks released, `next_tick_at` advanced, logs written, endpoints 200. Verified in DB, not assumed.

---

## 1. Operator decisions — build to these exactly

**Execution path — preference order (implement the abstraction, then both backends):**
1. **In-app / Direct (PREFERRED):** Robinhood executes from inside the system, no separate chat session required. Because Robinhood has no official REST API and no maintained TS client, the robust "in-app" path is a **local `robin_stocks` (Python) sidecar** the app calls over `127.0.0.1` — same host, fully owned by the system, handles login/MFA/device-token. This is "inside the app" for all practical purposes.
2. **Signal → Claude → agentic Robinhood (FALLBACK):** if the operator would rather not store brokerage creds in-app, the app writes an **order-intent signal** to the DB; a separate **Executor Agent** (Claude Agent SDK process with the Robinhood MCP `mcp__849e0f0c-…` mounted) picks it up and places the order, writing the fill back. Use this when Direct isn't available.

Build `ExecutionAdapter` so the Loop Engine is backend-agnostic. Auto-select: if the `robin_stocks` sidecar is reachable and authenticated → Direct; else → AgentBridge; else → dry-run.

**Autonomy = "arm once, run continuously."** Goal is minimal-to-zero human interaction. So there is **no per-trade approval** — but there is a single deliberate, durable go-live: the operator flips `risk_state.trading_enabled=true` once (from the phone), and from then on loops trade on their own within the caps until the kill switch is hit or a limit auto-halts them. Autonomy lives *inside* the guardrails, never instead of them.

**Phone = primary control surface.** The operator wants to (a) **see results** — P&L, positions, live loop runs — and (b) **send prompts / author + arm loops** from their phone. So the **mobile-responsive dashboard (PWA)** is the priority build; SMS + voice are secondary notification/command channels.

---

## 2. Phase 2 — Execution (`src/lib/execution/`)

### 2a. The adapter
```ts
export interface OrderIntent {
  loopId: string; symbol: string; side: 'buy'|'sell';
  qty?: number; notional?: number; type?: 'market'|'limit'; limitPrice?: number;
  reason: string;
}
export interface ExecutionAdapter {
  name: 'direct'|'bridge'|'dryrun';
  isReady(): Promise<boolean>;
  getPortfolio(): Promise<Portfolio>;
  getQuote(symbol: string): Promise<Quote>;
  getPositions(): Promise<Position[]>;
  placeOrder(intent: OrderIntent): Promise<OrderResult>;   // returns brokerId + fill
  cancelOrder(brokerId: string): Promise<void>;
}
export async function selectAdapter(): Promise<ExecutionAdapter> // direct → bridge → dryrun
```

### 2b. DirectAdapter + `robin_stocks` sidecar (preferred)
- New service `services/robinhood/` — a tiny FastAPI (Python) app wrapping `robin_stocks`: `GET /health`, `/portfolio`, `/positions`, `/quote/{sym}`, `POST /order` (`review` then place), `POST /cancel`. Bind to `127.0.0.1:PORT` only. Auth login once, cache the device token/session to disk so it survives restarts; surface MFA on first run.
- `DirectAdapter` calls that localhost service. Never expose the sidecar publicly; never put creds in the Next app — they live in the sidecar's own env.
- Run it alongside the loop worker (same host). Add `npm run rh-sidecar` (spawns the Python service) or document `uvicorn`.

### 2c. AgentBridgeAdapter (fallback: app → Claude → agentic Robinhood)
- App-side: `placeOrder` writes an `orders` row `status='intent'` (the **signal**) and returns immediately; the loop run records it as pending.
- Executor Agent (`scripts/executor-agent.mts`, Claude Agent SDK, Robinhood MCP mounted): subscribes/polls `orders where status='intent'`, claims one (optimistic lock), calls `review_equity_order` then `place_equity_order` via the MCP, writes back `status`, `broker_id`, `fill_price`, `reason`. It **never decides whether to trade** — the Loop Engine already cleared risk. Idempotent by `orders.id`.
- This is the "send signal to Claude, Claude sends to agentic AI inside Robinhood" path, decoupled through the DB so it survives across sessions.

### 2d. Risk gate (`src/lib/execution/risk.ts`) — runs BEFORE any adapter call
Enforce all of §5. On block → write `orders.status='risk_blocked'` with reason, log, and (if severe) SMS. Wire the gate into `engine.runLoop()` for `kind='trade'` decisions. Keep `TRADING_ENABLED=false` through Phase 2 → everything records `status='dry_run'`, nothing is placed. Prove the whole path in dry-run first.

**Phase 2 proof:** a `trade` loop emits a decision → risk gate passes → `orders` row `dry_run` → `loop_runs` + log + SMS-stub. Verify in DB.

---

## 3. Phase 3 — News/market event switching (`src/lib/events/`)
- `NewsFeed` interface, one pluggable provider (needs `NEWS_API_KEY`); poll 15–60s.
- Classify each headline with a fast brain (Hermes/Codex, Haiku fallback) → `{symbols[], sentiment, severity, actionable}` → insert `events`.
- Price triggers: poll `adapter.getQuote` on watched symbols, emit `price` events on threshold moves.
- Effect: a trade loop with `triggers:[{type:'news',symbol:'NVDA',minSeverity:'high'}]` gets an immediate re-run the instant relevant news lands, and switches/acts. **Proof:** inject a simulated `news/high` event → loop re-runs within a tick → order intent produced.

---

## 4. Phase 4 — Phone (mobile PWA first)
- **Mobile dashboard (priority):** make `/dashboard/*` fully responsive (Tailwind breakpoints, ≥44px touch targets); add a PWA manifest + installability. Two mobile-first surfaces:
  - **Results view:** live P&L, open positions, today's `orders`, streaming `loop_runs`, and a big always-visible **KILL** button + the **arm/disarm** master toggle (PIN-gated).
  - **Author view:** create/edit/arm a loop from the phone — name, kind, objective (free-text prompt), cadence, triggers, symbols, per-loop caps. This is "send our prompts/loops from my phone."
- **SMS two-way** (Twilio; `TWILIO_*`, `OPERATOR_PHONE`, `OPERATOR_PIN`): inbound `POST /api/phone/sms` (validate `X-Twilio-Signature` + number allowlist + PIN for state changes) with `status/pnl/positions/loops/arm/disarm/kill/new <objective>`; outbound `src/lib/comms/sms.ts` alerts on every live fill, `critical` news, daily summary.
- **Voice two-way** (Vapi or Retell): `POST /api/phone/voice` webhook → converse/loop brain → spoken reply; outbound call on `critical` events. Basic Twilio `<Gather>/<Say>` acceptable fallback. Same allowlist + PIN.

---

## 5. Safety layer — MANDATORY (autonomy lives inside this)
- **Master arm** `risk_state.trading_enabled` defaults **false** → dry-run. One deliberate durable flip to go live; persists across restarts (that's the "arm once" model). No per-trade approval after that.
- **Kill switch** `risk_state.kill_switch` (+ env `KILL_SWITCH`) checked immediately before every order and at the top of every trade run → cancel-all, no new orders. One tap on mobile + SMS `kill`.
- **Hard caps** (env + per-loop `config`, stricter wins): `MAX_TRADE_USD`, per-symbol max, `MAX_OPEN_POSITIONS`, total-exposure cap, `DAILY_LOSS_LIMIT_USD` → auto-halt all trade loops for the day, orders/hour rate limit.
- **Symbol allowlist** `SYMBOL_ALLOWLIST`.
- **Sanity guards:** reject stale quotes / price deviation > X% (fat-finger); respect market hours unless the loop opts in.
- **Audit + notify:** every intent + fill to `orders`/`loop_runs`; SMS on every live order.
- **Keep visible to the operator:** autonomous real-money trading can lose money quickly; you build the tooling and enforce the operator's pre-set caps, you do **not** give personalized investment advice, and you do **not** silently widen or bypass caps. Flag clearly: the unofficial Robinhood API path may violate Robinhood's Terms and risk account restriction — the operator accepts that risk when choosing Direct.

---

## 6. Env to add
```
# execution
ROBINHOOD_SIDECAR_URL=http://127.0.0.1:8787   # Direct
TRADING_ENABLED=false
KILL_SWITCH=false
MAX_TRADE_USD=250
DAILY_LOSS_LIMIT_USD=500
MAX_OPEN_POSITIONS=5
SYMBOL_ALLOWLIST=AAPL,NVDA,MSFT,SPY
# sidecar's OWN env (services/robinhood/.env — never in the Next app):
#   RH_USERNAME=  RH_PASSWORD=  RH_MFA_SECRET=
# news / phone / brains
NEWS_API_KEY=
TWILIO_ACCOUNT_SID=  TWILIO_AUTH_TOKEN=  TWILIO_NUMBER=  OPERATOR_PHONE=  OPERATOR_PIN=
VAPI_API_KEY=            # or RETELL_API_KEY
OPENROUTER_API_KEY=      # fund so Codex/Hermes stop falling back to Haiku
```

## 7. Carry-forward gotchas
- **Use the file API (Read/Write/Edit) for ALL source I/O.** The shell mount corrupts files with NUL bytes (it once made a healthy `package.json` look invalid). Bash only for `npm`/`ls`/`git`.
- Supabase = **`grtnjhwekvkyawacunde`**; service key must match; **RLS policies target `anon`**.
- The Next app **cannot call MCP connectors** — that's exactly why the Bridge path goes through a DB signal + a separate Agent SDK Executor.
- Claude CEO = direct Anthropic `claude-sonnet-5` (works); Codex/Hermes via OpenRouter need credits or fall back to Haiku (`[BRAIN]` logs show the 402/404).
- git object writes fail in the sandbox → operator commits/deploys from their machine; hand them exact steps.
- DB is source of truth — never fabricate results.

## 8. Build order + first actions
1. `ExecutionAdapter` + `selectAdapter()` + `DryRunAdapter`; wire the risk gate into `runLoop()` for `kind='trade'`. Prove dry-run end-to-end.
2. Build the `robin_stocks` sidecar + `DirectAdapter`; health-check + `getQuote` live (still `TRADING_ENABLED=false`).
3. `AgentBridgeAdapter` + `scripts/executor-agent.mts` (order-intent signal → MCP execute → fill back), also dry-run-safe.
4. Phase 3 news/event switching.
5. Phase 4 mobile PWA (results + author), then SMS, then voice.
6. Phase 5 go-live: arm with tiny caps in market hours; verify a real fill, the SMS, the kill switch, and the daily-loss auto-halt — widen caps only after all four pass.

**Ask the operator only for what you can't proceed without:** which execution path to stand up first (Direct sidecar vs Bridge), plus the credentials for whichever phase you're on (Robinhood login / news key / Twilio / Vapi). Everything else, build.
