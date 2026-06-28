/**
 * AegisSage Next.js Edge Middleware
 *
 * Enforces authentication on all protected routes at the edge — before any
 * page component, server action, or API route handler executes.
 *
 * Protected: /dashboard/*, /settings/*, /api/billing/*, /api/ghl/* (dashboard-initiated)
 * Public:    /, /login, /signup, /api/ghl/connect, /api/auth-connect/callback,
 *            /api/extension/sync, /api/stripe/webhook, /api/cron/*
 *
 * HIPAA note: This is the first authentication gate. It does NOT replace
 * per-route auth checks (getUser() calls) — those remain as defense-in-depth.
 * This layer prevents unauthenticated requests from reaching any PHI-handling
 * server component or action.
 */

import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { logEnterpriseEvent } from '@/lib/audit/log-enterprise-event'

// ── Routes that must always be publicly accessible ───────────────────────────
const PUBLIC_PATHS = [
  '/',
  '/login',
  '/signup',
  '/pricing',
  '/privacy',
  '/support',
  '/auth/reset-password',
  '/auth/confirm',
  '/auth/callback',   // PKCE email confirmation callback — no session yet
  '/auth/set-password', // invite landing — session cookies may not be readable on first hop
  '/sign/aor',        // public AOR signing page (token-gated, not session-gated)
  '/privacy-policy',
  '/terms-of-service',
  '/security-compliance',
  '/baa',
  '/compliance',
  '/account-deleted',
  '/about',
  '/careers',
  '/terms',
]

// ── API routes accessible without a dashboard session ────────────────────────
// These have their own auth mechanisms (HMAC, Bearer key, Stripe sig, etc.)
const PUBLIC_API_PREFIXES = [
  '/api/ghl/connect',           // initiates OAuth — redirects to GHL
  '/api/auth-connect/callback', // OAuth callback — no session cookie yet
  '/api/connect/callback',      // alternate callback path
  '/api/extension/sync',        // Chrome Extension — Bearer key auth
  '/api/extension/verify',
  '/api/extension/alerts',
  '/api/marx',                  // Chrome Extension MARx endpoints
  '/api/stripe/webhook',        // Stripe HMAC verified
  '/api/cron',                  // Vercel cron — CRON_SECRET Bearer
  '/api/scheduler',
  '/api/ghl/sync-status',       // polled from upload page before auth resolves
  '/api/auth/heartbeat',        // Extension heartbeat — extends session during long jobs
]

function isPublicPath(pathname: string): boolean {
  // Exact match
  if (PUBLIC_PATHS.includes(pathname)) return true
  // Prefix match for public pages
  if (pathname.startsWith('/sign/aor/')) return true
  if (pathname.startsWith('/lp/')) return true
  // API prefix match
  if (PUBLIC_API_PREFIXES.some(p => pathname.startsWith(p))) return true
  // Static files and Next.js internals
  if (pathname.startsWith('/_next/')) return true
  if (pathname.startsWith('/favicon')) return true
  if (pathname.startsWith('/images/')) return true
  return false
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Always pass through public paths without any auth check
  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  // ── Supabase session check ────────────────────────────────────────────────
  // createServerClient in middleware uses cookies() to read the Supabase JWT.
  // We call getUser() (server-validated JWT) not getSession() (cookie-only read).
  const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  const response = NextResponse.next({
    request: { headers: req.headers },
  })

  const supabase = createServerClient(supabaseUrl, supabaseAnon, {
    cookies: {
      getAll() {
        return req.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        )
      },
    },
  })

  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (!user) {
    // Not authenticated — redirect to login with the original URL as redirect param
    const loginUrl = new URL('/login', req.url)
    // Only set redirect param for dashboard routes (not API routes — those return 401)
    if (pathname.startsWith('/dashboard') || pathname.startsWith('/settings')) {
      loginUrl.searchParams.set('redirect', pathname)
    } else if (pathname.startsWith('/api/')) {
      // API routes return 401 JSON, not a redirect
      return NextResponse.json(
        { error: 'Unauthorized — valid session required' },
        { status: 401 }
      )
    }
    return NextResponse.redirect(loginUrl)
  }

  // ── Enforce 15-minute absolute session timeout ─────────────────────────────
  // HIPAA workstation timeout: session expires after 15 minutes of inactivity
  // However, if the Chrome extension is actively running a bulk job and sending
  // heartbeat pings, the session is kept alive even without UI activity.
  const now = Math.floor(Date.now() / 1000)
  const maxAgeSeconds = 15 * 60 // 15 minutes

  // Check session expiry from Supabase
  const { data: { session } } = await supabase.auth.getSession()
  if (session) {
    // session.expires_at is a Unix timestamp in SECONDS — compare directly to now.
    // A negative sessionAge means the token hasn't expired yet (correct, no timeout).
    // Previously this used `new Date(session.expires_at)` which treated seconds as
    // milliseconds, resulting in a date in 1970 and sessionAge always ~56 years,
    // causing every authenticated request to trigger the timeout redirect.
    const expiresAt = session.expires_at ?? 0
    const sessionAge = now - expiresAt

    // Check for recent heartbeat activity from Chrome extension
    const lastHeartbeatCookie = req.cookies.get('last_heartbeat')?.value
    const lastHeartbeat = lastHeartbeatCookie ? parseInt(lastHeartbeatCookie, 10) : 0
    const heartbeatAge = now - lastHeartbeat
    const hasRecentHeartbeat = heartbeatAge < maxAgeSeconds

    // If session is expired or older than 15 minutes AND no recent heartbeat, force logout
    if (sessionAge > maxAgeSeconds && !hasRecentHeartbeat) {
      const sessionStartCookie = req.cookies.get('as_session_start')?.value
      const agencyIdCookie     = req.cookies.get('as_agency_id')?.value ?? null
      const sessionStart       = sessionStartCookie ? parseInt(sessionStartCookie, 10) : null
      const lastHeartbeatAt    = lastHeartbeat > 0
        ? new Date(lastHeartbeat * 1000).toISOString()
        : null

      // Fire-and-forget: audit write must never block or delay the redirect response.
      // The enterprise_audit_logs table may not exist yet — logEnterpriseEvent already
      // swallows errors internally, but awaiting it would stall the middleware until
      // the failed write times out, masking the real cause of the 307 redirect.
      void logEnterpriseEvent({
        agencyId:     agencyIdCookie,
        userId:       user.id,
        actionType:   'SESSION_END',
        resourceType: 'session',
        clientIp:     req.headers.get('x-forwarded-for') ?? undefined,
        userAgent:    req.headers.get('user-agent') ?? undefined,
        metadata: {
          reason:                   'inactivity_timeout',
          session_duration_seconds: sessionStart !== null ? now - sessionStart : null,
          last_heartbeat_at:        lastHeartbeatAt,
        },
      })

      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('redirect', pathname)
      loginUrl.searchParams.set('reason', 'session_timeout')
      return NextResponse.redirect(loginUrl)
    }
  }

  // Authenticated — allow through
  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image  (image optimization)
     * - favicon.ico
     * - public folder files
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
