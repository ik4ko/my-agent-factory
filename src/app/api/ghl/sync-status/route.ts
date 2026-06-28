/**
 * GET /api/ghl/sync-status
 *
 * Returns the current GHL sync state for the authenticated broker's agency.
 * Used by the GHL page to poll for live progress during a bulk import.
 *
 * Response:
 *   {
 *     connected: boolean,
 *     sync_status: 'pending'|'running'|'partial'|'complete'|'error'|null,
 *     sync_total: number|null,     — contacts imported so far
 *     has_more: boolean,           — true when a resumable cursor exists
 *     last_synced_at: string|null,
 *     location_id: string|null,
 *     token_expires_at: string|null,
 *   }
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  // getUser() validates the JWT server-side. getSession() only reads the cookie
  // and is vulnerable to replayed tokens — never use it for authorization checks.
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const svc = createServiceClient()

  const { data: broker } = await svc
    .from('brokers')
    .select('id, agency_id')
    .eq('user_id', user.id)
    .single()

  if (!broker) {
    return NextResponse.json({ connected: false, sync_status: null })
  }

  const { data: cred } = await svc
    .from('agency_credentials')
    .select('access_token, expires_at, location_id, last_synced_at, sync_status, sync_total, sync_cursor')
    .eq('agency_id', broker.agency_id)
    .maybeSingle()

  if (!cred?.access_token) {
    return NextResponse.json({ connected: false, sync_status: null })
  }

  const isExpired = new Date(cred.expires_at ?? 0) <= new Date()

  return NextResponse.json({
    connected:        !isExpired,
    sync_status:      (cred as Record<string, unknown>).sync_status ?? null,
    sync_total:       (cred as Record<string, unknown>).sync_total ?? null,
    has_more:         !!((cred as Record<string, unknown>).sync_cursor),
    last_synced_at:   (cred as Record<string, unknown>).last_synced_at ?? null,
    location_id:      cred.location_id ?? null,
    token_expires_at: cred.expires_at,
  })
}
