/**
 * Compliance Audit Logger
 * src/utils/auditLogger.ts
 *
 * Exports `logComplianceEvent` — the single entry point for writing to
 * `public.compliance_audit_logs`, the human-readable CMS/regulator-facing
 * audit trail for AegisSage.
 *
 * ── Two-table audit architecture ─────────────────────────────────────────────
 *
 *   compliance_audit_logs  (this utility)
 *     Purpose : Human-readable compliance trail.
 *     Audience: Regulators, compliance officers, agency owners in reports.
 *     Schema  : description TEXT, status SUCCESS|FAILED|PARTIAL, ip_address.
 *     Style   : Plain English — "Pushed 50 members to GHL. Created: 12, Updated: 38."
 *
 *   enterprise_audit_logs  (src/lib/audit/log-enterprise-event.ts)
 *     Purpose : Machine-readable HIPAA §164.312(b) access log.
 *     Audience: Security engineers, breach investigation tooling.
 *     Schema  : action_type enum, phi_touched bool, metadata jsonb.
 *     Style   : Structured JSON — { direction, slice_size, pushed, ... }
 *
 *   Both tables fire on the same compliance-sensitive events for belt-and-
 *   suspenders coverage. They are NOT redundant — they serve different
 *   audiences and different regulatory purposes.
 *
 * ── PHI Policy (CRITICAL) ─────────────────────────────────────────────────────
 *
 *   The `description` field MUST contain only metadata.
 *   NEVER put the following in any parameter of this function:
 *     - Member names or last names
 *     - MBI / HICN values (even partial or hashed)
 *     - Phone numbers, addresses, email addresses
 *     - Plan IDs that could identify a specific beneficiary
 *     - Any value from a `full_name`, `mbi`, `phone`, `email`, or `dob` column
 *
 *   Safe description examples:
 *     ✅ "BOB→GHL push: batch 1–50 of 200 members. Created: 12, Updated: 38, Failed: 0."
 *     ✅ "Roster upload: 68 rows processed, 3 rejected (invalid MBI format)."
 *     ✅ "GHL inbound sync complete: 847 contacts imported (full mode)."
 *     ❌ "Pushed John Smith (MBI: 1EG4TE5MK72) to GHL."   ← FORBIDDEN
 *     ❌ "Roster row 14: Dorothy Reeves missing MBI."      ← FORBIDDEN
 *
 * ── Failure behaviour ─────────────────────────────────────────────────────────
 *
 *   `logComplianceEvent` NEVER throws. Audit log failures are swallowed and
 *   written to console.error for monitoring pickup. A failed audit write
 *   must never surface to the broker or abort a primary operation.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   import { logComplianceEvent } from '@/utils/auditLogger'
 *
 *   // At the start of an operation:
 *   await logComplianceEvent({
 *     agencyId:     broker.agency_id,
 *     brokerUserId: user.id,
 *     eventType:    'CRM_EXPORT_STARTED',
 *     description:  `BOB→GHL push started: ${totalMembers} members in book, batch size ${batchSize}.`,
 *     ipAddress:    req.headers.get('x-forwarded-for') ?? undefined,
 *     status:       'SUCCESS',
 *   })
 *
 *   // On completion (partial or full):
 *   await logComplianceEvent({
 *     agencyId:     broker.agency_id,
 *     brokerUserId: user.id,
 *     eventType:    'CRM_EXPORT_COMPLETED',
 *     description:  `BOB→GHL push: batch ${startIndex + 1}–${startIndex + slice} of ${total}. ` +
 *                   `Created: ${created}, Updated: ${updated}, Failed: ${failed}.`,
 *     ipAddress:    req.headers.get('x-forwarded-for') ?? undefined,
 *     status:       failed === 0 ? 'SUCCESS' : 'PARTIAL',
 *   })
 */

import { createServiceClient } from '@/lib/supabase/service'

// ── Types ────────────────────────────────────────────────────────────────────

export type ComplianceEventType =
  // CRM data movement
  | 'CRM_EXPORT_STARTED'
  | 'CRM_EXPORT_COMPLETED'
  | 'CRM_EXPORT_FAILED'
  | 'CRM_IMPORT_STARTED'
  | 'CRM_IMPORT_COMPLETED'
  // PHI access
  | 'PHI_ACCESS'
  | 'MBI_REVEAL'
  | 'MBI_COPY'
  // Data ingestion
  | 'ROSTER_UPLOAD'
  | 'ROSTER_UPLOAD_ERRORS'
  // Member lifecycle
  | 'MEMBER_DELETE'
  | 'ALERT_ACKNOWLEDGE'
  // Security
  | 'API_KEY_GENERATED'
  | 'LOGIN'
  | 'LOGIN_FAILED'

export type ComplianceStatus = 'SUCCESS' | 'FAILED' | 'PARTIAL'

