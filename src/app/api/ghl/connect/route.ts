import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createHmac } from 'crypto'

export const dynamic = 'force-dynamic'

// ── State token helpers ───────────────────────────────────────────────────────
// State encodes userId so the callback can identify the user even if the
// Supabase session cookie is dropped during the GHL OAuth redirect cycle.
// Format (base64url): <userId>.<nonce>.<hmac_first16>

// Hard fail if GHL_STATE_SECRET is not set — no silent fallback.
// Set this to a 32-byte random hex: openssl rand -hex 32
if (!process.env.GHL_STATE_SECRET) {
  throw new Error('[ghl/connect] GHL_STATE_SECRET env var is required but not set. Set it in Vercel Environment Variables.');
}
const STATE_SECRET = process.env.GHL_STATE_SECRET

export function createGhlState(userId: string): string {
  const nonce = Math.random().toString(36).slice(2, 10)
  const payload = `${userId}.${nonce}`
  const sig = createHmac('sha256', STATE_SECRET).update(payload).digest('hex').slice(0, 16)
  return Buffer.from(`${payload}.${sig}`).toString('base64url')
}

export async function GET(req: NextRequest) {
  // ── Client ID guard ───────────────────────────────────────────────────────
  // Accept GHL_CLIENT_ID or the NEXT_PUBLIC_ variant (used in some setups).
  // Trim to catch " " whitespace-only values that pass !clientId but are
  // invalid — GHL rejects those with "appId must be a valid app id".
  const clientId = (
    process.env.GHL_CLIENT_ID ?? process.env.NEXT_PUBLIC_GHL_CLIENT_ID ?? ''
  ).trim()

  // ── Redirect URI resolution ───────────────────────────────────────────────
  // Rules:
  //   1. NEXT_PUBLIC_APP_URL must be set — we never derive origin from the
  //      incoming request because a www vs non-www mismatch causes GHL to
  //      reject the authorization (redirect_uri must match the registered URI
  //      exactly, including scheme and host).
  //   2. GHL bans any registered redirect URI containing the substring "ghl".
  //      The compliant path is /api/connect/callback.
  //   3. If GHL_REDIRECT_URI is set and already points at the compliant path,
  //      use it verbatim. Otherwise auto-correct and warn.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) {
    console.error('[ghl/connect] NEXT_PUBLIC_APP_URL is not set — cannot build a stable redirect URI')
    return NextResponse.json(
      {
        error: 'Server misconfiguration',
        hint:  'Set NEXT_PUBLIC_APP_URL=https://www.aegissage.com in Vercel environment variables',
      },
      { status: 503 }
    )
  }
  const origin         = appUrl.replace(/\/$/, '') // strip trailing slash
  const rawRedirectUri = process.env.GHL_REDIRECT_URI ?? ''
  const isDeprecated   = rawRedirectUri.includes('/api/ghl/callback')
  const redirectUri    = (!rawRedirectUri || isDeprecated)
    ? `${origin}/api/connect/callback`
    : rawRedirectUri

  if (isDeprecated) {
    console.warn(
      '[ghl/connect] GHL_REDIRECT_URI still points at the deprecated /api/ghl/callback path.' +
      ` Auto-corrected to "${redirectUri}". Set GHL_REDIRECT_URI=${redirectUri} to suppress this warning.`
    )
  }

  // clientId.length < 10 catches placeholder values like "5" or "abc" that are
  // truthy but not valid GHL App IDs — GHL rejects them with "appId must be a
  // valid app id". The guard surfaces the exact value in the error response so
  // the correct ID can be confirmed against the GHL Marketplace settings.
  if (!clientId || clientId.length < 10) {
    console.error('[ghl/connect] GHL_CLIENT_ID is missing or invalid:', clientId)
    return NextResponse.json(
      {
        error:   `GHL_CLIENT_ID not configured. Current value: "${clientId}"`,
        hint:    [
          'Set GHL_CLIENT_ID in Vercel Environment Variables (Settings → Environment Variables).',
          'The variable must be named GHL_CLIENT_ID, not GHL_APP_ID or NEXT_PUBLIC_GHL_CLIENT_ID.',
          'After adding the variable, redeploy the project for it to take effect.',
        ].join(' '),
        redirect_uri_in_use: redirectUri,
      },
      { status: 503 }
    )
  }

  // Resolve the logged-in user — needed to embed userId in state.
  // getUser() validates the JWT server-side with Supabase Auth.
  // getSession() only reads the cookie without server verification and is
  // vulnerable to replayed or tampered tokens — consistent with all other routes.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // ── Smart Login Detection ───────────────────────────────────────────────────
  // Check if the user already has a valid GHL access token before redirecting to OAuth.
  // This prevents unnecessary OAuth flows when the user is already connected.
  const { data: broker } = await supabase
    .from('brokers')
    .select('agency_id')
    .eq('user_id', user.id)
    .single()

  if (broker?.agency_id) {
    const { data: credentials } = await supabase
      .from('agency_credentials')
      .select('access_token, expires_at')
      .eq('agency_id', broker.agency_id)
      .single()

    if (credentials?.access_token && credentials.expires_at) {
      const expiresAt = new Date(credentials.expires_at)
      const now = new Date()

      if (expiresAt > now) {
        // Valid, unexpired token exists — bypass OAuth redirect
        return NextResponse.json({
          connected: true,
          status: 'active_session_detected'
        })
      }
    }
  }

  const state = createGhlState(user.id)

  const authUrl = new URL('https://marketplace.gohighlevel.com/oauth/chooselocation')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', 'contacts.readonly contacts.write locations.readonly')
  authUrl.searchParams.set('state', state)

  // Log the full OAuth URL so the client_id param can be verified before the
  // redirect fires. In production this appears in Vercel Function logs.
  console.log('[ghl/connect] initiating OAuth', {
    redirectUri,
    userId:   user.id.slice(0, 8) + '…',
    clientId: clientId.slice(0, 8) + '…',  // partial — never log full secret
    oauthUrl: authUrl.toString(),
  })

  const response = NextResponse.redirect(authUrl.toString())

  // Store state in a short-lived cookie for CSRF verification in the callback.
  // sameSite:'lax' ensures it is sent when GHL top-level-redirects back to us.
  response.cookies.set('ghl_oauth_state', state, {
    httpOnly: true,
    secure:   true,
    sameSite: 'lax',
    maxAge:   600, // 10 minutes
    path:     '/',
  })

  return response
}
