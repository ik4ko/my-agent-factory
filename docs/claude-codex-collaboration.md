# Claude ↔ Codex Local Handoff Spec

**Scope note:** this documents the architecture actually already in this
codebase for how independent brain dispatches (Claude, Codex, others) hand
off work — not the Omnigent wrapper (`omnigent/wrapper/`), which is a
separate, later addition serving a different purpose: live cross-agent
*visibility* (mirroring what happened into a shared session for observers),
not task *execution* handoff. The two don't overlap; this file is about the
former.

## Structure: hierarchical, not peer-to-peer

The dashboard/Hermes layer orchestrates; each brain's CLI/API call executes
independently and returns. Confirmed by direct audit (see
`docs/omnigent-integration-plan.md` §Phase 3): every dispatch
(`dispatchAgent()` in `src/app/actions/agent-dispatcher.ts`,
`AgentRegistry.think()` in `src/lib/agents/registry.ts`) builds a fresh
`messages` array from caller-supplied input and makes one independent
OpenRouter/API call. No brain holds a reference to another's in-flight
state, and no shared mutable object is written to across concurrent calls.

## State: local, turn-based, via shared persistent state — not live chatter

There is no live, mid-task API channel between two brains. Handoff happens
through state written to disk/DB, read on the next turn:

1. **Supabase `tasks`/`logs` tables** — the durable, cross-brain record.
   One brain's `agentLog()` / task-status write is the next brain's (or the
   next turn's) input; nothing calls back synchronously mid-execution.
2. **The sandbox filesystem** (`src/lib/sandbox/`, confined to
   `SANDBOX_ROOT`) — a brain's `write_file` tool call is a real file another
   brain's later `view_file` call can read. This *is* the shared-filesystem
   handoff surface: one agent leaves an artifact, a later turn (same or
   different brain) picks it up.
3. **JSON tool-call blocks** (` ```tool ` fences, `src/lib/sandbox/parser.ts`)
   — the wire format for a brain's requested action
   (`view_file`/`write_file`/`execute_command`/`web_fetch`), parsed and
   executed by `runner.ts`, with results appended back into that same
   turn's context as plain text (`formatToolResults()`). Still single-turn,
   single-brain — not a cross-brain RPC.

## What this is *not*

No WebSocket/SSE channel, no shared in-memory object, no direct brain-to-
brain call. A brain never blocks waiting on another brain's live output —
it acts on what's already been persisted (Supabase row, sandboxed file) as
of the start of its own turn. This is deliberate, not a limitation: it's
why concurrent dispatches are safe by construction (Phase 3 audit) and why
the sandbox's per-task step cap (`MAX_STEPS_PER_TASK = 8`,
`src/lib/sandbox/runner.ts`) bounds a single turn's blast radius cleanly —
there's no distributed transaction spanning two brains to reason about.
