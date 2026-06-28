/**
 * syncGHLContactsToSupabase
 *
 * Pulls all contacts from a GHL sub-account location and upserts them
 * into the book_of_business table. Intended as an agency-level ingestion
 * utility separate from the broker-scoped /api/ghl/sync endpoint.
 *
 * Field resolution strategy:
 *   1. GET /custom-fields/?locationId to learn the agency's custom field IDs
 *   2. Match field names against /mbi/i and /plan.?name/i to locate MBI and plan
 *   3. Paginate GET /contacts/ 100 at a time and upsert each page immediately
 *
 * Carrier derivation:
 *   Scans the plan_name string against the CARRIER_MAP patterns.
 *   Falls back to 'unknown' when no carrier can be inferred.
 *
 * Upsert conflict key: ghl_contact_id (unique per location).
 *
 * Do NOT import this file from anything under src/app/api/roster/ or
 * src/lib/churn/ — those pipelines are intentionally isolated.
 */

// GHL sync members stub — external sync removed.
// Keep an exported function for callers, but no-op the operation.

export async function syncGHLContactsToSupabase(_agencyId: string): Promise<{ synced: number; errors: number }> {
  // No-op: GHL integration removed. Return zeros to indicate nothing synced.
  return { synced: 0, errors: 0 }
}
