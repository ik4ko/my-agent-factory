import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Website lead ingest.
 *
 * ── Why this is not part of /api/medicare-crm ─────────────────────────────
 * That route is guarded by `requireMedicareOperator`, which deliberately
 * rejects the machine-token lane because Medicare data is PHI-adjacent. That
 * boundary is correct and this route respects it rather than widening it.
 *
 * This endpoint is intentionally the narrowest thing that can work:
 *   • it WRITES to ag_website_leads and ag_website_lead_events, nothing else
 *   • it READS nothing back to the caller beyond an id
 *   • it cannot touch ag_clients, ag_policies, or any PHI table
 *   • it has its own dedicated secret, separate from DASHBOARD_PASSWORD,
 *     MACHINE_API_TOKEN and CRON_SECRET
 *
 * So a compromise of the website's signing secret leaks the ability to create
 * junk leads — annoying, cleanable — and not the ability to read a book of
 * business.
 *
 * ── Proxy exemption ───────────────────────────────────────────────────────
 * src/proxy.ts must exempt '/api/website-leads/ingest' the same way it
 * exempts '/api/orchestrator/cron' and '/api/loops/tick', since this route
 * self-authorizes via signature rather than an operator session.
 *
 * Env: WEBSITE_LEAD_INGEST_SECRET (server-only, must match the website's
 * CRM_INGEST_SECRET).
 */

const SIGNATURE_HEADER = 'x-aegissage-signature';
const TIMESTAMP_HEADER = 'x-aegissage-timestamp';
const TOLERANCE_SECONDS = 300;

const consentSchema = z.object({
  reply: z.literal(true),
  replyAt: z.string(),
  replyTextVersion: z.string().max(40),
  sms: z.boolean(),
  smsAt: z.string().nullable(),
  smsTextVersion: z.string().max(40).nullable(),
  marketing: z.boolean(),
  marketingAt: z.string().nullable(),
  marketingTextVersion: z.string().max(40).nullable(),
});

const leadSchema = z.object({
  contractVersion: z.string().max(20),
  websiteSubmissionId: z.string().uuid(),
  sourceLeadId: z.string().max(120),
  submittedAt: z.string(),
  name: z.string().max(80),
  email: z.string().max(160).nullable(),
  phone: z.string().max(40).nullable(),
  zip: z.string().max(10).nullable(),
  preferredContact: z.enum(['phone', 'text', 'email']),
  topic: z.string().max(120).nullable(),
  message: z.string().max(2000).nullable(),
  sourcePage: z.string().max(80),
  attribution: z.record(z.string(), z.string()).default({}),
  consent: consentSchema,
});

/** Constant-time compare — a plain === here leaks the secret by timing. */
function verify(rawBody: string, timestamp: string, signature: string, secret: string): boolean {
  const age = Math.abs(Date.now() - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS * 1000) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** "Ada Lovelace King" -> first "Ada", last "Lovelace King". */
function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0] ?? '', last: '' };
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

export async function POST(request: NextRequest) {
  const secret = process.env.WEBSITE_LEAD_INGEST_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: 'Ingest not configured' }, { status: 503 });
  }

  const signature = request.headers.get(SIGNATURE_HEADER);
  const timestamp = request.headers.get(TIMESTAMP_HEADER);
  if (!signature || !timestamp) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
  }

  // Read the raw body: the signature covers exact bytes, so re-serializing a
  // parsed object would produce a different digest.
  const rawBody = await request.text();

  if (!verify(rawBody, timestamp, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Malformed JSON' }, { status: 400 });
  }

  const parsed = leadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    // 400 is permanent — the website will not retry a payload we cannot read.
    return NextResponse.json(
      { error: `Schema rejected: ${parsed.error.issues[0]?.message ?? 'invalid'}` },
      { status: 400 },
    );
  }

  const lead = parsed.data;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;

  // Idempotency: a repeat delivery returns the existing row with 409 so the
  // website records it as delivered and stops retrying.
  const { data: existing } = await db
    .from('ag_website_leads')
    .select('id')
    .eq('source_lead_id', lead.sourceLeadId)
    .maybeSingle();

  if (existing) {
    await db.from('ag_website_lead_events').insert({
      lead_id: existing.id,
      source_lead_id: lead.sourceLeadId,
      event: 'duplicate_ingest_ignored',
      detail: { contractVersion: lead.contractVersion },
    });
    return NextResponse.json({ id: existing.id, duplicate: true }, { status: 409 });
  }

  const { first, last } = splitName(lead.name);

  const { data: inserted, error } = await db
    .from('ag_website_leads')
    .insert({
      source_lead_id: lead.sourceLeadId,
      website_submission_id: lead.websiteSubmissionId,
      contract_version: lead.contractVersion,
      first_name: first,
      last_name: last,
      phone: lead.phone,
      email: lead.email,
      zip: lead.zip,
      preferred_contact: lead.preferredContact,
      topic: lead.topic,
      message: lead.message ?? '',
      source_page: lead.sourcePage,
      attribution: lead.attribution,
      consent_reply: lead.consent.reply,
      consent_reply_at: lead.consent.replyAt,
      consent_reply_version: lead.consent.replyTextVersion,
      consent_sms: lead.consent.sms,
      consent_sms_at: lead.consent.smsAt,
      consent_sms_version: lead.consent.smsTextVersion,
      consent_marketing: lead.consent.marketing,
      consent_marketing_at: lead.consent.marketingAt,
      consent_marketing_version: lead.consent.marketingTextVersion,
      status: 'new',
      submitted_at: lead.submittedAt,
    })
    .select('id')
    .single();

  if (error) {
    // 23505 = another request won the race between the check above and this
    // insert. That is the dedupe guarantee holding, not a failure.
    if (error.code === '23505') {
      return NextResponse.json({ duplicate: true }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await db.from('ag_website_lead_events').insert({
    lead_id: inserted.id,
    source_lead_id: lead.sourceLeadId,
    event: 'ingested',
    detail: { sourcePage: lead.sourcePage, contractVersion: lead.contractVersion },
  });

  return NextResponse.json({ id: inserted.id }, { status: 201 });
}