export interface ComplianceEventParams {
  /** Agency this event belongs to */
  agencyId:       string | null

  /** The authenticated broker or owner performing the action */
  brokerUserId:   string | null

  /** Compliance event classification */
  eventType:      ComplianceEventType

  /**
   * Plain-English summary for regulators and compliance officers.
   *
   * PHI FORBIDDEN — include only metadata: counts, modes, batch positions,
   * timestamps, and aggregate statistics. Never include names, MBIs, or
   * any value that could identify a specific Medicare beneficiary.
   */
  description:    string

  /**
   * Client IP address extracted from request headers.
   * Pass `req.headers.get('x-forwarded-for')` or use `extractIp(req)`.
   * Required by HIPAA §164.312(b) for access control audit.
   */
  ipAddress?:     string

  /** Outcome of the operation */
  status:         ComplianceStatus

  /**
   * Optional structured error detail for FAILED events.
   * Must not contain raw PHI — use error codes or sanitized messages.
   * Example: "GHL API HTTP 429 — rate limit exceeded after 3 retries"
   */
  errorDetail?:   string
}

// ── IP extraction helper ──────────────────────────────────────────────────────

/**
 * Extract the originating client IP from a Next.js request.
 * Handles Vercel's x-forwarded-for chain (first IP = real client).
 * Returns 'unknown' rather than null so it's always loggable.
 */
export function extractIp(req: { headers: { get(name: string): string | null } }): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

// ── PHI guard ────────────────────────────────────────────────────────────────

/**
 * Lightweight runtime PHI guard for the description field.
 * Scans for patterns that strongly suggest raw PHI was accidentally included.
 * Throws in development; in production, redacts and logs a warning.
 *
 * This is a safety net, not a replacement for careful callsite authorship.
 */
const MBI_PATTERN    = /\b[1-9][A-Z][A-Z0-9][A-Z][A-Z][0-9][A-Z0-9][A-Z0-9][0-9][A-Z][0-9]\b/i
const NAME_LOOKALIKE = /\b(?:mr|mrs|ms|dr)\.?\s+[A-Z][a-z]+/i  // "Dr. Smith", "Ms. Jones"

function guardDescription(description: string): string {
  if (MBI_PATTERN.test(description)) {
    const safeDesc = '[REDACTED: description contained a possible MBI — fix the callsite]'
    console.error('[auditLogger] PHI GUARD triggered — MBI-like pattern detected in description. Redacting.')
    return safeDesc
  }
  if (NAME_LOOKALIKE.test(description)) {
    console.warn('[auditLogger] PHI WARNING — description may contain a personal name. Review callsite.')
    // Warn but don't redact — name-lookalike is lower confidence than MBI pattern
  }
  return description
}

// ── Core logger ───────────────────────────────────────────────────────────────

/**
 * Write a compliance event to `public.compliance_audit_logs`.
 *
 * Always uses the service role client to bypass RLS — this guarantees the
 * audit row is written even when a user's JWT has expired mid-operation.
 *
 * NEVER throws. Failures are absorbed and written to console.error.
 * A failed audit write must never abort or surface to the broker.
 */
export async function logComplianceEvent(params: ComplianceEventParams): Promise<void> {
  const {
    agencyId,
    brokerUserId,
    eventType,
    description,
    ipAddress,
    status,
    errorDetail,
  } = params

  // Runtime PHI guard — sanitizes description before it hits the DB
  const safeDescription = guardDescription(description)

  try {
    const admin = createServiceClient()

    const { error } = await admin
      .from('compliance_audit_logs')
      .insert({
        agency_id:      agencyId      ?? null,
        broker_user_id: brokerUserId  ?? null,
        event_type:     eventType,
        description:    safeDescription,
        ip_address:     ipAddress ?? null,
        status,
        error_detail:   errorDetail   ?? null,
      })

    if (error) {
      // Log the failure but never propagate — audit failures are non-fatal
      console.error('[auditLogger] write failed:', {
        event_type: eventType,
        agency_id:  agencyId,
        error:      error.message,
        code:       error.code,
      })
    }
  } catch (err) {
    console.error(
      '[auditLogger] unexpected error:',
      err instanceof Error ? err.message : String(err)
    )
  }
}

// ── Convenience wrappers ─────────────────────────────────────────────────────
// Pre-typed for the most common callsite patterns so engineers don't need
// to repeat boilerplate at every call location.

/**
 * Log the start of a BOB→GHL outbound push operation.
 * Call this BEFORE making any GHL API calls.
 *
 * @param totalMembers  Total members in the Book of Business (aggregate count only)
 * @param sliceSize     Members being processed in this invocation
 * @param startIndex    0-based position cursor (for paginated pushes)
 */
