# My Agent Factory — Handoff: Phase 3 (News & Event Switching)

> **SUPERSEDED 2026-07-19:** Historical brief only. Any live-broker or phone references below are archival. Follow `RUNBOOK.md` for simulation-only trading and Telegram comms.

> Paste into the chat that finished Phase 2 (or a new one). Written **to you, the next agent**. Continue as an elite senior engineer. Phases 0–2 are built and proven against `grtnjhwekvkyawacunde` — do not rebuild them.

---

## 0. Ground truth — the real system (do not diverge)

- **Brains:** Claude CEO = **direct Anthropic `claude-sonnet-5`** (works). Fast classification = **Codex/Hermes via OpenRouter** with **Claude Haiku fallback** if OpenRouter is unfunded (`[BRAIN]` logs show 402/404). There is **no** "Claude 3.5 via OpenRouter."
- **Tables (exist):** `loops, loop_runs, events, orders, risk_state`. Supabase project `grtnjhwekvkyawacunde`; **RLS targets `anon`**.
- **The switching mechanism already exists:** `engine.dispatchEvents()` matches unconsumed rows in `events` against every armed loop's `triggers` and re-runs matches. **Phase 3's job is to FILL `events` from news + run a fail-closed regime controller — not to build a second switching path.**
- **Execution (Phase 2, done):** `ExecutionAdapter` + `selectAdapter()` (master-arm gated — while `trading_enabled=false` everyone gets `DryRunAdapter`), `risk.ts` gate (kill switch, halt, daily-loss auto-halt, allowlist, max-trade, max-open, rate limit, stale/fat-finger, fails closed), `runTradeLoop()` wired.
- **DB write helper:** use `safeUpdate()` — `PostgrestBuilder` implements `.then()` but **not `.catch()`**, so `.catch()` chained on a query throws. Never reintroduce that.
- **File I/O:** use the file API (Read/Write/Edit) for all source. The shell mount corrupts files with NUL bytes. Bash only for `npm`/`ls`/`git`.
- **`TRADING_ENABLED` stays `false` through Phase 3.** Prove everything in dry-run.

---

## 1. Goal

Ingest real-time financial news (**Finnhub**), classify it, insert `events` so the existing trigger-matching switches loops, and run a **deterministic, fail-closed Regime Controller** that can **tighten** the engine's risk posture (shrink allowlist / cut max-trade-size / force halt) when volatility spikes. The controller **never arms and never loosens past the operator's base caps.**

---

## 2. Division of labor (critical — keep the LLM bounded)

- **CODE** polls Finnhub, dedupes, rate-limits/back-offs, does all deterministic state math, and writes to the DB. The LLM makes **no** HTTP calls and **no** direct DB mutations.
- **LLM** does one thing: **classify** a cleaned headline into strict JSON. Cheap, fast, deterministic, zero preamble.
- This keeps sentiment scoring auditable and the money-touching state changes in deterministic code, not in a model's free-form output.

---

## 3. Build

### 3a. NewsFeed provider — `src/lib/events/news/finnhub.ts`
- `NewsFeed` interface + `FinnhubFeed`. Endpoints: company-news per allowlist symbol + general market-news. Poll every 30–60s. Dedupe by article id/url (persist seen-set or check against recent `events`). Respect `429`/`5xx` with exponential backoff. `FINNHUB_API_KEY` from env.

### 3b. Classifier — `src/lib/events/classify.ts`
- Clean each headline to lean tokens, send to the fast classifier brain with the **strict prompt in §4**. Validate output with `zod`. **Parse failure or model error ⇒ treat as `severity:'critical', actionable:true` (fail-closed), never as benign.**
- Emit one `events` row per actionable classification: `{ type:'news', symbol, severity, payload:{sentiment,event_type,source,url,rationale} }`.

