import { getAdminClient } from '@/lib/supabase/admin';

/**
 * Shared server-side data helpers for the Medicare room.
 *
 * The service-role client is used because every ag_ table is RLS-locked to
 * service_role with no anon or authenticated policy. That is the whole access
 * model: the browser cannot reach these tables at all, and the operator-session
 * gate in front of each route is what decides whether a human may see the data.
 * These helpers must therefore never be imported into a client component.
 */

// The generated database types predate the ag_ tables, so the typed client
// rejects them at compile time. Matching the existing cast in
// src/app/api/medicare-crm/route.ts rather than inventing a second convention.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = () => getAdminClient() as any;

/**
 * True when an error means "migration not applied yet" rather than a fault.
 *
 * The room is expected to render against a database where a newer migration
 * has not run — that is the normal state between deploy and migrate — so
 * callers degrade to an empty section with a hint instead of a 500.
 */
export function isMissingTable(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  return /relation .* does not exist|PGRST205|PGRST204/i.test(
    `${error.message ?? ''} ${error.code ?? ''}`,
  );
}

/**
 * Append one audit record.
 *
 * Deliberately best-effort and never throws: an audit write failing must not
 * roll back or block the operator action the user just took. A failure is
 * logged for investigation instead. If audit durability ever needs to be a
 * hard guarantee, this becomes a database trigger rather than a call site.
 */
export async function recordAudit(entry: {
  action: string;
  entityType: string;
  entityId?: string | null;
  actor?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db().from('ag_audit_events').insert({
      actor: entry.actor ?? 'operator',
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId ?? null,
      before: entry.before ?? {},
      after: entry.after ?? {},
      detail: entry.detail ?? {},
    });
  } catch (error) {
    console.error('[medicare-crm] audit write failed', {
      action: entry.action,
      entityType: entry.entityType,
      error: String(error).slice(0, 200),
    });
  }
}

/** `••••••1234`. The only form of an MBI allowed to leave the server. */
export function maskMbiValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, '');
  return `••••••${compact.slice(-4)}`;
}
