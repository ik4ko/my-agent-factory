# Omnigent Integration Plan

Status: **Phase 1 (dev, WSL2) is live and verified end-to-end, including a
resilience-hardening pass (§11) — hung-subprocess recovery, a tmux/runner
process-leak fix, concurrency safety, and non-blocking-mirror-under-outage
are all verified live. The REST-trigger gap is resolved (§4.3.1). The real
deploy test (§12) has not run — no hosting-provider account/credentials
exist in this environment; see the conversation for the open question on
how to proceed.** Phase 3 (agent web access) is a separate, narrower
feature; see its own section. §9–10 cover a
later hardening pass and the Omnigent sandbox question.

## 1. Why this exists

Today, if one brain (Claude/Grok/Gemini/Codex/…) wants to know what another
brain is doing, that visibility is *inferred* — read the `agents`/`tasks`/`logs`
tables in Supabase and reconstruct state. That works, but it's polling-shaped:
lag, no "the other agent just started X" push, and every consumer re-derives
the same picture independently.

Omnigent ([github.com/omnigent-ai/omnigent](https://github.com/omnigent-ai/omnigent),
Apache 2.0, alpha) is a real, actively-developed meta-harness with a
shared-session layer: agents publish what they're doing and other
agents/observers subscribe, instead of everyone re-reading a database. The
goal here is additive — give the brains *live mutual visibility* through that
layer. It does not replace Supabase (still the durable record of truth) or
Vercel (still hosting/deploy/cron).

## 2. Corrections to the original scaffold's assumptions

The first pass (scaffold-only) assumed "Omnigent has no native Windows
support — its runner must go through WSL2." Hands-on verification this pass
found a more precise picture:

- Omnigent **does** run natively on Windows for `omnigent server`, the web
  UI, and SDK-based harnesses (`claude-sdk`, `openai-agents`, etc.) —
  confirmed: installed via `uv tool install omnigent`, started the server,
  fetched its live OpenAPI schema, created/listed real sessions, all
  natively on this Windows machine.
- What's genuinely blocked on native Windows — confirmed by testing, not
  assumed — is **launching a runner to execute a real turn**: the server
  validates the host's workspace as a POSIX-style path (`must start with /`)
  at runner-launch time. A native Windows host's filesystem can never satisfy
  that check; a client-side override (a custom agent YAML with an explicit
  `workspace: /tmp/...`) does **not** help, because the check is against the
  host's own reported root, not anything the caller supplies. So WSL2 (or
  Linux/macOS) is genuinely required — for *runner execution* specifically,
  not for "Omnigent on Windows" broadly.
