import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { credId, carrier, code } = await req.json()
  if (!credId || !code) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const supabaseAdmin = createServiceClient()

  // Verify the credential belongs to this user's agency
  const [{ data: agency }, { data: brokerRow }] = await Promise.all([
    supabase.from('agencies').select('id').eq('owner_id', user.id).maybeSingle(),
    supabase.from('brokers').select('id, agency_id').eq('user_id', user.id).maybeSingle(),
  ])
  const agencyId = agency?.id ?? brokerRow?.agency_id
  if (!agencyId) return NextResponse.json({ error: 'No agency' }, { status: 403 })

  const { data: cred } = await supabaseAdmin
    .from('carrier_logins')
    .select('id')
    .eq('id', credId)
    .eq('agency_id', agencyId)
    .maybeSingle()

  if (!cred) return NextResponse.json({ error: 'Credential not found' }, { status: 404 })

  // Mark credential as active — the MFA code handling is implemented
  // when the full Playwright session resumption is wired up.
  await supabaseAdmin
    .from('carrier_logins')
    .update({ status: 'active', last_mfa_required_at: null })
    .eq('id', credId)

  await supabaseAdmin.from('audit_log').insert({
    agency_id: agencyId,
    user_id: user.id,
    action: 'CARRIER_MFA_SUBMITTED',
    resource_type: 'carrier_logins',
    resource_id: carrier,
    metadata: { credId, carrier },
  })

  return NextResponse.json({ ok: true })
}
