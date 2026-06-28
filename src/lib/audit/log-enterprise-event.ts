/**
 * Enterprise Audit Logger
 *
 * Server-side helper for writing to enterprise_audit_logs.
 * Always uses the service role client to bypass RLS — this ensures
 * audit events are recorded even when the user's session has expired.
 *
 * Usage (server action or API route):
 *   import { logEnterpriseEvent } from '@/lib/audit/log-enterprise-event'
 *
 *   await logEnterpriseEvent({
 *     agencyId:     agency.id,
 *     userId:       user.id,
 *     actionType:   'MBI_COPY',
 *     resourceType: 'book_of_business',
 *     resourceId:   memberId,
 *     clientIp:     req.headers.get('x-forwarded-for') ?? 'unknown',
 *     userAgent:    req.headers.get('user-agent') ?? null,
 *     phiTouched:   true,
 *     metadata:     { member_name_hash: sha256(memberName) },
 *   })
 *
 * Failures are silently swallowed — audit failures must never surface to the
 * user or block the primary operation. Errors are written to console.error
 * for monitoring pickup.
 *
 * PHI policy:
 *   NEVER pass raw PHI (names, MBIs, SSNs) in the metadata object.
 *   Use resource_id (the row UUID) to reference the encrypted record.
 *   If you need to log a PHI-adjacent identifier, hash it first:
 *     import { createHash } from 'crypto'
 *     const nameHash = createHash('sha256').update(name).digest('hex').slice(0, 16)
 */

import { createServiceClient } from '@/lib/supabase/service'

// ── Types ────────────────────────────────────────────────────────────────────

export type AuditActionType =
  // PHI-touch events
  | 'MBI_REVEAL'
  | 'MBI_COPY'
  | 'CSV_EXPORT'
  | 'RECORD_MODIFY'
  | 'RECORD_DELETE'
  | 'RECORD_VIEW'
  | 'PHI_ACCESS'
  // Infrastructure events
  | 'EDGE_MAP_FETCH'
  | 'API_KEY_GENERATE'
  | 'ROSTER_UPLOAD'
  | 'ALERT_ACKNOWLEDGE'
  | 'CRM_SYNC'
  // Authentication
  | 'LOGIN'
  | 'LOGOUT'
  | 'LOGIN_FAILED'
  // Session lifecycle
  | 'SESSION_START'
  | 'SESSION_END'

export interface EnterpriseAuditEventParams {
  /** Agency the event belongs to */
  agencyId:     string | null
  /** Authenticated user performing the action */
  userId:       string | null
  /** What type of event this is */
  actionType:   AuditActionType
  /** The table or domain this event touches */
  resourceType?: string
  /** UUID or slug of the specific record (NOT raw PHI) */
  resourceId?:   string
  /** Originating client IP (from x-forwarded-for) */
  clientIp?:     string
  /** Browser or extension user-agent string */
  userAgent?:    string
  /** Supabase session ID or extension install ID */
  sessionId?:    string
  /** Set TRUE when the event directly involves ePHI access or mutation */
  phiTouched?:   boolean
  /**
   * Event-specific structured context.
   * NEVER include raw PHI here — use resourceId to reference the source row.
   */
  metadata?:     Record<string, unknown>
}

// ── PHI-safe actions set ─────────────────────────────────────────────────────
// These action types always set phiTouched = true regardless of the caller's value.
const PHI_TOUCH_ACTIONS = new Set<AuditActionType>([
  'MBI_REVEAL',
  'MBI_COPY',
  'CSV_EXPORT',
  'RECORD_MODIFY',
  'RECORD_DELETE',
  'PHI_ACCESS',
])

// ── Main export ──────────────────────────────────────────────────────────────

export async function logEnterpriseEvent(params: EnterpriseAuditEventParams): Promise<void> {
  const {
    agencyId, userId, actionType, resourceType, resourceId,
    clientIp, userAgent, sessionId, phiTouched, metadata = {},
  } = params

  // Enforce PHI flag for known PHI-touch action types
  const effectivePhiTouched = phiTouched ?? PHI_TOUCH_ACTIONS.has(actionType)

  try {
    const admin = createServiceClient()

    const { error } = await admin
      .from('enterprise_audit_logs')
      .insert({
        agency_id:     agencyId     ?? null,
        user_id:       userId       ?? null,
        action_type:   actionType,
        resource_type: resourceType ?? null,
        resource_id:   resourceId   ?? null,
        client_ip:     clientIp     ?? null,
        user_agent:    userAgent    ?? null,
        session_id:    sessionId    ?? null,
        phi_touched:   effectivePhiTouched,
        metadata:      metadata,
      })

    if (error) {
      // Log error but never throw — audit failures must not disrupt primary flows
      console.error('[enterprise-audit] write failed:', {
        action_type: actionType,
        agency_id:   agencyId,
        error:       error.message,
        code:        error.code,
      })
    }
  } catch (err) {
    console.error('[enterprise-audit] unexpected error:', err instanceof Error ? err.message : String(err))
  }
}

// ── Convenience wrappers ─────────────────────────────────────────────────────
// Pre-configured for the most common audit event patterns.

/** Log an MBI reveal event (broker opened the MBI modal) */
export function logMbiReveal(
  agencyId: string,
  userId: string,
  memberId: string,
  opts: { clientIp?: string; userAgent?: string } = {}
): Promise<void> {
  return logEnterpriseEvent({
    agencyId, userId,
    actionType:   'MBI_REVEAL',
    resourceType: 'book_of_business',
    resourceId:   memberId,
    phiTouched:   true,
    ...opts,
    metadata: { action: 'modal_opened' },
  })
}

/** Log an MBI copy event (broker clicked "Copy" on the MBI overlay) */
export function logMbiCopy(
  agencyId: string,
  userId: string,
  memberId: string,
  opts: { clientIp?: string; userAgent?: string } = {}
): Promise<void> {
  return logEnterpriseEvent({
    agencyId, userId,
    actionType:   'MBI_COPY',
    resourceType: 'book_of_business',
    resourceId:   memberId,
    phiTouched:   true,
    ...opts,
    metadata: { action: 'clipboard_write' },
  })
}

/** Log a CSV export event */
export function logCsvExport(
  agencyId: string,
  userId: string,
  opts: { rowCount?: number; clientIp?: string; userAgent?: string } = {}
): Promise<void> {
  const { rowCount, ...netOpts } = opts
  return logEnterpriseEvent({
    agencyId, userId,
    actionType:   'CSV_EXPORT',
    resourceType: 'book_of_business',
    phiTouched:   true,
    ...netOpts,
    metadata: { row_count: rowCount ?? null },
  })
}

/** Log a roster upload event */
export function logRosterUpload(
  agencyId: string,
  userId: string,
  opts: { carrier?: string; rowCount?: number; errorCount?: number } = {}
): Promise<void> {
  return logEnterpriseEvent({
    agencyId, userId,
    actionType:   'ROSTER_UPLOAD',
    resourceType: 'book_of_business',
    phiTouched:   false,
    metadata:     opts,
  })
}

/** Log a CRM sync event */
export function logCrmSync(
  agencyId: string,
  userId: string,
  memberId: string,
  opts: { destinations?: string[]; riskLevel?: string } = {}
): Promise<void> {
  return logEnterpriseEvent({
    agencyId, userId,
    actionType:   'CRM_SYNC',
    resourceType: 'ghl_contacts',
    resourceId:   memberId,
    phiTouched:   false,
    metadata:     opts,
  })
}
