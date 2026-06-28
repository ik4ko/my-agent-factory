import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: agency }, { data: brokerRow }] = await Promise.all([
    supabase.from('agencies').select('id').eq('owner_id', user.id).maybeSingle(),
    supabase.from('brokers').select('id, role, agency_id').eq('user_id', user.id).maybeSingle(),
  ])

  const agencyId = agency?.id ?? brokerRow?.agency_id
  if (!agencyId) return NextResponse.json({ error: 'No agency' }, { status: 403 })

  const supabaseAdmin = createServiceClient()

  const [
    { count: critical },
    { count: high },
    { count: total },
    { data: lastAlert },
  ] = await Promise.all([
    supabaseAdmin
      .from('switch_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('agency_id', agencyId)
      .eq('priority', 'critical')
      .in('status', ['open', 'contacted']),
    supabaseAdmin
      .from('switch_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('agency_id', agencyId)
      .eq('priority', 'high')
      .in('status', ['open', 'contacted']),
    supabaseAdmin
      .from('switch_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('agency_id', agencyId)
      .in('status', ['open', 'contacted']),
    supabaseAdmin
      .from('switch_alerts')
      .select('detected_at')
      .eq('agency_id', agencyId)
      .order('detected_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return NextResponse.json({
    critical: critical ?? 0,
    high: high ?? 0,
    total: total ?? 0,
    lastAlertAt: lastAlert?.detected_at ?? null,
  })
}
