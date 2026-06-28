import { createServiceClient } from '@/lib/supabase/service'

const GHL_BASE = 'https://services.leadconnectorhq.com'
const GHL_VERSION = '2021-07-28'

interface AgencyCredentials {
  access_token: string | null
  refresh_token: string | null
  expires_at: string | null
  location_id: string | null
}

async function getValidToken(agencyId: string): Promise<{ token: string; locationId: string } | null> {
  const supabase = createServiceClient()

  const { data: creds } = await supabase
    .from('agency_credentials')
    .select('access_token, refresh_token, expires_at, location_id')
    .eq('agency_id', agencyId)
    .maybeSingle()

  if (!creds?.access_token || !creds.refresh_token) return null

  const expiresAt = creds.expires_at ? new Date(creds.expires_at) : null
  const isExpired = !expiresAt || expiresAt.getTime() - Date.now() < 60_000

  if (!isExpired) {
    return { token: creds.access_token, locationId: creds.location_id ?? '' }
  }

  // Refresh token
  try {
    const res = await fetch(`${GHL_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refresh_token,
        client_id: process.env.GHL_CLIENT_ID ?? '',
        client_secret: process.env.GHL_CLIENT_SECRET ?? '',
      }),
    })

    if (!res.ok) return null

    const json = await res.json()
    const newExpiry = new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString()

    await supabase
      .from('agency_credentials')
      .update({
        access_token: json.access_token,
        refresh_token: json.refresh_token ?? creds.refresh_token,
        expires_at: newExpiry,
        updated_at: new Date().toISOString(),
      })
      .eq('agency_id', agencyId)

    return { token: json.access_token, locationId: creds.location_id ?? '' }
  } catch {
    return null
  }
}

export async function ghlFetch(
  agencyId: string,
  path: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const auth = await getValidToken(agencyId)
  if (!auth) return { ok: false, status: 401, data: { error: 'no_ghl_credentials' } }

  const url = `${GHL_BASE}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${auth.token}`,
      Version: GHL_VERSION,
      ...(options.headers ?? {}),
    },
  })

  let data: unknown = null
  try { data = await res.json() } catch { data = null }

  return { ok: res.ok, status: res.status, data }
}

export async function getGHLLocationId(agencyId: string): Promise<string | null> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('agency_credentials')
    .select('location_id')
    .eq('agency_id', agencyId)
    .maybeSingle()
  return data?.location_id ?? null
}
