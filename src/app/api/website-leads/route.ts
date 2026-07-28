import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';
import { requireMedicareOperator } from '@/lib/medicare-crm/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Operator-facing website lead queue.
 *
 * Distinct from ./ingest/route.ts, and the split is deliberate:
 *
 *   ingest  — machine lane. Signature-authenticated, write-only, creates
 *             leads. No session, no reads.
 *   this    — human lane. Operator-session gated exactly like
 *             /api/medicare-crm, reads and updates leads.
 *
 * Reusing `requireMedicareOperator` keeps this on the same authorization
 * boundary as the rest of the Medicare room rather than inventing a second
 * definition of "who may see lead data".
 *
 * This route does not read ag_clients, ag_policies, ag_client_notes or any
 * other PHI table. It touches ag_website_leads and ag_website_lead_events
 * only. Converting a lead to a client is a separate, explicit action below —
 * it is never automatic.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const LEAD_STATUSES = [
  'new',
  'notification_failed',
  'unassigned',
  'assigned',
  'contact_attempted',
  'waiting_for_response',
  'appointment_scheduled',
  'enrolled',
  'closed',
  'do_not_contact',
  'needs_manual_review',
] as const;

export async function GET(request: NextRequest) {
  const authError = await requireMedicareOperator(request);
  if (authError) return authError;

  try {
    const [leads, events] = await Promise.all([
      db()
        .from('ag_website_leads')
        .select('*')
        .order('submitted_at', { ascending: false })
        .limit(500),
      db()
        .from('ag_website_lead_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000),
    ]);

    // A missing table is the expected state until the migration is applied.
    // Report it as an empty queue with a hint rather than a 500 — the room
    // should still render.
    if (leads.error) {
      const missing = /relation .* does not exist|PGRST205/i.test(leads.error.message);
      if (missing) {
        return NextResponse.json({
          leads: [],
          events: {},
          migrationApplied: false,
          note: 'ag_website_leads does not exist yet. Apply 20260727_website_leads.sql.',
        });
      }
      return NextResponse.json({ error: leads.error.message }, { status: 500 });
    }

    const grouped: Record<string, unknown[]> = {};
    for (const event of events.data ?? []) {
      const key = event.lead_id as string;
      if (!key) continue;
      (grouped[key] ??= []).push(event);
    }

    return NextResponse.json({
      leads: leads.data ?? [],
      events: grouped,
      migrationApplied: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Website leads unavailable: ${String(error).slice(0, 180)}` },
      { status: 500 },
    );
  }
}

const patchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(LEAD_STATUSES).optional(),
  assigned_to: z.string().max(120).nullable().optional(),
  next_action_at: z.string().nullable().optional(),
  do_not_contact: z.boolean().optional(),
  /** Records a contact attempt: stamps last_contact_at and first_response_at. */
  record_contact: z.enum(['phone', 'text', 'email']).optional(),
  note: z.string().max(2000).optional(),
});

export async function PATCH(request: NextRequest) {
  const authError = await requireMedicareOperator(request);
  if (authError) return authError;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { id, note, record_contact, ...fields } = parsed.data;
  const now = new Date().toISOString();

  const update: Record<string, unknown> = { ...fields, updated_at: now };

  if (record_contact) {
    update.last_contact_at = now;
    update.status = fields.status ?? 'contact_attempted';
  }

  // do_not_contact is a hard stop: it forces the status and halts follow-up.
  if (fields.do_not_contact === true) {
    update.status = 'do_not_contact';
  }

  const { data, error } = await db()
    .from('ag_website_leads')
    .update(update)
    .eq('id', id)
    .select('id, status, first_response_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // First response is stamped once and never overwritten — it is the SLA
  // clock, and re-stamping it on every later contact would hide how long
  // someone originally waited.
  if (record_contact && !data.first_response_at) {
    await db().from('ag_website_leads').update({ first_response_at: now }).eq('id', id);
  }

  const events: Record<string, unknown>[] = [];
  if (record_contact) {
    events.push({
      lead_id: id,
      event: 'contact_attempted',
      detail: { channel: record_contact },
    });
  }
  if (fields.status) {
    events.push({ lead_id: id, event: 'status_changed', detail: { to: fields.status } });
  }
  if (fields.assigned_to !== undefined) {
    events.push({ lead_id: id, event: 'assigned', detail: { to: fields.assigned_to } });
  }
  if (note) {
    events.push({ lead_id: id, event: 'note_added', detail: { note: note.slice(0, 2000) } });
  }
  if (events.length > 0) {
    await db().from('ag_website_lead_events').insert(events);
  }

  return NextResponse.json({ ok: true, id, status: data.status });
}

/**
 * Manual conversion of a qualified lead into a CRM client.
 *
 * POST is the ONLY path from ag_website_leads into ag_clients, and it is
 * deliberately an explicit operator action. Nothing in the ingest path, the
 * sync worker, or any automation may create an ag_clients row — a web form
 * submission is an unqualified stranger, and the client table is a book of
 * business that carries real PHI.
 *
 * Note what is NOT copied: no date_of_birth, no MBI. The website never
 * collects them, so a conversion cannot invent them. An operator fills those
 * in through the existing CRM flow after actually speaking to the person.
 */
const convertSchema = z.object({ id: z.string().uuid() });

export async function POST(request: NextRequest) {
  const authError = await requireMedicareOperator(request);
  if (authError) return authError;

  const parsed = convertSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { data: lead, error: leadError } = await db()
    .from('ag_website_leads')
    .select('*')
    .eq('id', parsed.data.id)
    .maybeSingle();

  if (leadError || !lead) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  }
  if (lead.converted_client_id) {
    return NextResponse.json(
      { error: 'Already converted', clientId: lead.converted_client_id },
      { status: 409 },
    );
  }

  const { data: client, error: clientError } = await db()
    .from('ag_clients')
    .insert({
      first_name: lead.first_name || 'Unknown',
      last_name: lead.last_name || '',
      phone: lead.phone,
      email: lead.email,
      zip: lead.zip,
      tags: ['web-lead'],
    })
    .select('id')
    .single();

  if (clientError) {
    return NextResponse.json({ error: clientError.message }, { status: 500 });
  }

  await db()
    .from('ag_website_leads')
    .update({
      converted_client_id: client.id,
      converted_at: new Date().toISOString(),
      status: 'enrolled',
    })
    .eq('id', lead.id);

  await db().from('ag_website_lead_events').insert({
    lead_id: lead.id,
    event: 'converted',
    detail: { clientId: client.id },
  });

  return NextResponse.json({ ok: true, clientId: client.id });
}
