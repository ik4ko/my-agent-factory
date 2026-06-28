import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logEnterpriseEvent } from '@/lib/audit/log-enterprise-event'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 15 * 60,
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
 * POST /api/auth/heartbeat
 *
 * Auth heartbeat endpoint for Chrome extension background jobs.
 *
 * When a bulk MARx search or data sync job is actively processing in the extension,
 * the extension should ping this endpoint every 30-60 seconds to reset the
 * 15-minute session countdown. This prevents HIPAA inactivity timeout from
 * interrupting long-running automation jobs.
 *
 * The endpoint requires an authenticated Supabase session and:
 * 1. Refreshes the session to extend its validity
 * 2. Sets a last_heartbeat cookie that the proxy uses to track active jobs
 * 3. Logs a SESSION_START audit event once per session (cookie-deduplicated)
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: { session }, error: refreshError } = await supabase.auth.refreshSession()

  if (refreshError) {
    console.error('[auth/heartbeat] session refresh failed:', refreshError.message)
    return NextResponse.json({ error: 'Session refresh failed' }, { status: 500 })
  }

  const now = Math.floor(Date.now() / 1000)

  // SESSION_START deduplication: as_session_logged is set on first heartbeat and
  // renewed every subsequent heartbeat. Its 15-min maxAge mirrors the HIPAA timeout,
  // so if the extension goes quiet for >15 min, the flag naturally expires and the
  // next heartbeat correctly fires a new SESSION_START.
  const isSessionLogged = req.cookies.get('as_session_logged')?.value === '1'

  // Preserve the original session-start timestamp across heartbeats; don't reset it.
  const sessionStartTs = isSessionLogged
    ? (req.cookies.get('as_session_start')?.value ?? now.toString())
    : now.toString()

  const response = NextResponse.json({
    success: true,
    user_id: user.id,
    expires_at: session?.expires_at,
  })

  // Always refresh all session cookie TTLs on each heartbeat.
  response.cookies.set('last_heartbeat', now.toString(), COOKIE_OPTS)
  response.cookies.set('as_session_logged', '1', COOKIE_OPTS)
  response.cookies.set('as_session_start', sessionStartTs, COOKIE_OPTS)

  if (!isSessionLogged) {
    const agencyId = await resolveAgencyId(supabase, user.id)

    if (agencyId) {
      response.cookies.set('as_agency_id', agencyId, COOKIE_OPTS)
    }

    await logEnterpriseEvent({
      agencyId,
      userId:       user.id,
      actionType:   'SESSION_START',
      resourceType: 'session',
      clientIp:     req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? undefined,
      userAgent:    req.headers.get('user-agent') ?? undefined,
      metadata: {
        ip:         req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? null,
        user_agent: req.headers.get('user-agent') ?? null,
      },
    })
  } else {
    // Refresh as_agency_id TTL so it doesn't expire before the session ends.
    const agencyId = req.cookies.get('as_agency_id')?.value
    if (agencyId) {
      response.cookies.set('as_agency_id', agencyId, COOKIE_OPTS)
    }
  }

  return response
}
