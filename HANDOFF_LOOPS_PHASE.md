# My Agent Factory — Handoff Prompt: Autonomous Loops + Phone + Robinhood

> **SUPERSEDED 2026-07-19:** Historical brief only. Live-broker and phone/SMS/voice integrations were removed. Current operation is paper simulation plus Telegram; follow `RUNBOOK.md`.

> Paste this whole file into a new chat as the opening message. It is written as instructions **to you, the next agent**. Build it as an elite senior engineer. Target: a working long-running autonomous system, ready to smoke-test by tomorrow.

---

## 0. Who you are / what this is

You are continuing **My Agent Factory** — a Next.js 16 + Supabase control room where a federation of AI "brains" run the user's work autonomously. The user (operator) is `ika` / `ikan9191@gmail.com`. You are the CEO brain (Claude, direct Anthropic `claude-sonnet-5`); **Codex** and **Hermes** are helper brains routed through OpenRouter.

This phase changes the paradigm: **from one-shot prompts to persistent LOOPS** — standing objectives the system re-evaluates on a cadence and on events, running many at once, reacting when news hits the markets, and acting through **agentic Robinhood**. The operator must be able to reach it **from their phone** (text, voice call, and mobile web).

### What already works (do NOT rebuild)
- Dashboard shell + sidebar nav: Control Room, Chat, App Building, Stock Trading, Research, Personal, Settings — all pages exist and route cleanly.
- Federated brains in `src/lib/agents/registry.ts` (`AgentRegistry.CLAUDE / CODEX / HERMES`), worker in `runner.ts`, fan-out + cross-debate in `src/lib/pipeline/parallel-matrix.ts`, pgvector memory.
- Voice chat via Web Speech API; `useConverse` hook (`src/hooks/use-converse.ts`) → `/api/converse` (Claude-CEO loop that can delegate + send email).
- **Email works**: Gmail SMTP via `nodemailer` in `src/lib/comms/email.ts` → `/api/comms/email` (Node runtime), every send audited to `outbound_messages`, rate-capped, optional approval gate via `COMMS_REQUIRE_APPROVAL`.
- Existing tables: `agents, tasks, logs, outbound_messages, staged_orders, system_bus, memory (pgvector)`.

### Stack & conventions
- Next.js 16 App Router + Turbopack, React 19, TypeScript, TanStack Query, Zustand, Tailwind, framer-motion.
- Supabase project: **`grtnjhwekvkyawacunde`** (the REAL one). **Never** touch `sxqdjilabbmjobjpwwst` — that was a stray Copilot artifact.
- API routes: `src/app/api/<name>/route.ts`, `NextRequest/NextResponse`, `zod` validation, `export const runtime = 'nodejs'` when Node APIs are used.
- Supabase clients: admin/service in `src/lib/supabase/admin.ts`, anon client for app. **RLS policies must target the `anon` role** or selects come back empty.
- Logger: `hermesLog(level, msg)` from `src/lib/hermes/hermes-logger.ts` → dashboard terminal.
- Dev server: `npm run dev` (port 9002).

---

## 1. Decisions already made by the operator (build to these)

1. **Trade execution = FULLY AUTONOMOUS within hard caps.** Loops place real Robinhood orders on their own, bounded by risk limits + a kill switch, and notify after. No per-trade approval required — but see §5, the safety layer is mandatory, not optional.
2. **No Alpaca, no paper trading.** Real Robinhood only, via the connected agentic Robinhood MCP.
3. **Phone access = all three:** two-way SMS, two-way voice calls, and a mobile-responsive dashboard.
4. Loops, not prompts. Many concurrent tasks. Event-driven switching on market news.

---

## 2. The mission for this phase

