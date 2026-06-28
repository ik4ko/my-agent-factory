import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createHmac } from 'crypto';

// ── CSRF state verification ───────────────────────────────────────────────────
// Must match the secret and algorithm in ghl/connect/route.ts
const STATE_SECRET = process.env.GHL_STATE_SECRET;

function verifyGhlState(state: string): string | null {
  if (!STATE_SECRET) {
    // Hard fail — no secret means no CSRF protection at all
    console.error('[auth-connect/callback] GHL_STATE_SECRET is not set — rejecting all OAuth callbacks');
    return null;
  }
  try {
    const decoded  = Buffer.from(state, 'base64url').toString('utf8');
    const parts    = decoded.split('.');
    if (parts.length !== 3) return null;
    const [userId, nonce, receivedSig] = parts;
    const payload  = `${userId}.${nonce}`;
    const expected = createHmac('sha256', STATE_SECRET).update(payload).digest('hex').slice(0, 16);
    if (receivedSig !== expected) return null;
    return userId;
  } catch {
    return null;
  }
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:9002';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get('code');

  if (!code) {
    console.error('[GHL callback] missing code param');
    return NextResponse.redirect(`${APP_URL}/dashboard/churn/upload?ghl=error`);
  }

  // ── CSRF: verify state param ────────────────────────────────────────────────
  // The state was signed with GHL_STATE_SECRET in ghl/connect/route.ts.
  // If it's missing, tampered, or signed with a different secret, reject immediately.
  const stateParam = searchParams.get('state');
  if (!stateParam) {
    console.error('[auth-connect/callback] missing state param — possible CSRF');
    return NextResponse.redirect(`${APP_URL}/dashboard/churn/upload?ghl=error&reason=invalid_state`);
  }

  // Also verify against the cookie we set in ghl/connect/route.ts
  const cookieStoreEarly = await cookies();
  const cookieState = cookieStoreEarly.get('ghl_oauth_state')?.value;
  if (!cookieState || cookieState !== stateParam) {
    console.error('[auth-connect/callback] state cookie mismatch — possible CSRF');
    return NextResponse.redirect(`${APP_URL}/dashboard/churn/upload?ghl=error&reason=invalid_state`);
  }

  const stateUserId = verifyGhlState(stateParam);
  if (!stateUserId) {
    console.error('[auth-connect/callback] state HMAC verification failed — rejecting');
    return NextResponse.redirect(`${APP_URL}/dashboard/churn/upload?ghl=error&reason=invalid_state`);
  }

  // Clear the state cookie — single use
  cookieStoreEarly.delete('ghl_oauth_state');

  const clientId     = process.env.GHL_CLIENT_ID;
  const clientSecret = process.env.GHL_CLIENT_SECRET;

  // Self-healing redirect URI: GHL bans "ghl" in registered redirect URIs.
  // Auto-correct if GHL_REDIRECT_URI is unset or still holds the deprecated path.
  const rawUri     = process.env.GHL_REDIRECT_URI ?? '';
  const appOrigin  = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.aegissage.com';
  const redirectUri = (!rawUri || rawUri.includes('/api/ghl/callback'))
    ? `${appOrigin}/api/connect/callback`
    : rawUri;

  if (rawUri && rawUri.includes('/api/ghl/callback')) {
    console.warn('[auth-connect/callback] GHL_REDIRECT_URI points at deprecated /api/ghl/callback — auto-corrected.');
  }

  if (!clientId || !clientSecret) {
    console.error('[GHL callback] GHL env vars not configured');
    return NextResponse.redirect(`${APP_URL}/dashboard/churn/upload?ghl=error&reason=ghl_not_configured`);
  }

  try {
    // -- 1. Verify authenticated session and resolve agency_id ----------------
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options));
            } catch {}
          },
        },
      }
    );

    const { data: { user }, error: sessionError } = await supabase.auth.getUser();
    if (sessionError || !user) {
      console.error('[GHL callback] no authenticated session:', sessionError);
      return NextResponse.redirect(`${APP_URL}/login`);
    }

    const { data: broker, error: brokerError } = await supabase
      .from('brokers')
      .select('agency_id')
      .eq('user_id', user.id)
      .single();

    if (brokerError || !broker) {
      console.error('[GHL callback] broker lookup failed:', brokerError);
      return NextResponse.redirect(`${APP_URL}/dashboard/churn/upload?ghl=error&reason=oauth_failed`);
    }

    const agencyId = broker.agency_id;

    // -- 2. Exchange code for tokens ------------------------------------------
    const tokenRes = await fetch('https://services.leadconnectorhq.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error('[GHL callback] token exchange failed:', tokenRes.status, errText);
      return NextResponse.redirect(`${APP_URL}/dashboard/churn/upload?ghl=error&reason=oauth_failed`);
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      locationId?: string;
      companyId?: string;
    };

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
    const locationId = tokenData.locationId ?? tokenData.companyId ?? null;

    // -- 3. Single upsert into agency_credentials -----------------------------
    const { error: upsertError } = await supabaseAdmin
      .from('agency_credentials')
      .upsert(
        {
          agency_id: agencyId,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: expiresAt,
          location_id: locationId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'agency_id' }
      );

    if (upsertError) {
      console.error('[GHL callback] agency_credentials upsert failed:', upsertError);
      return NextResponse.redirect(`${APP_URL}/dashboard/churn/upload?ghl=error&reason=oauth_failed`);
    }

    // -- 4. Append-only audit entry -------------------------------------------
    await supabaseAdmin.from('audit_log').insert({
      agency_id: agencyId,
      user_id: user.id,
      action: 'GHL_CONNECTED',
      resource_type: 'agency_credentials',
      resource_id: locationId ?? agencyId,
      metadata: { expires_at: expiresAt, location_id: locationId },
    });

    // -- 5. Success — return inline HTML that closes the popup cleanly ----------
    // Redirecting the popup to the full Next.js dashboard page causes the
    // "empty tab" UX issue: the popup has no dashboard session cookie, so the
    // heavy page load either stalls or shows the login screen.
    // Returning a minimal HTML page that postMessages the parent and
    // self-closes is instant and requires no session context in the popup.
    const fallbackUrl = `${APP_URL}/dashboard/churn/upload?ghl=connected`;
    return new Response(
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>GoHighLevel Connected</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center;
           justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #94a3b8; }
    p { font-size: 13px; letter-spacing: .05em; text-transform: uppercase; font-weight: 700; }
  </style>
</head>
<body>
  <p>Connected ✓ — closing window…</p>
  <script>
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: 'GHL_OAUTH_SUCCESS' }, window.location.origin);
        window.close();
      } else {
        // No opener context (direct navigation / popup blocked) — redirect parent tab
        window.location.replace(${JSON.stringify(fallbackUrl)});
      }
    } catch (e) {
      window.location.replace(${JSON.stringify(fallbackUrl)});
    }
  </script>
</body>
</html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );

  } catch (err: any) {
    console.error('[GHL callback] unexpected error:', err?.message ?? err);
    const errFallback = `${APP_URL}/dashboard/churn/upload?ghl=error`;
    return new Response(
      `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<script>
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'GHL_OAUTH_ERROR' }, window.location.origin);
      window.close();
    } else { window.location.replace(${JSON.stringify(errFallback)}); }
  } catch(e) { window.location.replace(${JSON.stringify(errFallback)}); }
</script></body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}
