import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

export interface MentorFeedbackSummary {
  mentorId: string;
  replies: number;
  errors: number;
  factsProposed: number;
  factsAutoSaved: number;
  factsConfirmed: number;
  factsEdited: number;
  factsDiscarded: number;
  factsExpired: number;
  thumbsUp: number;
  thumbsDown: number;
  medianLatencyMs: number | null;
  localShare: number | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** GET /api/feedback/summary — per-mentor rollup, JS-aggregated over recent
 *  events (sized for actual current usage; revisit if rows exceed the cap). */
export async function GET() {
  const { data, error } = await db()
    .from('feedback_events')
    .select('kind, mentor_id, latency_ms, backend')
    .not('mentor_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byMentor = new Map<string, { rows: Array<{ kind: string; latency_ms: number | null; backend: string | null }> }>();
  for (const row of data ?? []) {
    const bucket = byMentor.get(row.mentor_id) ?? { rows: [] };
    bucket.rows.push(row);
    byMentor.set(row.mentor_id, bucket);
  }

  const count = (rows: Array<{ kind: string }>, kind: string) => rows.filter((r) => r.kind === kind).length;
  const summaries: MentorFeedbackSummary[] = [...byMentor.entries()].map(([mentorId, { rows }]) => {
    const replies = rows.filter((r) => r.kind === 'mentor_reply');
    return {
      mentorId,
      replies: replies.length,
      errors: count(rows, 'mentor_reply_error'),
      factsProposed: count(rows, 'fact_proposed'),
      factsAutoSaved: count(rows, 'fact_auto_saved'),
      factsConfirmed: count(rows, 'fact_confirmed'),
      factsEdited: count(rows, 'fact_edited'),
      factsDiscarded: count(rows, 'fact_discarded'),
      factsExpired: count(rows, 'fact_expired'),
      thumbsUp: count(rows, 'thumb_up'),
      thumbsDown: count(rows, 'thumb_down'),
      medianLatencyMs: median(replies.map((r) => r.latency_ms).filter((v): v is number => typeof v === 'number')),
      localShare: replies.length
        ? replies.filter((r) => r.backend === 'local').length / replies.length
        : null,
    };
  });
  summaries.sort((a, b) => b.replies - a.replies || a.mentorId.localeCompare(b.mentorId));

  return NextResponse.json({ summaries, totalEvents: (data ?? []).length });
}