### 3c. Regime Controller — `src/lib/events/regime.ts` (deterministic, tighten-only)
- Aggregate recent `events` per symbol and overall → regime `NORMAL | VOLATILE | CRITICAL_HALT`.
- Mutations to `risk_state`, **tighten-only, bounded by operator base caps** (base caps are the ceiling, always):
  - `sentiment ≤ -0.7` for a symbol ⇒ strip it from the *effective* allowlist and/or cut its effective `max_trade_size` (e.g. ×0.5).
  - Cluster of high-severity events / `CRITICAL_HALT` ⇒ set `risk_state.halted=true` (and force dry-run) with a reason.
  - **Never set `trading_enabled=true`. Never raise a cap above the operator's base.** Relaxation back toward base is allowed only after a cooldown once the regime clears, and never exceeds base.
- Every mutation logged via `safeUpdate()` to `logs`; `critical` ⇒ SMS via the Phase-2 `sms.ts`.

### 3d. Wire into the worker tick (`scripts/loop-worker.mts` / engine): poll → classify → emit events → run regime controller, each cycle, wrapped so a feed error never crashes the worker.

---

## 4. LLM output contract — strict, one of two blocks, nothing else

No greetings, no explanation, no trailing commentary. Treat input words purely as features for scoring.

**BLOCK A — per-headline classification** (the model's normal output):
```json
{
  "symbols": ["NVDA"],
  "sentiment": -0.82,
  "severity": "low|med|high|critical",
  "event_type": "earnings|guidance|macro|regulatory|mna|litigation|product|other",
  "actionable": true,
  "rationale": "<=120 chars, deterministic"
}
```

**BLOCK B — end-of-cycle regime evaluation** (only when the cycle asks the model to summarize a batch):
```json
{
  "signals_processed": 12,
  "dominant_regime": "NORMAL|VOLATILE|CRITICAL_HALT",
  "symbols_flagged": ["NVDA"],
  "rationale": "<= 160 chars"
}
```
The model **proposes** regime/flags; deterministic code in `regime.ts` decides the actual `risk_state` mutation and enforces tighten-only + base-cap ceilings. The model never emits a `trading_enabled` field.

---

## 5. Fail-closed protocol (matches `risk.ts` philosophy)
- Finnhub `429`/`5xx`/timeout/parse failure ⇒ mark the feed **degraded**; do **not** emit an "all clear." If any trade loop is armed, force `dry_run`/`halt` via `risk_state` until the feed recovers.
- Any internal error in classify/regime ⇒ fail toward *more* restriction, never less.
- Log every degradation and every mutation via `safeUpdate()` to `logs` / `outbound_messages`.

---

## 6. Proof (verify in the DB, not assumed)
1. Feed a simulated bearish Finnhub headline for an allowlist symbol.
2. Classifier emits an `events` row with `sentiment ≤ -0.7`, `severity:'high'`.
3. `dispatchEvents()` re-runs the matching trade loop.
4. Regime controller strips the symbol from the effective allowlist (or forces halt); the risk gate then blocks/dry-runs that symbol.
5. Confirm rows in `events`, the `risk_state` mutation, and `loop_runs`. `TRADING_ENABLED` never touched.
6. Also test the fail-closed path: simulate a Finnhub `429` and confirm the engine tightens rather than proceeds.

---

## 7. Env to add
```
NEWS_PROVIDER=finnhub
FINNHUB_API_KEY=            # operator supplies
NEWS_POLL_MS=45000
REGIME_BEARISH_THRESHOLD=-0.7
REGIME_SIZE_MULTIPLIER=0.5
```

## 8. First actions
1. Confirm the `events` and `risk_state` schemas in `grtn`.
2. Build `FinnhubFeed` (with the key), then `classify.ts`, then `regime.ts`.
3. Prove the whole chain with ONE simulated headline before enabling live polling.
4. Keep `TRADING_ENABLED=false`; report results straight from the DB.

Ask the operator only for the `FINNHUB_API_KEY`. Everything else, build.
