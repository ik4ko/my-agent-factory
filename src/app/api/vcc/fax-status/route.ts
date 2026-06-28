/**
 * POST /api/vcc/fax-status
 *
 * SRFax delivery status webhook receiver.
 *
 * SRFax fires this endpoint with a form-encoded POST payload when a queued
 * fax transitions to a terminal state (Success, Failed, No Answer, Busy).
 *
 * SRFax callback fields (form-encoded):
 *   sFaxDetailsID  — the queue ID returned from Queue_Fax (our fax_confirmation_id)
 *   sStatus        — 'Success' | 'Failed' | 'No Answer' | 'Busy'
 *   sPages         — number of pages transmitted
 *   sRemoteID      — remote station identifier (CSID)
 *   sScheduledDate — ISO date when the fax was dispatched
 *
 * Security:
 *   SRFax does not sign webhook payloads with an HMAC. We validate via a
 *   shared secret appended as a query param when registering the callback URL
 *   in SRFax account settings.
 *   Register your callback URL as:
 *     https://www.aegissage.com/api/vcc/fax-status?secret=<SRFAX_WEBHOOK_SECRET>
 *
 * Retry policy:
 *   On failure, if fax_attempts < MAX_FAX_RETRIES we immediately re-queue the
 *   fax and increment the counter. On final failure (retries exhausted or retry
 *   itself fails) we mark the submission as 'failed'.
 *
 * Idempotency:
 *   SRFax may fire the callback more than once for the same event. The update
 *   is guarded by checking the current fax_status — if it is already 'signed'
 *   or 'failed' (final states), we return 200 without re-processing.
 *
 * HIPAA / PHI note:
 *   This route handles only fax delivery metadata — queue IDs, status codes,
 *   page counts. No PHI (beneficiary names, MBIs, dates of birth) is included
 *   in any log statement or audit record. The submission UUID provides the
 *   necessary traceability without exposing PHI.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendFax } from '@/lib/vcc/fax-dispatcher'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_FAX_RETRIES = 3

// ── Shared secret validation ──────────────────────────────────────────────────

function validateWebhookSecret(req: NextRequest): boolean {
  const expected = process.env.SRFAX_WEBHOOK_SECRET
  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[fax-status] SRFAX_WEBHOOK_SECRET not set — rejecting webhook')
      return false
    }
    console.warn('[fax-status] SRFAX_WEBHOOK_SECRET not set — accepting in dev mode')
    return true
  }
  const provided = req.nextUrl.searchParams.get('secret')
  return provided === expected
}

// ── SRFax status → our fax_status mapping ────────────────────────────────────

function mapSrFaxStatus(srfaxStatus: string): 'sent' | 'failed' {
  return srfaxStatus.toLowerCase() === 'success' ? 'sent' : 'failed'
}

// ── Core webhook logic (separated so outer handler can catch all throws) ──────

async function handleFaxStatusWebhook(req: NextRequest): Promise<NextResponse> {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // SRFax sends application/x-www-form-urlencoded
  let body: Record<string, string>
  try {
    const text = await req.text()
    body = Object.fromEntries(new URLSearchParams(text))
  } catch {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const faxQueueId  = body.sFaxDetailsID?.trim()
  const srfaxStatus = body.sStatus?.trim()

  if (!faxQueueId || !srfaxStatus) {
    // Log field names only — never the raw body (may contain caller ID or remote fax info)
    console.warn('[fax-status] missing sFaxDetailsID or sStatus')
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Log delivery metadata only — no PHI
  console.log('[fax-status] received', { faxQueueId, srfaxStatus })

  const svc = createServiceClient()

  // ── Fetch the matching submission ─────────────────────────────────────────
  const { data: submission, error: fetchErr } = await svc
    .from('vcc_submissions')
    .select('id, agency_id, fax_status, fax_attempts, fax_confirmation_id, doctor_fax, filled_pdf_path, carrier')
    .eq('fax_confirmation_id', faxQueueId)
    .maybeSingle()
  // Note: client_name intentionally excluded — not needed for routing logic,
  // and omitting it prevents any accidental PHI exposure in downstream logs.

  if (fetchErr) {
    console.error('[fax-status] DB fetch error:', fetchErr.message)
    // Return 200 so SRFax does not re-fire; DB error logged for ops team
    return NextResponse.json({ ok: true, note: 'db_error' })
  }

  if (!submission) {
    console.warn('[fax-status] no submission found for queue ID:', faxQueueId)
    return NextResponse.json({ ok: true, note: 'unrecognised_fax_id' })
  }

  // ── Idempotency guard: skip if already in a terminal state ────────────────
  const TERMINAL_STATUSES = new Set(['signed', 'failed', 'expired'])
  if (TERMINAL_STATUSES.has(submission.fax_status ?? '')) {
    console.log('[fax-status] already terminal, skipping — submission:', submission.id)
    return NextResponse.json({ ok: true, note: 'already_terminal' })
  }

  const resolvedStatus  = mapSrFaxStatus(srfaxStatus)
  const attempts        = (submission.fax_attempts as number | null) ?? 0
  const newAttemptCount = attempts + 1

  // ── Success path ──────────────────────────────────────────────────────────
  if (resolvedStatus === 'sent') {
    const { error: updateErr } = await svc
      .from('vcc_submissions')
      .update({ fax_status: 'sent', fax_sent_at: new Date().toISOString() })
      .eq('id', submission.id)

    if (updateErr) {
      console.error('[fax-status] success update failed:', updateErr.message, '— submission:', submission.id)
    }

    // Audit: delivery metadata only, no PHI
    void svc.from('audit_log').insert({
      agency_id:     submission.agency_id,
      user_id:       null,
      action:        'FAX_DELIVERED',
      resource_type: 'vcc_submissions',
      resource_id:   submission.id,
      metadata: {
        fax_queue_id: faxQueueId,
        srfax_status: srfaxStatus,
        pages:        body.sPages ?? null,
      },
    })

    console.log('[fax-status] delivered — submission:', submission.id)
    return NextResponse.json({ ok: true, status: 'sent' })
  }

  // ── Failure path ──────────────────────────────────────────────────────────
  const canRetry = newAttemptCount < MAX_FAX_RETRIES
    && !!submission.doctor_fax
    && !!submission.filled_pdf_path

  if (canRetry) {
    try {
      const { data: fileBlob } = await svc.storage
        .from('VCC-filled')
        .download(submission.filled_pdf_path!)

      if (!fileBlob) {
        // PDF missing from storage — treat as unrecoverable for this attempt
        throw new Error('PDF not found in VCC-filled bucket')
      }

      const buf         = await fileBlob.arrayBuffer()
      const retryResult = await sendFax(
        new Uint8Array(buf),
        submission.doctor_fax!,
        // PHI-safe subject: submission UUID only, never beneficiary name
        `VCC Retry ${newAttemptCount}/${MAX_FAX_RETRIES} — ${submission.id}`
      )

      if (!retryResult.success) {
        throw new Error(`SRFax rejected retry: ${retryResult.error ?? 'unknown'}`)
      }

      // Retry queued successfully — update with new confirmation ID
      const { error: retryUpdateErr } = await svc
        .from('vcc_submissions')
        .update({
          fax_status:          'pending',
          fax_attempts:        newAttemptCount,
          fax_confirmation_id: retryResult.confirmationId ?? submission.fax_confirmation_id,
          fax_last_error:      `Retry ${newAttemptCount}: original SRFax status=${srfaxStatus}`,
        })
        .eq('id', submission.id)

      if (retryUpdateErr) {
        console.error('[fax-status] retry DB update failed:', retryUpdateErr.message)
      }

      console.log('[fax-status] retry queued — submission:', submission.id, 'attempt:', newAttemptCount)
      return NextResponse.json({ ok: true, status: 'retry_queued', attempt: newAttemptCount })

    } catch (retryErr: unknown) {
      const msg = retryErr instanceof Error ? retryErr.message : String(retryErr)
      // Log error code only — error messages are from our own code, not PHI
      console.error('[fax-status] retry failed — submission:', submission.id, '—', msg)
      // Fall through to final failure handler below
    }
  }

  // ── Final failure: retries exhausted, retry attempt failed, or no PDF ──────
  const { error: failUpdateErr } = await svc
    .from('vcc_submissions')
    .update({
      fax_status:     'failed',
      fax_attempts:   newAttemptCount,
      fax_last_error: `Final failure after ${newAttemptCount} attempt(s): SRFax status=${srfaxStatus}`,
    })
    .eq('id', submission.id)

  if (failUpdateErr) {
    console.error('[fax-status] final-failure DB update error:', failUpdateErr.message)
  }

  // Audit: submission reference only — no doctor_fax or client name
  void svc.from('audit_log').insert({
    agency_id:     submission.agency_id,
    user_id:       null,
    action:        'FAX_FAILED_FINAL',
    resource_type: 'vcc_submissions',
    resource_id:   submission.id,
    metadata: {
      fax_queue_id: faxQueueId,
      srfax_status: srfaxStatus,
      attempts:     newAttemptCount,
      // carrier is not PHI — safe to log for operational triage
      carrier:      submission.carrier ?? null,
    },
  })

  console.warn('[fax-status] final failure — submission:', submission.id, 'attempts:', newAttemptCount)
  return NextResponse.json({ ok: true, status: 'failed', attempts: newAttemptCount })
}

// ── Route handler ─────────────────────────────────────────────────────────────
//
// Outer try/catch guarantees a 200 response under ALL conditions.
// SRFax treats any non-2xx as a failed delivery and re-fires the webhook,
// potentially triggering duplicate processing or a retry storm.
// Unexpected errors are logged for ops; the 200 stops the retry loop.

export async function POST(req: NextRequest) {
  try {
    return await handleFaxStatusWebhook(req)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[fax-status] unhandled exception:', msg)
    return NextResponse.json({ ok: true, note: 'internal_error' })
  }
}
