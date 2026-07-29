import { NextRequest, NextResponse } from 'next/server';
import { requireMedicareOperator } from '@/lib/medicare-crm/auth';
import { db, isMissingTable } from '@/lib/medicare-crm/db';
import {
  buildWorkQueue,
  summarizeQueue,
  type QueueClient,
  type QueueDiff,
  type QueueLead,
  type QueueTask,
} from '@/lib/medicare-crm/work-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The Today view's single data source.
 *
 * One round trip assembles the whole work queue, because the alternative —
 * the client fetching leads, reviews, diffs and tasks separately and merging
 * them — would put the ordering rules in the browser where they cannot be
 * tested and would let sections arrive out of order.
 *
 * Every query here selects an explicit column list. No `select('*')`: these
 * tables carry PHI, and a future column would otherwise start flowing to the
 * browser the moment it was added. In particular, medicare_beneficiary_identifier
 * and date_of_birth are never in any list below.
 */

/** Missing table = feature not migrated yet. Empty section, not an error. */
function rowsOrEmpty<T>(result: { data: T[] | null; error: unknown }, label: string): {
  rows: T[];
  missing: boolean;
} {
  const error = result.error as { message?: string; code?: string } | null;
  if (error) {
    if (isMissingTable(error)) return { rows: [], missing: true };
    throw new Error(`${label}: ${error.message ?? 'query failed'}`);
  }
  return { rows: result.data ?? [], missing: false };
}

export async function GET(request: NextRequest) {
  const authError = await requireMedicareOperator(request);
  if (authError) return authError;

  try {
    const [leads, clients, diffs, tasks] = await Promise.all([
      db()
        .from('ag_website_leads')
        .select(
          'id, first_name, last_name, status, assigned_to, first_response_at, submitted_at, do_not_contact, preferred_contact, source_page',
        )
        .not('status', 'in', '("closed","enrolled","do_not_contact")')
        .order('submitted_at', { ascending: true })
        .limit(300),

      // next_review_at is the filter, but clients with no review date are
      // still needed here: the diff rows below resolve their display names
      // against this list, and a client with a pending diff may well have no
      // review scheduled.
      db()
        .from('ag_clients')
        .select('id, first_name, last_name, next_review_at, last_verified_at')
        .order('last_name', { ascending: true })
        .limit(2000),

      db()
        .from('ag_coverage_diffs')
        .select(
          'id, client_id, target_field, current_value, incoming_value, source, observed_at, confidence, status',
        )
        .eq('status', 'pending')
        .order('observed_at', { ascending: true })
        .limit(300),

      db()
        .from('ag_operator_tasks')
        .select(
          'id, kind, title, detail, priority, status, due_at, created_at, updated_at, assigned_to, client_id, source',
        )
        .in('status', ['open', 'snoozed'])
        .order('created_at', { ascending: true })
        .limit(300),
    ]);

    const leadRows = rowsOrEmpty<QueueLead>(leads, 'ag_website_leads');
    const clientRows = rowsOrEmpty<QueueClient>(clients, 'ag_clients');
    const diffRows = rowsOrEmpty<QueueDiff>(diffs, 'ag_coverage_diffs');
    const taskRows = rowsOrEmpty<QueueTask>(tasks, 'ag_operator_tasks');

    const queue = buildWorkQueue(
      {
        leads: leadRows.rows,
        clients: clientRows.rows,
        diffs: diffRows.rows,
        tasks: taskRows.rows,
      },
      new Date(),
    );

    const pendingMigrations = [
      leadRows.missing && '20260727_website_leads.sql',
      (diffRows.missing || taskRows.missing) && '20260728_medicare_cockpit.sql',
    ].filter(Boolean) as string[];

    return NextResponse.json({
      queue,
      summary: summarizeQueue(queue),
      counts: {
        totalClients: clientRows.rows.length,
        openItems: queue.length,
      },
      pendingMigrations,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Work queue unavailable: ${String(error).slice(0, 180)}` },
      { status: 500 },
    );
  }
}