Build, in order (§8 has the day-by-day):
- **A. Loop Engine** — persistent, concurrent, cadence + event driven.
- **B. Event Bus + News/Market triggers** — news hits → loops react and switch.
- **C. Robinhood execution adapter** — through the agentic Robinhood MCP, behind a hard risk-gate layer + kill switch.
- **D. Phone I/O** — Twilio SMS two-way, voice-agent calls two-way, mobile-responsive dashboard.
- **E. Brains-in-loops** — Claude CEO orchestrates, delegates analysis to Codex (quant/technical) and Hermes (news/research), uses parallel-matrix + memory.

---

## 3. CRITICAL architecture reality — read before designing execution

**The running Next.js app cannot call Claude's MCP connectors.** The Robinhood MCP (`mcp__849e0f0c-...`) lives in the *agent* layer, not in a web request. So any action that must use the Robinhood MCP has to run inside a **Claude Agent SDK runtime**, not a normal API route.

Therefore the system splits into two long-running processes:

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│  Next.js app (Vercel)   │        │  Loop Worker  (always-on)     │
│  - dashboard / mobile   │        │  - tick scheduler + event bus │
│  - API routes           │◄──────►│  - runs loops concurrently    │
│  - phone webhooks       │  DB    │  - risk gates + kill switch   │
│  - reads/writes Supabase│ (RLS)  │  - calls Executor Agent ▼     │
└─────────────────────────┘        └───────────────┬──────────────┘
                                                    │ validated, risk-approved
                                                    ▼ order intent only
                                    ┌──────────────────────────────┐
                                    │  Executor Agent (Agent SDK)   │
                                    │  - ONLY thing touching broker │
                                    │  - Robinhood MCP mounted      │
                                    │  - places order, returns fill │
                                    └──────────────────────────────┘
```

- The **Loop Worker** is a dedicated Node process (`scripts/loop-worker.mts`, run with `tsx`). Host it always-on (the operator's machine to start, or Railway/Fly/Render later). Vercel Cron hitting `/api/loops/tick` is only a lightweight heartbeat backup — it can't do sub-minute or hold state.
- The **Executor Agent** is a thin Agent SDK service whose sole job: receive a fully-validated, risk-approved order intent and use the Robinhood MCP to place it. It never decides *whether* to trade — the Loop Worker already did, past the risk gates. Keep this boundary strict.
- Abstract all of this behind `ExecutionAdapter` (§4.C) so the Loop Worker doesn't care which backend runs. Ship `AgentBridgeAdapter` first (uses the connected MCP). A direct unofficial-API adapter is a fragile fallback — note ToS risk (see §5).

---

## 4. What to build

### A. Loop Engine (`src/lib/loops/`)

**Data model** (new Supabase tables — write a migration, target `anon` RLS):

```sql
-- a standing objective the system pursues continuously
create table loops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('trade','research','build','personal','monitor')),
  objective text not null,
  status text not null default 'paused' check (status in ('armed','paused','stopped')),
  cadence_seconds int,                 -- null = pure event-driven
  triggers jsonb not null default '[]',-- [{type,match}]  e.g. {type:'news',symbol:'NVDA',minSeverity:'high'}
  config jsonb not null default '{}',  -- symbols, strategy, per-loop caps
  brain text not null default 'claude',
  last_tick_at timestamptz,
  next_tick_at timestamptz,
  lock_owner text, lock_at timestamptz,-- stale-lock reaper pattern (reuse existing)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- every evaluation of a loop (full audit)
create table loop_runs (
  id uuid primary key default gen_random_uuid(),
  loop_id uuid references loops(id) on delete cascade,
  trigger jsonb, decision jsonb, actions jsonb, result jsonb,
  status text not null default 'running',
  error text,
  started_at timestamptz default now(), finished_at timestamptz
);

-- the event bus
create table events (
  id uuid primary key default gen_random_uuid(),
  type text not null,          -- 'news' | 'price' | 'earnings' | 'manual' | 'phone'
  symbol text, severity text,  -- 'low' | 'med' | 'high' | 'critical'
  payload jsonb not null default '{}',
  consumed bool default false,
  created_at timestamptz default now()
);