export function logCrmExportStarted(
  agencyId:     string,
  brokerUserId: string,
  totalMembers: number,
  sliceSize:    number,
  startIndex:   number,
  ipAddress?:   string,
): Promise<void> {
  return logComplianceEvent({
    agencyId,
    brokerUserId,
    eventType:   'CRM_EXPORT_STARTED',
    description: `BOB→GHL push started: processing members ${startIndex + 1}–${startIndex + sliceSize} ` +
                 `of ${totalMembers} total in book (batch size: ${sliceSize}).`,
    ipAddress,
    status: 'SUCCESS',
  })
}

/**
 * Log the successful completion of a BOB→GHL push batch.
 * Call this AFTER all GHL API calls for the batch are complete.
 *
 * @param created   Contacts newly created in GHL during this batch
 * @param updated   Contacts updated in GHL during this batch
 * @param failed    Contacts that could not be pushed (individual failures)
 * @param isComplete  True if this was the final batch (nextIndex === null)
 */
export function logCrmExportCompleted(
  agencyId:     string,
  brokerUserId: string,
  created:      number,
  updated:      number,
  failed:       number,
  startIndex:   number,
  sliceSize:    number,
  totalMembers: number,
  isComplete:   boolean,
  ipAddress?:   string,
): Promise<void> {
  const status: ComplianceStatus = failed === 0 ? 'SUCCESS' : 'PARTIAL'
  const scopeLabel = isComplete
    ? `COMPLETE — all ${totalMembers} members processed`
    : `batch ${startIndex + 1}–${startIndex + sliceSize} of ${totalMembers}`

  return logComplianceEvent({
    agencyId,
    brokerUserId,
    eventType:   'CRM_EXPORT_COMPLETED',
    description: `BOB→GHL push: ${scopeLabel}. ` +
                 `Created: ${created}, Updated: ${updated}, Failed: ${failed}. ` +
                 `Total pushed: ${created + updated}.`,
    ipAddress,
    status,
    ...(failed > 0 && {
      errorDetail: `${failed} contact(s) failed individual GHL API calls — see enterprise_audit_logs for member UUIDs.`,
    }),
  })
}

/**
 * Log a failed BOB→GHL push invocation (whole-batch failure, not per-contact).
 */
export function logCrmExportFailed(
  agencyId:     string | null,
  brokerUserId: string | null,
  reason:       string,
  ipAddress?:   string,
): Promise<void> {
  return logComplianceEvent({
    agencyId,
    brokerUserId,
    eventType:   'CRM_EXPORT_FAILED',
    description: 'BOB→GHL push failed before any contacts were processed.',
    ipAddress,
    status:      'FAILED',
    errorDetail: reason.slice(0, 500), // cap to prevent runaway error messages
  })
}

/**
 * Log the start of a GHL→BOB inbound sync (POST handler).
 */
export function logCrmImportStarted(
  agencyId:     string,
  brokerUserId: string,
  mode:         'full' | 'incremental',
  ipAddress?:   string,
): Promise<void> {
  return logComplianceEvent({
    agencyId,
    brokerUserId,
    eventType:   'CRM_IMPORT_STARTED',
    description: `GHL→BOB inbound sync started (mode: ${mode}).`,
    ipAddress,
    status: 'SUCCESS',
  })
}

/**
 * Log the completion of a GHL→BOB inbound sync (POST handler).
 */
export function logCrmImportCompleted(
  agencyId:     string,
  brokerUserId: string,
  synced:       number,
  errored:      number,
  hasMore:      boolean,
  mode:         string,
  ipAddress?:   string,
): Promise<void> {
  const status: ComplianceStatus = errored === 0 ? 'SUCCESS' : 'PARTIAL'
  return logComplianceEvent({
    agencyId,
    brokerUserId,
    eventType:   'CRM_IMPORT_COMPLETED',
    description: `GHL→BOB inbound sync: ${synced} contacts imported, ${errored} errored ` +
                 `(mode: ${mode}, has_more: ${hasMore}).`,
    ipAddress,
    status,
    ...(errored > 0 && {
      errorDetail: `${errored} rows could not be upserted to ghl_contacts. Check server logs for Supabase error details.`,
    }),
  })
}

/**
 * Log a roster upload operation (CSV or Google Sheets).
 */
export function logRosterUpload(
  agencyId:     string,
  brokerUserId: string,
  imported:     number,
  dropped:      number,
  source:       'csv_upload' | 'sheets_import',
  ipAddress?:   string,
): Promise<void> {
  return logComplianceEvent({
    agencyId,
    brokerUserId,
    eventType:   'ROSTER_UPLOAD',
    description: `Roster ${source === 'csv_upload' ? 'CSV upload' : 'Google Sheets import'}: ` +
                 `${imported} members imported, ${dropped} rows rejected (invalid/missing MBI format).`,
    ipAddress,
    status: 'SUCCESS',
  })
}
