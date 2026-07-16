# Autonomous Loop Engine — Implementation Spec

**Status:** Design-complete, zero code written. This document is the complete
brief — treat it as the only context you have; do not assume access to any
prior conversation.

**What this is:** a human-gated orchestration engine that lets Claude Code
and OpenAI Codex (both authenticated via their own $20/mo subscription CLI
login — `claude`, `codex`) do real, autonomous, multi-step coding sprints on
`my-agent-factory`, with one non-negotiable rule: **neither CLI may ever
launch without a specific, immediately-preceding human approval action.**
Grok (and any other metered-API-billed brain) is exempt from that rule and
should be used for continuous, unattended review work precisely because it
carries no subscription-account risk.

**What this is not:** this does not touch, replace, or duplicate the
existing `brain-matrix.ts` / `agent-dispatcher.ts` system already live in
this repo (CLAUDE and CODEX lanes there are direct-metered-API chat brains
for the dashboard's Main Chat — fast, cheap, per-token). That system and
this one are deliberately parallel: light/fast/interactive work stays on
metered API brains; heavy, real, multi-file coding sprints go through this
gated CLI engine. Do not merge them, rename either to resolve the naming
overlap, or assume one supersedes the other.

---

## 0. Audit before building anything

This codebase already has infrastructure this engine must extend, not
duplicate. Confirm each of these before writing a line of new code, and
report what you find:

1. **Telegram bot already exists and is live** — `omnigent/wrapper/watcher.mjs`
   (or wherever it now lives) runs a long-polling `getUpdates` loop, gated by
   an operator-chat-id allowlist checked first on every update, with
   `update_id` claimed in Supabase `system_bus` before any action fires
   (proven live against replay and a hostile flipped-action replay — both
   blocked, zero side effects). **Extend this bot with `callback_query`
   handling for inline buttons; do not stand up a second bot or a second
   polling loop.** Long-polling was a deliberate choice (survives Render
   spin-down/restart cycles, no inbound URL/cert needed) — do not switch to
   webhooks. Where the source spec below calls for a "webhook secret token,"
   that requirement does not apply to a polling architecture; the
   equivalent defense-in-depth is the existing double allowlist check
   (once on the raw update, again inside the callback handler) plus the
   proven `update_id` dedupe claim, now applied to callback data too.

2. **`loops` table / `src/lib/loops/engine.ts` may already exist.** Read
   them. If they already model a generic task-state-machine, extend that
   schema/module for this engine's states rather than creating a parallel
   one. If what's there is specific to the trading/market loop system (not
   a generic state machine), build this engine's persistence as its own
   table, clearly named, and say so explicitly rather than silently
   colliding names.

3. **Process-cleanup discipline already exists and was hard-won.** The
   Omnigent wrapper (`omnigent/wrapper/server.mjs`) already solved "a CLI
   subprocess leaks a `tmux` server on every invocation, and process-group
   SIGKILL doesn't reach it because `tmux` calls `setsid()` to escape its
   parent's process group" — fixed with `detached: true` +
   `process.kill(-pid, 'SIGKILL')` plus periodic sweeps for orphaned
   processes. **Reuse this exact pattern for `claude`/`codex` child
   processes** — do not re-derive it from scratch, and specifically test
   for the same class of escaped-subprocess leak before declaring the E-STOP
   path complete.

4. **The approval-callback's stale/replay rejection should mirror
   `action-order`'s existing pattern**: a CAS-guarded update predicated on
   the loop's *current* state (only accept an approval callback if the loop
   is actually `AWAITING_APPROVAL` for that exact gate id), returning a
   clear rejection — not a silent drop — for a callback against a task no
   longer in that state. This is the same shape already proven live for
   staged-order approve/deny.

5. **This engine must run on the persistent Render host, not Vercel.**
   Vercel functions are stateless/ephemeral and cannot hold a spawned CLI
   child process or a long-lived poll loop — this was already established
   during the Omnigent wrapper build for the identical reason (a runner
   needs a persistent POSIX process). Run this as a new supervised process
   alongside `server.mjs`/`watcher.mjs` on that same host, following its
   existing supervision pattern (`while true; do …; sleep N; done`-style
   restart-on-crash), not as a new Vercel API route.

