/**
 * Omnigent shared-session bridge.
 *
 * Wired into dispatchAgent() (src/app/actions/agent-dispatcher.ts) — every
 * real brain dispatch calls publishAgentEvent() alongside its existing
 * Supabase write, so other agents/observers get live mutual visibility
 * through Omnigent's shared-session layer instead of inferring it by
 * polling Supabase. Supabase stays the durable store either way.
 *
 * How this actually works (verified live, see docs/omnigent-integration-plan.md
 * §Phase 1): Omnigent's REST API has no generic "publish an arbitrary event"
 * endpoint — a session's `items` are only ever populated by a genuine
 * runner-executed turn. So visibility here means triggering a short, cheap
 * real turn (via the `openai-agents` SDK harness, Gateway-routed to
 * OpenRouter — no separate CLI login needed) that states what just
 * happened, rather than re-running the original (expensive) task a second
 * time. This is a real, working mechanism, not a simulation of one.
 *
 * Transport (one implementation, dev and prod both — see
 * docs/omnigent-integration-plan.md §4.3.1): a plain HTTPS POST to the
 * `omnigent/wrapper/` service's `/trigger` endpoint, which runs on the same
 * persistent host as the Omnigent runner (real runner execution needs a
 * POSIX host — a native Windows host can't launch one, confirmed — so in
 * dev that host is WSL2; in production it's wherever the wrapper is
 * deployed). This process never shells out to the `omnigent` CLI itself.
 */

export type OmnigentEventKind = 'agent.status_changed' | 'agent.task_started' | 'agent.task_completed';

export interface OmnigentEvent {
  kind: OmnigentEventKind;
  agentId: string;
  taskId: string | null;
  /** short human-readable summary — not the full prompt/response payload */
  summary: string;
  ts: number;
}

const WRAPPER_URL = process.env.OMNIGENT_WRAPPER_URL ?? 'http://127.0.0.1:7900';
const WRAPPER_TOKEN = process.env.OMNIGENT_WRAPPER_TOKEN;
const MIRROR_TIMEOUT_MS = 25_000;

async function doPublish(event: OmnigentEvent): Promise<void> {
  const summary = `[MIRROR ${event.agentId}] ${event.kind}${event.taskId ? ` (task ${event.taskId.slice(0, 8)})` : ''} — ${event.summary}`.slice(0, 500);

  const res = await fetch(`${WRAPPER_URL}/trigger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${WRAPPER_TOKEN}`,
    },
    body: JSON.stringify({ harness: 'openai-agents', prompt: summary }),
    signal: AbortSignal.timeout(MIRROR_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`wrapper responded ${res.status}: ${body.slice(0, 300)}`);
  }
}

/**
 * Publish one event to Omnigent's shared-session layer.
 *
 * Fire-and-forget: never awaited by the caller, and the internal promise is
 * always caught here (logged, not thrown) — a wrapper/host outage must
 * never delay or fail the caller's real dispatch, matching this codebase's
 * existing fallback philosophy (see getMarketContext()'s Yahoo→simulated
 * path). Gated behind OMNIGENT_ENABLED so it's a true no-op everywhere this
 * isn't set (every environment today except a machine that's run through
 * the Phase 1 setup in docs/omnigent-integration-plan.md).
 */
export function publishAgentEvent(event: OmnigentEvent): void {
  if (process.env.OMNIGENT_ENABLED !== 'true') return;
  if (process.env.OMNIGENT_MIRROR_ENABLED !== 'true') return;
  if (!WRAPPER_TOKEN) return; // not configured — silent no-op, not an error

  void doPublish(event).catch((err) => {
    console.error('[omnigent] mirror publish failed (non-fatal):', err instanceof Error ? err.message : err);
  });
}
