/**
 * POST /api/admin/reset-password
 *
 * Admin-only endpoint to generate a Supabase password-reset magic link
 * for a given email address and optionally force-set a temporary password.
 *
 * Requires the caller to supply the ADMIN_API_SECRET header that matches
 * the ADMIN_API_SECRET environment variable.  Never expose this endpoint
 * publicly — it must sit behind an authenticated admin UI or be called
 * directly from the terminal during incident response.
 *
 * Body (JSON):
 *   {
 *     email:     string   — target account email (required)
 *     newPassword?: string — if provided, directly updates the password
 *                           (useful for dev/testing; skip in production)
 *   }
 *
 * Response:
 *   { ok: true, action: 'magic_link_sent' | 'password_updated', email }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// ── Service-role client (bypasses RLS) ───────────────────────────────────────
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// ── Guard: validate admin secret ─────────────────────────────────────────────
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.ADMIN_API_SECRET
  if (!secret) {
    // No secret configured → only allow in development
    return process.env.NODE_ENV === 'development'
  }
  return req.headers.get('x-admin-secret') === secret
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { email?: string; newPassword?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { email, newPassword } = body

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'email is required' }, { status: 400 })
  }

  const adminClient = getAdminClient()

  // ── Option A: Direct password update (dev/testing only) ──────────────────
  if (newPassword) {
    // Look up the user id first
    const { data: { users }, error: listErr } = await adminClient.auth.admin.listUsers()
    if (listErr) {
      return NextResponse.json({ error: listErr.message }, { status: 500 })
    }

    const target = users.find(u => u.email?.toLowerCase() === email.toLowerCase())
    if (!target) {
      return NextResponse.json({ error: `No user found with email: ${email}` }, { status: 404 })
    }

    const { error: updateErr } = await adminClient.auth.admin.updateUserById(
      target.id,
      { password: newPassword }
    )
    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 })
    }

    console.log(`[admin/reset-password] password updated for ${email}`)
    return NextResponse.json({ ok: true, action: 'password_updated', email })
  }

  // ── Option B: Generate a password-reset magic link ────────────────────────
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.aegissage.com'
  const { data, error } = await adminClient.auth.admin.generateLink({
    type:       'recovery',
    email,
    options: {
      redirectTo: `${appUrl}/auth/update-password`,
    },
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log(`[admin/reset-password] recovery link generated for ${email}:`, data.properties?.action_link)

  return NextResponse.json({
    ok:            true,
    action:        'magic_link_sent',
    email,
    // Return the link directly — caller decides whether to send via email or use it directly
    recovery_link: data.properties?.action_link ?? null,
  })
}