6. **Verify real CLI invocation syntax before writing any spawn code.**
   Run `claude --help` and `codex --help` (or equivalent) against the
   actually-installed versions and confirm the real non-interactive /
   headless invocation flags, working-directory behavior, and how each
   reports structured completion (exit code, stdout shape) — do not assume
   flags from memory or documentation that may be stale.

---

## 1. Non-negotiable constraints

- **Account-safety boundary.** The engine spawns already-authenticated
  `claude`/`codex` CLI binaries as child processes via their own official
  local login. It never reads, extracts, stores, or proxies any credential,
  session cookie, or token belonging to either tool. If a CLI reports "not
  logged in," the engine fails loud with an actionable message — it never
  attempts to authenticate on the user's behalf.
- **One approval, one launch.** No CLI process for Claude Code or Codex may
  start without an explicit human Telegram approval action *immediately*
  preceding that specific launch. No timers, no auto-continue between
  sprints, no "approve all remaining steps," no default-approve on timeout.
  Every individual handoff gets its own tap.
- **Grok (or other metered-API brains) are unrestricted** — no approval
  gate, may run continuously. Route as much continuous cross-checking work
  to Grok as the pipeline allows, specifically because it carries none of
  the subscription-account risk the gate exists to prevent.
- **Gates mark real handoffs, not routine in-sprint actions.** A single
  file edit or test run inside an active Claude Code sprint is already
  governed by Claude Code's own permission mode — do not add a redundant
  Telegram gate for that. A gate exists only at genuine tool/agent
  boundaries (e.g., "Claude Code's sprint is done, hand off to Codex,"
  "Codex's sprint is done, ready to merge"). The number of gates in a given
  task is whatever the real handoff count is — never compressed for a
  velocity/autonomy metric, never split for false granularity.
- **E-STOP interrupts from any state.** Wire this engine into the existing
  E-STOP control (`/api/control/emergency-stop` or equivalent — confirm
  the real route in step 0) rather than building a second kill mechanism.
  E-STOP sends SIGTERM to the active child process group, escalates to
  SIGKILL after a grace period, and transitions the loop to `ABORTED`
  regardless of which state it was in.

---

## 2. State machine

States: `IDLE`, `CLAUDE_RUNNING`, `AWAITING_APPROVAL`, `CODEX_RUNNING`,
`DONE`, `ABORTED`, `ERROR`.

- Persisted per `loop_id` (see §0.2 — extend existing infra if it fits).
  A server/process restart must recover in-flight state from the
  persistence layer, not reset to `IDLE`.
- Transitions only ever move forward through an approval gate or into
  `ABORTED`/`ERROR` from anywhere. No transition skips a gate.
- `ERROR` is distinct from `ABORTED`: `ERROR` means the engine or a CLI
  process failed unexpectedly (crash, non-zero exit outside the defined
  self-correction scope); `ABORTED` means a human or E-STOP explicitly
  stopped it. Both are terminal but should render differently in Telegram
  and in the Global Chat overlay.

### Macro-batch autonomy inside a running state