- A real, separate bug was also found and fixed along the way: Omnigent
  v0.4.0's Windows console output crashes on a Unicode checkmark under the
  default (non-UTF-8) Windows codepage, which manifested as an **infinite
  host-tunnel reconnect loop** misreported as a connection failure. Fix:
  `PYTHONIOENCODING=utf-8` / `PYTHONUTF8=1` set before the server/host
  daemon starts (must be set from the process's birth — a daemon already
  running under the bad encoding won't pick it up from a later `export`).

## 3. Phase 1 — what was actually built and verified live (dev, WSL2)

**Setup performed on this machine:**
- Installed a real Ubuntu 26.04 WSL2 distro (the only prior WSL2 entry was
  Docker Desktop's own internal VM) with Node 22, `uv`, `tmux`, `bubblewrap`.
- Installed Omnigent (`uv tool install omnigent`, v0.4.0) inside it.
- Configured a **Gateway** credential — not a Claude/Codex subscription
  login (none exists in a fresh WSL2 environment) — pointed at this
  project's existing `OPENROUTER_API_KEY`, stored via Omnigent's own
  `store_secret()` keychain-backed mechanism (`~/.omnigent/config.yaml`
  references it as `api_key_ref: keychain:openrouter`; the secret itself
  lives in Omnigent's own secret store, never in a config file). Two
  families configured: `anthropic` → `https://openrouter.ai/api`, `openai` →
  `https://openrouter.ai/api/v1` (`wire_api: chat`) — the exact base URLs
  this project's own README already documents for OpenRouter.
- Started `omnigent server` + registered this WSL2 instance as a `host`
  (`host=online`, confirmed via `omnigent host status`).
- Confirmed **WSL2's automatic localhost port-forwarding** works: the
  Windows-native Next.js dev server reaches `http://127.0.0.1:6767` (the
  WSL2-hosted server) exactly like any other external API — no
  `.wslconfig`/mirrored-networking changes were needed for this direction.

**What's real vs. what doesn't exist:** Omnigent's REST API has **no
generic "publish an arbitrary event" endpoint** — confirmed by fetching and
reading its actual OpenAPI schema (57 paths). A session's `/items` timeline
is only ever populated by a genuine runner-executed turn; the one
adjacent-looking endpoint (`POST /sessions/{id}/comments`) is a file-anchored
code-review comment, not a general event bus. So "publish an event" here
means: **trigger a short, real, cheap turn** that states what just happened,
via the `openai-agents` SDK harness (Gateway-routed, no separate CLI login
needed) — genuine execution and genuine visibility, not a simulation of
either. The mirror prompt is short and uses a cheap default model, so it
does not re-run the original (potentially expensive) task a second time.

**Wired:** `src/lib/omnigent/bridge.ts`'s `publishAgentEvent()` is called
from `dispatchAgent()` (`src/app/actions/agent-dispatcher.ts`) right after
its existing Supabase/log write. Gated behind `OMNIGENT_ENABLED=true` (unset
by default — true no-op everywhere this isn't explicitly turned on).

**UI surface:** `src/app/api/omnigent/activity/route.ts` (session-gated
proxy for `GET /v1/sessions` + the newest session's `/items`) and
`src/components/dashboard/omnigent-activity.tsx`, mounted as a new opt-in
`omnigent` pane in the Main Dashboard's `WorkspaceDeck` (hidden by default,
alongside Consensus/Tokens — bring it in from the tab strip). Deliberately
minimal, per the ask — not a finished surface.

**Verified live, end to end, in this exact order:**
1. Dispatched a real prompt through the actual app UI (Main Chat, GROK lane):
   *"In exactly 4 words, name a stock ETF."*
2. `dispatchAgent()` ran for real against OpenRouter and returned *"Vanguard
   S&P 500 ETF"* — visible in the app's own chat bubble.
3. `publishAgentEvent()` fired in the background, spawned into WSL2, and
   Omnigent's runner genuinely executed the mirror turn.
4. A **new, real Omnigent session** appeared (`GET /v1/sessions`), containing
   the exact real content: *"[MIRROR GROK] agent.task_completed — In exactly
   4 words, name a stock ETF. → Vanguard S&P 500 ETF"* → assistant reply
   *"Vanguard S&P 500 ETF"*.
5. The dashboard's new Omnigent pane, opened and maximized in a real browser
   session, rendered that exact exchange live — screenshot-confirmed, then
   discarded.

This is the complete loop the phase asked for: a real multi-agent-style
dispatch, reflected live, through Omnigent's actual shared-session layer, in
our own dashboard.

## 4. Phase 2 — Production-viable plan (review this before building it)

WSL2 is a local-dev workaround for the workspace-path issue in §2 — not a
hard ceiling. Omnigent's server deploys independently to Render, Railway,
Fly.io, Modal, Cloudflare, or a plain Docker Compose host
([`deploy/README.md`](https://github.com/omnigent-ai/omnigent/blob/main/deploy/README.md)).
This section is a plan, not an implementation — nothing below is wired up.

### 4.1 What a hosted Omnigent deployment actually needs

- **Compute**: the server's working set is ~512 MB–1 GB (Omnigent's own
  documented floor). Render Starter (512 MB) or Railway's usage-scaled tier
  clear it; a platform's smallest free tier often does not.
- **Database**: SQLite ("lite tier" — zero setup, single-instance, data on a
  persistent disk/volume) is enough at our volume (low-frequency mirror
  events, not a multi-instance production chat product). Postgres (a free
  Neon instance via [pg.new](https://pg.new)) is the safer choice if we ever
  want more than one server instance or managed backups — same schema
  either way, just a `DATABASE_URL` choice.
- **Auth**: Render/Railway deploys default to `OMNIGENT_AUTH_ENABLED=1` with
  Omnigent's own built-in accounts (an admin password minted on first boot,
  invite-only signup) or OIDC (Google/GitHub/Okta/Microsoft) if we want SSO.
  **This is a separate auth system from this app's own `DASHBOARD_PASSWORD`
  session cookie** — they don't share a login. Our Next.js backend calling
  the hosted server programmatically needs its **own** credential: an
  Omnigent API token (the same kind `omnigent login` mints for CLI use),
  stored as a new secret (e.g. `OMNIGENT_API_TOKEN`) alongside
  `OPENROUTER_API_KEY`/`SUPABASE_SERVICE_ROLE_KEY` in Vercel's env vars —
  architecturally nothing new, just one more secret to provision.
- **The runner still needs a persistent, POSIX host — and it can't be
  Vercel.** The runner "dials in to the server via `WS
  /v1/runner/tunnel`... executes the LLM loop + tools locally, streams
  events back" (Omnigent's own docs) — a long-lived connection. Vercel
  functions are stateless and ephemeral by design; they can be a **client**
  of the hosted server's REST API (exactly like they already call Supabase/
  OpenRouter/Yahoo today) but **cannot themselves be the runner**. The
  runner needs its own small, always-on process somewhere — a second cheap
  Render/Railway "worker" service, a small VPS, or (lowest infra cost,
  reintroduces the fragility hosting is supposed to remove) a persistent
  `omnigent host` on someone's always-on machine.

### 4.2 Proposed topology

```
Vercel (Next.js, stateless functions)
   │  HTTPS, bearer token (OMNIGENT_API_TOKEN)
   ▼
Omnigent SERVER — Render/Railway, small always-on instance, SQLite or Neon Postgres
   ▲  WS tunnel (persistent connection — cannot be Vercel)
   │
Omnigent RUNNER/HOST — a second small always-on process (Render worker / small VPS),
   Gateway credential → OpenRouter (same key this project already uses)

Supabase — unchanged, still the only durable store, still what the app reads for
persisted agents/tasks/logs state, in both dev and production.
```

### 4.3 What changes vs. what stays the same (one bridge, not two)

`src/lib/omnigent/bridge.ts`'s **public interface stays identical** in both
environments — `publishAgentEvent(event: OmnigentEvent): void`, fire-and-forget,
same event shape, same "never block or fail the caller" contract. Only the
**transport** underneath should differ, selected by config, not by having a
second file:

- **Dev (today)**: shell out through `wsl.exe` to the local `omnigent` CLI,
  which does its own session-create-and-run orchestration in one step.
- **Production — RESOLVED (continuation pass)**: a plain `fetch()` from
  Vercel to a thin wrapper service (`omnigent/wrapper/`), running on the
  same persistent host as the runner. **This closes the blocker below** —
  see §4.3.1.

#### 4.3.1 The REST-trigger blocker — resolved

The original open question: there's no pure-REST way to trigger a turn on an
already-registered runner, because `omnigent run` does session-create +
turn-kickoff together as one CLI-orchestrated flow, not two separable REST
calls. The resolution doesn't require Omnigent to expose a new endpoint —
it reframes the question: **the persistent host the runner already needs
(because Vercel can't hold its tunnel) isn't bound by Vercel's constraints
either, and can run the `omnigent` CLI directly.** So a thin wrapper
service on that same host — not Vercel, not a new REST API from Omnigent —
is the missing piece.

Built and **verified live**, not just reasoned about: `omnigent/wrapper/server.mjs`,
a dependency-free ~100-line Node HTTP server exposing one route,
`POST /trigger { harness, prompt, model? }` (bearer-token authenticated),
that shells out to `omnigent run --harness <harness> --server <url> -p
"<prompt>"` and returns the model's reply. Tested end-to-end in WSL2 (this
session's stand-in for "the persistent host"):

```
$ curl -X POST http://127.0.0.1:7900/trigger \
    -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
    -d '{"harness":"openai-agents","prompt":"reply with exactly: WRAPPER-TRIGGER-OK"}'
{"ok":true,"output":"WRAPPER-TRIGGER-OK"}
```

Independently confirmed via Omnigent's own `GET /v1/sessions` that this
single HTTP call produced a genuine new session with real content — not
just the wrapper self-reporting success. Auth rejection (no token, wrong
token) and the harness allowlist (`openai-agents`/`claude-sdk` only — the
SDK harnesses that need no separate CLI login) were also verified live.

**Revised architecture:**
```
Vercel (Next.js) ──HTTPS, bearer token──▶ omnigent-wrapper (persistent host)
                                              │  shells out to `omnigent run`
                                              ▼
                                          Omnigent server ◀──WS tunnel── same
                                          (Render/Railway/…)         host's runner
```
`bridge.ts`'s public interface (§4.3) is unaffected — only its production
transport branch changes, from "no implementation" to "`fetch()` the
wrapper's `/trigger` endpoint."

**Not yet done** (deliberately, per this pass's scope): the wrapper isn't
deployed anywhere. `omnigent/wrapper/Dockerfile` + `render.yaml` are a
reviewed-but-not-applied deploy config (see `omnigent/wrapper/README.md`) —
deploying to a real, billed host is a separate decision.

Everything else stays exactly as it is today: Supabase remains the only
durable store and the only thing read for persisted state; Vercel remains
hosting/deploy/cron unchanged; per-brain call independence (still true,
Omnigent only adds an observability event alongside each dispatch); the
`omnigent-activity.tsx` UI component and its proxy route need no changes —
they already just call a `GET /v1/sessions` style endpoint, which works
identically whether that endpoint is `127.0.0.1:6767` or a hosted URL.

### 4.4 Real blockers and costs — flagged for review, not assumed away

1. ~~The REST-trigger gap~~ — **resolved, §4.3.1.** The wrapper service
   closes this; no remaining unknown blocks a production
   `publishAgentEvent()` implementation.
2. **Cost**: roughly $7–20/mo for a minimal always-on topology (Omnigent
   server + the wrapper/runner-host, which can be the same or separate
   small instances), plus normal usage-based OpenRouter costs for the
   mirror turns themselves (kept low deliberately — short prompts, a cheap
   default model). This is a new recurring infra cost the current
   Supabase+Vercel-only setup doesn't have.
3. **Latency**: mirror events would cross the public internet
   (Vercel → wrapper → Omnigent server) instead of dev's local loopback —
   likely sub-second to a few seconds, not a hard blocker, but untested at
   production scale.
4. **The runner's own uptime is now a dependency.** If the runner-host
   process goes down, mirror events silently no-op (by design — never
   blocks a real dispatch) but cross-agent visibility goes dark until it's
   back. Needs monitoring if this becomes more than a nice-to-have.
5. **The wrapper is a new, custom piece of infrastructure this team now
   owns** — ~100 lines, no external dependencies, but still something to
   maintain, unlike calling a vendor's stable API. Worth weighing against
   the alternative of accepting Vercel-side latency/complexity some other
   way, though nothing simpler was found this pass.

**This section is a plan for review — no hosting account was created, no
production credential was provisioned, and no code was changed to add a
hosted-transport branch this pass.**

## 5. Relationship to the existing sandbox (Phase 3 below, not this section)

`src/lib/sandbox/runner.ts` is a small, already-audited, already-tested
allowlist sandbox (exact command allowlist, path confinement, scrubbed env).
Omnigent ships its own OS-level sandbox (bwrap on Linux, Seatbelt on macOS)
plus an egress proxy that injects credentials only on approved outbound
requests — the agent process itself never sees the raw key, only the proxy
does. Same credential-hygiene principle already used in `scrubbedEnv()`
(`src/lib/sandbox/policy.ts`), enforced one layer further out. See §Phase 3
for the concrete web-access-tool decision this pass made about it.

## 6. Files

| File | Status |
|---|---|
| `docs/omnigent-integration-plan.md` | this document |
| `omnigent/README.md` | WSL2 runner notes, networking, dev-only scope |
| `omnigent/bridge.config.example.json` | placeholder event-mapping config (superseded in spirit by the real `~/.omnigent/config.yaml` gateway config actually used — kept as illustrative reference) |
| `src/lib/omnigent/bridge.ts` | **live** — real mirror-publish implementation, wired into `dispatchAgent()` |
| `src/app/api/omnigent/activity/route.ts` | **live** — session-gated proxy for the dashboard pane |
| `src/components/dashboard/omnigent-activity.tsx` | **live** — minimal activity pane, opt-in in `WorkspaceDeck` |
| `omnigent/wrapper/server.mjs` | **prototyped and verified live** — the production REST-trigger resolution (§4.3.1); not deployed |
| `omnigent/wrapper/Dockerfile`, `render.yaml` | deploy-ready config for review — not applied to any host |
| `omnigent/wrapper/README.md` | wrapper usage/API/deploy notes |
| `docs/omnigent-sandbox-issue-draft.md` | drafted upstream bug report (§10) — not filed, no GitHub issue-creation access available |

## 7. Explicitly deferred to a follow-up session

1. ~~The production REST-trigger mechanism~~ — **resolved and verified live,
   §4.3.1.**
2. **Actually deploying** the wrapper or a hosted Omnigent server (no
   Render/Railway/Fly account was created this pass — `omnigent/wrapper/`
   is reviewed-but-not-applied config only).
3. **Provisioning `OMNIGENT_API_TOKEN`** (or equivalent) in Vercel once a
   hosted server exists.
4. **Extending `publishAgentEvent()` to `AgentRegistry.think()`/
   `runAgentWorker()` and the `/api/converse` CEO delegation loop** — Phase 1
   wired only `dispatchAgent()`; the other two brain-call sites don't
   publish yet.
5. **Monitoring for the runner-host's own uptime** (§4.4.4).

## 8. Safeguard confirmation

- `~/.omnigent/config.yaml` (inside WSL2) contains a `keychain:openrouter`
  *reference* only — no secret value in any config file.
- The actual key was transferred into Omnigent's own secret store via a
  one-shot script reading it from stdin/a temp file; the temp file was
  deleted immediately after.
- **Incident, disclosed rather than hidden:** during diagnosis, one
  debugging command (`cat -A ... | head -c 60`) printed roughly the first
  half of the real `OPENROUTER_API_KEY` into this session's context before
  the mistake was caught. The full key was never printed. As a precaution,
  **rotate `OPENROUTER_API_KEY`** regardless. All further verification in
  this pass switched to length/hash-only checks, no content dumps.
- `OMNIGENT_ENABLED` / `OMNIGENT_SERVER_URL` were added to `.env.local`
  (confirmed git-ignored) — not committed, not present in any file tracked
  by git.

## 9. `web_fetch` hardening (continuation pass)

The standalone `web_fetch` tool (`src/lib/sandbox/`) was hardened after this
plan's Phase 3 shipped it. Summary — full detail lives in the code:

- **DNS rebinding / SSRF**: `src/lib/sandbox/safe-fetch.ts` resolves and
  validates the connecting IP (`isDisallowedIp()` in `policy.ts`, covering
  private/loopback/link-local/CGNAT/multicast/reserved ranges for both IPv4
  and IPv6) via `https.Agent`'s `lookup` option — the exact DNS lookup that
  opens the real socket, not an earlier, race-able check. **Verified live**:
  a real hostname that genuinely resolves to `127.0.0.1` (a public wildcard-
  DNS test service) was rejected with `resolved to a disallowed IP:
  127.0.0.1`.
  - **Real bug found and fixed during this verification**: this Node
    version invokes the `lookup` callback with an *array* of candidate
    addresses (Happy Eyeballs dual-stack racing), not always a single
    address as first assumed. The initial implementation silently blocked
    *every* multi-address domain (a real availability bug, caught only by
    live-testing against `httpbin.org`, which returns 8 addresses) — fixed
    to check every candidate.
- **Redirects**: never followed — raw `https.request` (not global `fetch`)
  simply reports the 3xx status; nothing auto-follows. **Verified live**
  against `httpbin.org/redirect-to` pointing at a different host: got back
  a 302 with an empty body, confirmed the target's content was never
  fetched.
- **Response size cap**: now enforced *during* transfer (the response
  stream is destroyed the instant it exceeds the cap), not after
  downloading everything into memory first. **Verified live** against a
  real ~700KB response with a 50KB cap.
- **Content-type allowlist**: `text/html` / `application/json` /
  `text/plain` only; anything else is refused as soon as headers arrive,
  before any body bytes are read. **Verified live** against a real
  `image/png` response.
- **Rate limiting**: now scoped per key (agent id, from the calling task —
  see `src/app/api/tasks/execute/route.ts`), not a single global counter,
  so one agent's usage can't starve another's. **Verified** two independent
  keys don't share a budget.

## 10. Revisiting the Omnigent sandbox question (continuation pass)

Asked directly: can Omnigent's bwrap/egress-proxy sandbox be exercised
independently of the Phase 1 mirror mechanism? **Yes, tested — and it did
not engage.**

**What was tried, concretely:**
1. `omnigent run --harness codex --tools coding` (the one Omnigent invocation
   shape that's headlessly scriptable) with a prompt asking for `whoami`,
   `ls -la /`, and `cat /etc/shadow`. Result: real, unrestricted host access
   — the actual WSL2 root filesystem (`/mnt`, `/snap`, `/root`, real
   `/etc/shadow` contents). No sandbox.
2. Same test, this time with Omnigent's own
   `omnigent.policies.builtins.safety.enforce_sandbox` policy (found via the
   live `/v1/policy-registry` API) explicitly attached, `sandbox_type:
   linux_bwrap`. Same unrestricted result.
3. Same test again, using the exact `os_env.sandbox.type: linux_bwrap`
   structure shown in Omnigent's own bundled example agent
   (`examples/debby/agents/gpt/config.yaml`, which itself defaults to
   `sandbox: type: none` with a comment explaining that choice). Same
   unrestricted result — the real `/etc/shadow` was read and printed in
   full.
4. Isolated the variable: tested `bwrap` directly (independent of Omnigent)
   on this same WSL2 host — **it works fine**. So the sandbox binary itself
   isn't the problem; Omnigent did not actually invoke/apply it for any of
   the three configurations tried.

**Recommendation: stay on the standalone allowlisted `web_fetch` tool as
the actual production path.** Not because Omnigent's sandbox couldn't
possibly work — the native interactive `omnigent codex`/`omnigent claude`
tmux/PTY wrapper mode was not tested (it has no scriptable one-shot prompt
flag, making it fundamentally harder to verify reliably and repeatably) —
but because three reasonable, correctly-structured attempts through every
headlessly-testable path this pass could find did not produce a working
sandbox, while the standalone tool is hardened, verified, and already
running. Routing `web_fetch` through Omnigent later would trade a working,
understood, dependency-free tool for added latency (WSL2 bridge round-trip)
and a dependency on a subsystem that, in the one way it could actually be
exercised, did not verify — a worse trade, not a better one. If a future
session wants to revisit this, the concrete next step is confirming whether
sandboxing requires the native tmux-wrapped harness specifically (untested
here) rather than trying more `os_env`/policy permutations against the
SDK/scriptable path.

## 11. Wrapper resilience hardening (continuation pass — verified live)

`bridge.ts` now calls the wrapper over plain HTTP (`OMNIGENT_WRAPPER_URL` +
`OMNIGENT_WRAPPER_TOKEN`), replacing the earlier direct-`wsl.exe`-spawn
implementation — this is the "one bridge implementation" §4.3 called for,
now actually in place rather than just planned.

**Hung subprocess.** Node's built-in `spawn({timeout})` only signals the
*immediate* child; `omnigent run` fans out into its own process tree.
Rewrote with `detached: true` + `process.kill(-pid, 'SIGKILL')` (whole
process group). **Verified live**: forced a real hang (3s timeout against a
call that always takes longer), got a clean 502 back in exactly 3.01s —
never hung. A second, deeper, genuinely surprising finding from that same
test: **every `omnigent run -p` call — success, failure, or timeout — leaks
a `tmux` server** (it attaches a terminal view of the conversation as a side
effect; `tmux` deliberately calls `setsid()` to escape its parent's process
group, which is exactly why the process-group kill doesn't reach it, and
also killing that tmux server still leaves the underlying
`omnigent.runner._entry` process running independently). Fixed with two
periodic sweeps (not a per-request diff — verified live that races the
async, slightly-delayed tmux spawn and misses it): one reaps tmux servers
whose directory is older than 15s, one reaps orphaned runner processes
older than 120s (long enough that any request this wrapper legitimately
issues — short mirror calls only — has certainly already finished; wrong
assumption for a service issuing long-running or interactively-attached
sessions, correct for this one). Both **verified live**: pre-existing
leaked processes (minutes old, from earlier testing) were confirmed gone
within one sweep interval after the fix.

**Concurrency.** Fired 3 real concurrent `/trigger` calls. All three
completed correctly with their own distinct outputs (no cross-talk), in
~12s total (genuinely parallel, not 3×12s serialized), no corruption or
crash. **Conclusion: concurrent calls are safe as-is — no in-process queue
was added**, since one would only add complexity against a problem that
doesn't exist here (each `omnigent run` invocation is its own independent
session/runner, confirmed both by this test and by Phase 1's original
finding that every call gets its own unique `conv_`/`runner_` id).

**Non-blocking mirror — verified live, the important one.** With the
wrapper healthy: dispatched a real prompt through the actual app UI,
8226ms, real reply, real mirrored session confirmed via Omnigent's own API.
Killed the wrapper. Dispatched again: **8085ms — statistically identical,
same real reply.** The only trace of the failure anywhere was one server
log line: `[omnigent] mirror publish failed (non-fatal): fetch failed`. No
dashboard behavior changed at all.

**Health check**: `GET /health` already existed from the original
prototype: `{ "ok": true }`. Left simple by design — a liveness probe
should be fast and independent of whatever the trigger path is doing, not
itself shell out to `omnigent` or touch the same reap/queue state.

**Restart survival.** Two distinct scenarios, tested separately:
- Restarting *only* the wrapper's Node process: the Omnigent host daemon is
  a separate, independent process — unaffected, confirmed across many
  wrapper restarts during this session (`omnigent host status` stayed
  `host=online` throughout, same `host_id`, same daemon pid).
- Killing the host daemon itself (simulating a container/VM restart):
  goes to `host=offline` immediately, **with no auto-restart** — confirmed
  by directly killing it and observing it stay offline. Re-registering is a
  plain re-run of `omnigent host <url>`, which reuses the same `host_id`
  (just a new daemon pid) — but nothing does this automatically on its own.
  **`omnigent/wrapper/Dockerfile`'s `CMD` was updated** to supervise this
  with a `while true; do omnigent host "$URL"; sleep 2; done` loop instead
  of a one-shot background start, so a mid-lifetime host-connection crash
  self-heals without the whole container needing to restart.

## 12. Real deploy test — status

**Not yet run.** This needs an account on a real hosting provider
(Render/Railway/Fly for the wrapper+runner host) and this environment has
none — no API token, no CLI, no existing account artifacts found. Creating
one isn't something to do unilaterally (signup/verification, potential
billing). See the conversation for the specific question back to you on how
to proceed. `omnigent/wrapper/Dockerfile` + `render.yaml` remain the
reviewed-but-not-applied config from the previous pass, now updated with
the host-supervision fix above.
