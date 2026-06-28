import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/extension/connect
// Returns the broker's extension_api_key (permanent hex key stored in brokers table).
// Validated by sync/verify/sync-history via DB lookup — no JWT parsing.
export async function GET() {
  try {
    const supabase = await createClient()

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    console.log('[extension/connect] user:', user?.id ?? 'null', '| error:', userError?.message ?? 'none')

    if (userError || !user) {
      return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
    }

    // Use service client for DB queries — bypasses RLS
    const admin = createServiceClient()

    const { data: broker, error: brokerError } = await admin
      .from('brokers')
      .select('id, first_name, last_name, agency_id, extension_api_key')
      .eq('user_id', user.id)
      .maybeSingle()

    console.log('[extension/connect] broker:', broker?.id ?? 'null', '| error:', brokerError?.message ?? 'none')

    if (brokerError) {
      console.error('[extension/connect] broker query error:', brokerError.message, brokerError.code)
      return NextResponse.json({ error: 'Broker query failed: ' + brokerError.message }, { status: 500 })
    }

    if (!broker) {
      console.error('[extension/connect] no broker row for user:', user.id)
      return NextResponse.json({ error: 'No broker profile found for user ' + user.id }, { status: 404 })
    }

    // Generate API key on first connect if missing
    let apiKey = broker.extension_api_key as string | null
    if (!apiKey) {
      const bytes = crypto.getRandomValues(new Uint8Array(32))
      apiKey = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
      const { error: updateError } = await admin
        .from('brokers')
        .update({ extension_api_key: apiKey })
        .eq('id', broker.id)
      if (updateError) {
        console.error('[extension/connect] key generation failed:', updateError.message)
        return NextResponse.json({ error: 'Failed to generate API key' }, { status: 500 })
      }
      console.log('[extension/connect] generated new api key for broker:', broker.id)
    }

    console.log('[extension/connect] key length:', apiKey.length, '| prefix:', apiKey.slice(0, 20))

    let agencyName: string | null = null
    if (broker.agency_id) {
      const { data: ag } = await admin
        .from('agencies')
        .select('name')
        .eq('id', broker.agency_id)
        .maybeSingle()
      agencyName = ag?.name ?? null
    }
    if (!agencyName) {
      const { data: ownedAg } = await admin
        .from('agencies')
        .select('name')
        .eq('owner_id', user.id)
        .maybeSingle()
      agencyName = ownedAg?.name ?? null
    }

    const brokerName = `${broker.first_name ?? ''} ${broker.last_name ?? ''}`.trim() || user.email!

    return NextResponse.json({
      token: apiKey,
      broker_name: brokerName,
      agency: agencyName ?? 'Your Agency',
      user_email: user.email,
      user_id: user.id,
    })
  } catch (err: any) {
    console.error('[extension/connect] unexpected error:', err?.message ?? String(err))
    return NextResponse.json({ error: 'Server error: ' + (err?.message ?? 'unknown') }, { status: 500 })
  }
}
