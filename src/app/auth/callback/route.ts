/*
 * PKCE email-confirmation callback.
 *
 * Supabase sends confirmation emails with a one-time `code` query param when
 * the PKCE flow is enabled. This route exchanges the code for a session so
 * whichever browser opens the confirmation link gets a live session.
 *
 * Cross-browser note: if the user signed up in Browser A but clicked the link
 * in Browser B, Browser B now has a session. Browser A must sign in normally.
 * This is expected behavior — the confirmation link is single-use.
 *
 * MANUAL STEPS REQUIRED in the Supabase Dashboard:
 *
 *   Authentication → URL Configuration
 *     • Site URL:       https://www.aegissage.com
 *     • Redirect URLs:  https://www.aegissage.com/auth/callback
 *
 *   Authentication → Email Templates → "Confirm signup"
 *     • Sender name:    AegisSage
 *     • Sender email:   noreply@aegissage.com  (requires custom SMTP)
 *     • Subject line:   Confirm your AegisSage account
 *     • Ensure the confirmation URL in the template ends with
 *       ?code={{ .TokenHash }}&type=signup  (PKCE flow)
 *       or points to {{ .SiteURL }}/auth/callback?code={{ .TokenHash }}
 */

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(new URL(next, origin))
    }

    console.error('[auth/callback] exchangeCodeForSession failed:', error.message)
  }

  // Expired link, already-used code, or missing code param
  return NextResponse.redirect(
    new URL('/login?reason=confirmation_expired', origin)
  )
}
