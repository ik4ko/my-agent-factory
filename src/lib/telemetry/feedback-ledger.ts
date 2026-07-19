import { getAdminClient } from '@/lib/supabase/admin';

/**
 * Feedback ledger — append-only signal capture for the future eval system.
 * One row per signal the app already generates: mentor replies (with
 * latency/model/backend), life-context fact lifecycle, and operator thumbs.
 * Recording is best-effort by design: a ledger failure logs a warning and
 * never breaks the flow that produced the signal.
 */

export type FeedbackKind =
  | 'mentor_reply'
  | 'mentor_reply_error'
  | 'fact_proposed'
  | 'fact_auto_saved'
  | 'fact_confirmed'
  | 'fact_edited'
  | 'fact_discarded'
  | 'fact_expired'
  | 'thumb_up'
  | 'thumb_down'
  | 'tool_call';

export interface FeedbackEventInput {
  kind: FeedbackKind;
  mentorId?: string | null;
  model?: string | null;
  provider?: string | null;
  backend?: 'local' | 'hosted' | null;
  latencyMs?: number | null;
  factsSelected?: number | null;
  proposalCategory?: string | null;
  gateReason?: string | null;
  userAction?: string | null;
  note?: string | null;
}

export async function recordFeedbackEvent(event: FeedbackEventInput): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getAdminClient() as any;
    const { error } = await db.from('feedback_events').insert({
      kind: event.kind,
      mentor_id: event.mentorId ?? null,
      model: event.model ?? null,
      provider: event.provider ?? null,
      backend: event.backend ?? null,
      latency_ms: event.latencyMs ?? null,
      facts_selected: event.factsSelected ?? null,
      proposal_category: event.proposalCategory ?? null,
      gate_reason: event.gateReason ?? null,
      user_action: event.userAction ?? null,
      note: event.note ? event.note.slice(0, 500) : null,
    });
    if (error) console.warn('[feedback-ledger] insert failed:', error.message);
  } catch (err) {
    console.warn('[feedback-ledger] insert failed:', err instanceof Error ? err.message : err);
  }
}

export function recordFeedbackEvents(events: FeedbackEventInput[]): void {
  for (const event of events) void recordFeedbackEvent(event);
}
