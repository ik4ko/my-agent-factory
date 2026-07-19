'use server';

import { cookies } from 'next/headers';
import { z } from 'zod';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth/session';
import { recordFeedbackEvent } from '@/lib/telemetry/feedback-ledger';

async function assertOperatorSession(): Promise<void> {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) throw new Error('DASHBOARD_PASSWORD not configured');
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(token, password))) throw new Error('Unauthorized: valid operator session required');
}

const ThumbSchema = z.object({
  mentorId: z.string().trim().min(1).max(40),
  verdict: z.enum(['up', 'down']),
  model: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});

/** Operator thumbs on a mentor reply — one feedback_events row. */
export async function recordMentorThumb(input: unknown): Promise<{ ok: boolean }> {
  await assertOperatorSession();
  const parsed = ThumbSchema.parse(input);
  await recordFeedbackEvent({
    kind: parsed.verdict === 'up' ? 'thumb_up' : 'thumb_down',
    mentorId: parsed.mentorId,
    model: parsed.model ?? null,
    userAction: `thumb_${parsed.verdict}`,
    note: parsed.note ?? null,
  });
  return { ok: true };
}