-- executed orders (staged_orders already exists for pending)
create table orders (
  id uuid primary key default gen_random_uuid(),
  loop_id uuid references loops(id) on delete set null,
  symbol text not null, side text not null, qty numeric, notional numeric,
  type text default 'market', limit_price numeric,
  status text not null default 'intent', -- intent|risk_blocked|dry_run|submitted|filled|rejected|canceled
  broker_id text, fill_price numeric, reason text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

-- single-row global risk/kill state
create table risk_state (
  id int primary key default 1,
  day date not null default current_date,
  realized_pnl numeric default 0,
  halted bool default false, halt_reason text,
  trading_enabled bool default false,  -- master arm; default OFF
  kill_switch bool default false,
  updated_at timestamptz default now()
);
insert into risk_state (id) values (1) on conflict do nothing;
```

**Engine** (`src/lib/loops/engine.ts`):
- `tick()`: select `armed` loops where `next_tick_at <= now()`, claim each with a lock (reuse the stale-lock reaper), run **concurrently** with a bounded pool (e.g. a small `pLimit(8)`), then set `next_tick_at = now + cadence_seconds`.
- `dispatchEvents()`: read `events where not consumed`, match each against every armed loop's `triggers`, enqueue immediate runs for matches, mark consumed.
- `runLoop(loop, trigger)`: assemble context (portfolio + quotes via adapter, matching news, pgvector memory) → ask the loop's brain for a **strict-JSON decision** (validate with zod) → for trade actions, pass through the **risk gate** (§5) → execute via `ExecutionAdapter` → write `loop_runs`, `orders`, `hermesLog`, and fire an SMS on any live order. Never let one exception kill the loop or the worker.

**Worker** (`scripts/loop-worker.mts`): loop forever — `dispatchEvents()` then `tick()` every `LOOP_TICK_MS` (default 5000), with graceful shutdown + a startup log. This is the always-on process.

**API + UI**:
- `src/app/api/loops/route.ts` (GET list, POST create), `.../loops/[id]/route.ts` (PATCH arm/pause/stop, DELETE), `.../loops/tick/route.ts` (cron heartbeat backup).
- New page `src/app/dashboard/loops/page.tsx` + add "Loops" to sidebar `NAV_ITEMS` in `src/app/dashboard/layout.tsx` (icon e.g. `Repeat` or `Infinity`). Show each loop's status, cadence, last decision, recent `loop_runs`; arm/pause/stop/kill controls. Prove it with a trivial `monitor` loop that just logs a heartbeat on cadence before wiring trading.

### B. Event Bus + News/Market triggers (`src/lib/events/`)
- `NewsFeed` interface (pluggable provider — pick a financial-news/headlines API; keep provider-agnostic). Poll every 15–60s (websocket if the provider supports it).
- For each headline: classify with a **fast** brain (Hermes or Codex, Haiku fallback) → `{ symbols[], sentiment, severity, actionable }`. Insert `events` rows.
- Market/price triggers: poll quotes (via the adapter's `getQuote`) and emit `price` events on threshold moves.
- This is the "switch when news hits" mechanism: a trade loop for NVDA with `triggers:[{type:'news',symbol:'NVDA',minSeverity:'high'}]` gets an immediate run and can flip strategy or act.

### C. Robinhood Execution Adapter (`src/lib/execution/`)
```ts
export interface ExecutionAdapter {
  getPortfolio(): Promise<Portfolio>;
  getQuote(symbol: string): Promise<Quote>;
  getPositions(): Promise<Position[]>;
  placeOrder(intent: OrderIntent): Promise<OrderResult>;
  cancelOrder(brokerId: string): Promise<void>;
}
```
- `AgentBridgeAdapter` (ship first): calls the **Executor Agent** (Agent SDK service with the Robinhood MCP `mcp__849e0f0c-...` mounted) to read portfolio/quotes and place orders. Robinhood MCP has `get_equity_quotes, get_portfolio, get_equity_positions, place_equity_order, place_option_order, review_equity_order, cancel_equity_order, get_equity_fundamentals, get_earnings_calendar`, etc. — use `review_equity_order` before `place_equity_order`.
- `DirectAdapter` (optional, fragile): unofficial Robinhood API with operator creds — flag ToS/lockout risk, gate behind explicit opt-in.

### D. Phone I/O (`src/app/api/phone/`, `src/lib/comms/`)
- **SMS two-way** (Twilio Programmable Messaging):
  - Inbound `POST /api/phone/sms` — **validate `X-Twilio-Signature`**, allowlist the sender number, parse a command grammar (`status`, `positions`, `arm`/`disarm`, `halt`/`kill`, `pnl`, `loops`, `ask <question>`), route to the loop engine / converse brain, reply TwiML `<Message>`.
  - Outbound `src/lib/comms/sms.ts` (Twilio REST) — notify on every live order, news `critical` events, daily P/L summary.
- **Voice two-way**: use a voice-agent provider (Vapi or Retell — handles STT/TTS/turn-taking) posting transcripts to `POST /api/phone/voice` → converse/loop brain → spoken reply. Support **outbound** calls on `critical` events ("news hit NVDA, want me to act?"). Twilio `<Gather>`+`<Say>` is an acceptable basic fallback.
- **Mobile web**: make the dashboard responsive (Tailwind breakpoints, touch targets), add a phone-friendly view of loops + a quick kill switch. PWA optional.
- **AUTH (mandatory):** caller/sender number allowlist (`OPERATOR_PHONE`) **and** a PIN (`OPERATOR_PIN`) required for any state-changing or trading command. These channels can move real money — treat them as privileged.

### E. Brains in loops
- Claude (you) = orchestrator; delegate technical/quant analysis to Codex, news/research to Hermes; use `parallel-matrix` for multi-angle + cross-debate and pgvector memory for history. Decisions returned as strict JSON, zod-validated, before any risk gate.

---

## 5. Safety layer — MANDATORY, non-negotiable

Real money, autonomous. Build every one of these; default to the safe setting.

- **Master arm defaults OFF.** `risk_state.trading_enabled=false` and env `TRADING_ENABLED=false` → all execution runs in **dry-run** (records `orders.status='dry_run'`, places nothing). Operator arms live explicitly (dashboard toggle + PIN, or SMS `arm <PIN>`).
- **Kill switch** (`risk_state.kill_switch`, env `KILL_SWITCH`) checked immediately before every order and at the top of every trade-loop run. When set: cancel-all + no new orders. Expose it one tap from the mobile dashboard and via SMS `kill`.
- **Hard caps** (env + per-loop `config`, enforce the stricter): `MAX_TRADE_USD` per order, max position size per symbol, `MAX_OPEN_POSITIONS`, total exposure cap, `DAILY_LOSS_LIMIT_USD` → auto-`halt` all trade loops for the day, orders/hour rate limit.
- **Symbol allowlist** (`SYMBOL_ALLOWLIST`) — only trade approved tickers.
- **Sanity checks**: reject if quote is stale or the intended price deviates > X% from last quote (fat-finger guard); respect market hours unless a loop opts in.
- **Full audit + notify**: every intent and execution to `orders` + `loop_runs`; SMS on every live fill.
- **Responsible-AI note to keep visible to the operator:** autonomous real-money trading can lose money fast; you (the agent) build the tooling and enforce the operator's pre-set caps, but you do **not** give personalized investment advice and you do **not** override the caps. Also flag: automated/unofficial Robinhood access may violate Robinhood's Terms and risk account restriction — the operator accepts that risk.

---

## 6. Env vars to add (`.env.local`)
```
# brains
OPENROUTER_API_KEY=            # fund it so Codex/Hermes stop falling back to Haiku
# loop engine
LOOP_TICK_MS=5000
TRADING_ENABLED=false
KILL_SWITCH=false
MAX_TRADE_USD=250
DAILY_LOSS_LIMIT_USD=500
MAX_OPEN_POSITIONS=5
SYMBOL_ALLOWLIST=AAPL,NVDA,MSFT,SPY
# news
NEWS_API_KEY=
# phone
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_NUMBER=
OPERATOR_PHONE=                # your mobile, allowlisted
OPERATOR_PIN=                  # required for arm/kill/trade via phone
VAPI_API_KEY=                  # or RETELL_API_KEY for voice
# email (already set)
GMAIL_USER=
GMAIL_APP_PASSWORD=
```

---

## 7. Gotchas / hard-won lessons in this codebase (save yourself hours)

- **Use the file API (Read/Write/Edit) for ALL source reads/writes.** The shell/mount corrupts files with NUL bytes — it recently made a perfectly healthy `package.json` look "invalid." Never trust bash `cat`/python reads for correctness and never write source through the shell. Bash is fine for `npm`, `ls`, `git status`.
- **Supabase project = `grtnjhwekvkyawacunde`.** Service key must match the URL's project. **RLS policies must target `anon`** (app uses the anon key) or every select returns empty.
- **The Next app can't call MCP connectors** — see §3. Anything agentic (Robinhood) runs in the Agent SDK executor layer.
- **Brains**: Claude CEO is direct Anthropic `claude-sonnet-5` (works). Codex/Hermes via OpenRouter need credits or they fall back to Haiku — there's `[BRAIN]` logging that surfaces the 402/404 reason. Fund OpenRouter to make them distinct.
- **git object writes fail in the sandbox** — the operator commits/deploys from their own machine. Hand them exact commit steps.
- **Don't fabricate success.** The DB is source of truth; query it honestly, report empty as empty.

---

## 8. Build order to be ready by tomorrow

- **Phase 0 — Foundation:** migration for `loops, loop_runs, events, orders, risk_state` (+ anon RLS); seed `risk_state`; add env scaffolding. Verify tables exist in `grtn`.
- **Phase 1 — Loop Engine:** `engine.ts` (tick + event dispatch, bounded concurrency, locks), `scripts/loop-worker.mts`, loops CRUD API, `/dashboard/loops` page + nav. **Proof:** a `monitor` loop heartbeats on cadence and writes `loop_runs`.
- **Phase 2 — Execution (dry-run):** `ExecutionAdapter` + `AgentBridgeAdapter` + Executor Agent (Robinhood MCP) + risk-gate module. Keep `TRADING_ENABLED=false`. **Proof:** a trade loop produces an intent → risk check → `dry_run` order → audit + SMS.
- **Phase 3 — Event switching:** `NewsFeed` + classifier → `events`; wire trade-loop triggers. **Proof:** a simulated `news`/`high` event immediately re-runs the loop and yields an order intent.
- **Phase 4 — Phone:** Twilio SMS inbound (signature + allowlist + PIN) with `status/arm/kill/positions/pnl/approve`, outbound alerts; then the voice-agent webhook; then mobile-responsive dashboard + one-tap kill.
- **Phase 5 — Go-live checklist:** arm with tiny caps during market hours; verify a real fill, the SMS notification, the kill switch halts everything, and the daily-loss auto-halt trips. Only widen caps after all four pass.

## 9. First actions in the new chat
1. Confirm the `grtn` Supabase project and list existing tables.
2. Write + apply the Phase 0 migration (anon RLS).
3. Scaffold `src/lib/loops/engine.ts` + `scripts/loop-worker.mts` and get a heartbeat `monitor` loop running end-to-end before anything touches a brokerage.
4. Keep `TRADING_ENABLED=false` until Phase 5.

Build tight, verify against the DB, and keep the safety layer honest.
