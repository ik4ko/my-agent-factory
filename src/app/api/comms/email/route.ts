import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sendEmail } from '@/lib/comms/email';

// nodemailer needs the Node runtime — never bundle this route for edge.
export const runtime = 'nodejs';

/** POST /api/comms/email — send an email as the operator's Gmail. Auth-gated
 *  by middleware. Body: { to, subject, body, agent? }. */
const Schema = z.object({
  to: z.string().email(),
  subject: z.string().max(300).optional().default(''),
  body: z.string().max(50_000).optional().default(''),
  agent: z.string().max(40).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload — expected { to, subject, body }' }, { status: 400 });
  }
  const result = await sendEmail(parsed.data);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