Within `CLAUDE_RUNNING` or `CODEX_RUNNING`, the CLI works toward an
objective, checkable definition of done (e.g., "these N routes pass these
specific tests, typecheck is clean") supplied at sprint start — not a vague
goal. Self-correction (fixing a failing test, a broken build) is the
default, authorized response to failure *within* that scope. The sprint
stops and surfaces to the next approval gate — rather than self-correcting
— only when it would change scope: a new dependency, a schema change beyond
what was specified, deleting something not explicitly named in scope. That
boundary must be enforced by the sprint's own instructions to the CLI, and
independently checked against the resulting diff before the gate message is
composed (see §4 — this is exactly what Grok's review rubric is for).

A running sprint log is appended to continuously (not just written at the
end), so a crash or a usage-limit interruption mid-sprint leaves a
resumable record rather than a lost thread. This log is part of the
manifest (§3), not a separate file.

---

## 3. Manifest — single source of truth

One manifest per task at `./workspace/<task_id>/manifest.json`. Everything
downstream — the next agent's prompt, the Telegram message, the Global Chat
mirror, the human-readable markdown summary — is generated *from* this
file, never re-interpreted from prose. The markdown summary shown to the
human and the structured data used to build the next prompt must be
guaranteed to match because they share this one source.

Illustrative shape (data shape only — not implementation):

```json
{
  "task_id": "uuid",
  "loop_id": "uuid",
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601",
  "state": "AWAITING_APPROVAL",
  "sprint": {
    "agent": "claude-code",
    "objective": "one-sentence checkable goal",
    "definition_of_done": ["specific, checkable condition", "..."],
    "started_at": "ISO-8601",
    "ended_at": "ISO-8601 | null"
  },
  "diff": {
    "files_changed": 0,
    "insertions": 0,
    "deletions": 0,
    "file_list": ["path/relative/to/repo"]
  },
  "tests": {
    "passed": 0,
    "failed": 0,
    "skipped": 0,
    "typecheck": "pass | fail | not_run"
  },
  "summary": "2-4 sentence auto-generated human summary of what happened",
  "next_step_preview": "exact description of what runs if this gate is approved",
  "review": {
    "reviewer": "grok",
    "reviewed_at": "ISO-8601 | null",
    "rubric": {
      "correctness": "pass | fail | flag",
      "security": "pass | fail | flag",
      "test_coverage": "pass | fail | flag",
      "style": "pass | fail | flag"
    },
    "notes": "string | null"
  },
  "flagged_for_review": ["specific item a human should look at, if any"],
  "sprint_log": [
    { "at": "ISO-8601", "event": "short structured event string" }
  ],
  "approval": {
    "gate_id": "matches Telegram callback_data",
    "requested_at": "ISO-8601 | null",
    "decided_at": "ISO-8601 | null",
    "decided_by": "telegram chat id | null",
    "decision": "approved | denied | null"
  }
}
```

A generated `./workspace/<task_id>/summary.md` is derived from this file
for human reading — never hand-authored separately.

---

## 4. Where Grok's ungated review plugs in

Grok has no approval gate and can run continuously — this is the one place
that unrestricted capacity should be spent, and it should feed directly
into the same manifest the gated agents use, not a separate file:

The instant a task's `state` transitions to `AWAITING_APPROVAL`, Grok is
triggered automatically (no gate — it's metered API, unattended by design)
to review the diff against the manifest's `definition_of_done` and produce
the structured rubric under `review` — correctness / security / test
coverage / style, each `pass`/`fail`/`flag`, plus any `flagged_for_review`
items. **This review must complete and be written into the manifest before
the Telegram approval message is composed** — the human's approval tap is
informed by both the CLI's own summary and Grok's independent automated
verdict in the same message, not a bare diff. This is the concrete
resolution of "information-dense approval messages": diff stats + test
counts + auto-summary + Grok's rubric + the next-step preview, composed
from one manifest, in one message.

Grok's review is read-only against the workspace — it never itself
triggers a state transition, never approves/denies, and never blocks the
human's gate from being presented even if Grok's review is slow or fails
(fail-open on the review *step*, fail-loud in the message if the rubric is
missing — "Grok review unavailable" is shown rather than silently omitted).

---

## 5. Telegram gate — extending the existing bot

Add `callback_query` handling to the existing watcher/bot:

- Every incoming update — message *and* callback — passes the existing
  operator-allowlist check first. A callback additionally re-checks the
  allowlist inside the callback handler itself (defense in depth against a
  code path that might dispatch callbacks differently than messages).
- Approval message includes inline Approve/Abort buttons. `callback_data`
  encodes the `loop_id` and `gate_id`.
- On receipt: claim the callback the same way `update_id` is already
  claimed for `/approve`/`/deny` (dedupe against replay/redelivery), then
  verify the loop is *currently* in `AWAITING_APPROVAL` for that exact
  `gate_id` (CAS-guarded, mirroring `action-order`'s pending-predicate
  update) before acting. A callback against a task no longer awaiting that
  gate gets a clear reply ("already decided" / "stale"), never a silent
  drop and never a re-trigger.
- Message content is generated from the manifest per §3/§4 — diff stats,
  test pass/fail counts, the auto-summary, Grok's rubric, and the specific
  next-step preview — so the tap is an informed decision, not a blind one.
- On approval: transition state, mirror the transition into the existing
  Global Chat overlay (fire-and-forget — never blocks the engine on the UI
  write), and spawn the next CLI process per the account-safety boundary in
  §1.
- On abort: transition to `ABORTED`, kill nothing (nothing is running yet
  at a gate by definition), mirror to Global Chat, done.

---

## 6. Verification requirements

Before this is considered built, prove — not assert — each of the
following, live:

1. A real sprint runs end to end: gate → approve via a real Telegram tap →
   Claude Code CLI launches → does real work → produces a manifest → Grok
   reviews it automatically → next gate is presented with the rubric
   included → approve → Codex launches → completes → `DONE`.
2. A deny/abort at any gate correctly stops the pipeline with no further
   CLI launch, and the state persists as `ABORTED`.
3. E-STOP mid-sprint kills the actual child process (and anything it spawned
   — check specifically for the tmux-style leak class already found once in
   this codebase) and transitions to `ABORTED`, not just `ERROR`.
4. A killed engine process (simulating a host restart) recovers the correct
   in-flight state from persistence rather than resetting to `IDLE`.
5. A replayed/stale callback against an already-decided gate is rejected
   with a clear message and produces zero state change and zero duplicate
   CLI launch.
6. The Telegram message content and the manifest that generated it are
   shown side by side to prove they match (no re-interpretation drift).

## 7. Report format

Stop and report after verification, structured as: what's live end-to-end
(with the specific proof from §6 for each item), what's still gated or
deferred, any judgment calls made that weren't explicitly specified here,
and the exact file list touched/added. Do not report a step done without
the corresponding live proof.

---

## Decisions made while synthesizing this document

- **Webhook secret token → dropped, replaced with the existing polling
  architecture's defense-in-depth.** The source material's Telegram-gate
  section assumed a webhook model; this repo already made a deliberate,
  tested choice to use long-polling instead (survives host spin-down,
  needs no public inbound endpoint). I did not introduce a webhook to
  satisfy the letter of the original spec — I mapped the intent (verified,
  hardened inbound trust) onto the architecture that's actually live.
- **Grok's role was underspecified as "plug into the same workspace
  directory structure" — I resolved this concretely** as an automatic,
  gate-blocking-message (not gate-blocking-transition) reviewer that writes
  into the same manifest right before the Telegram message is composed,
  because that's the only placement that also satisfies the separate
  "information-dense approval messages" requirement without inventing a
  second review surface.
- **State persistence location was left open ("persisted per loop_id")** —
  I did not pick a table name or assume Supabase vs. something else,
  because this repo may already have a `loops` table that's either the
  right fit or a namespace collision, and that can only be resolved by
  reading the actual code first (§0.2). I made auditing this a hard
  prerequisite rather than guessing.
- **I did not resolve exactly how "definition of done" is authored** (by a
  human per task, or templated from task type) — the source material didn't
  specify this and it's a real product decision, not an implementation
  detail I should invent silently. Flagging it here rather than picking one
  silently.
- **I explicitly scoped this engine as separate from the existing
  `brain-matrix.ts` CLAUDE/CODEX chat lanes**, even though the source
  material didn't mention that system at all — because without that
  explicit boundary, a receiving session with no memory of this repo's
  history could plausibly try to merge or rename around the naming overlap
  (both systems now have something called "CLAUDE" and "CODEX"), which
  would be a real regression against work already shipped and verified.
- **Render over Vercel was reasoned in §0.5 but not logged here** —
  logged now: Vercel functions are stateless and time-limited, so they
  can only ever be a client of something persistent, never the
  persistent thing itself; a spawned child process and a long-lived
  poll loop both need a real process lifetime, which only the Render
  host provides.
