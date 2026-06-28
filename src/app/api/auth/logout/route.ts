import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logEnterpriseEvent } from '@/lib/audit/log-enterprise-event'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CLEAR_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 0,
  path: '/',
}

async function resolveAgencyId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data: agencyRow } = await supabase
    .from('agencies')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()
  if (agencyRow?.id) return agencyRow.id as string

  const { data: brokerRow } = await supabase
    .from('brokers')
    .select('agency_id')
    .eq('user_id', userId)
    .maybeSingle()
  return (brokerRow?.agency_id as string) ?? null
}

/**
 * POST /api/auth/logout
 *
 * Logs a SESSION_END audit event (reason: explicit_logout), then invalidates
 * the Supabase session and clears all session-lifecycle cookies.
 *
 * Must be called before any client-side signOut so the audit event is
 * written while the session is still valid.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const now              = Math.floor(Date.now() / 1000)
    const sessionStartRaw  = req.cookies.get('as_session_start')?.value
    const lastHeartbeatRaw = req.cookies.get('last_heartbeat')?.value
    const agencyIdCookie   = req.cookies.get('as_agency_id')?.value ?? null

    const sessionStart   = sessionStartRaw   ? parseInt(sessionStartRaw, 10)   : null
    const lastHeartbeatN = lastHeartbeatRaw  ? parseInt(lastHeartbeatRaw, 10)  : null
    const lastHeartbeatAt = lastHeartbeatN !== null
      ? new Date(lastHeartbeatN * 1000).toISOString()
      : null

    // Prefer the cookie-cached agencyId (no extra query needed for extension users).
    // Fall back to a DB lookup for web-only users who never sent a heartbeat.
    const agencyId = agencyIdCookie ?? await resolveAgencyId(supabase, user.id)

    await logEnterpriseEvent({
      agencyId,
      userId:       user.id,
      actionType:   'SESSION_END',
      resourceType: 'session',
      clientIp:     req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? undefined,
      userAgent:    req.headers.get('user-agent') ?? undefined,
      metadata: {
        reason:                   'explicit_logout',
        session_duration_seconds: sessionStart !== null ? now - sessionStart : null,
        last_heartbeat_at:        lastHeartbeatAt,
      },
    })
  }

  // Invalidate the Supabase session regardless of whether the user was found.
  await supabase.auth.signOut()

  const response = NextResponse.json({ success: true })

  response.cookies.set('as_session_logged', '', CLEAR_OPTS)
  response.cookies.set('as_session_start',  '', CLEAR_OPTS)
  response.cookies.set('as_agency_id',      '', CLEAR_OPTS)
  response.cookies.set('last_heartbeat',    '', CLEAR_OPTS)

  return response
}
