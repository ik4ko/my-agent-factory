import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { ConfidenceScoringEngine } from '@/lib/detection/confidence-scoring-engine'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ alertId: string }> }
) {
  try {
    const { alertId } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const supabaseAdmin = createServiceClient()

    // Verify alert exists and caller belongs to the same agency
    const { data: alert, error: alertErr } = await supabaseAdmin
      .from('switch_alerts')
      .select('id, carrier, broker_id, agency_id')
      .eq('id', alertId)
      .single()

    if (alertErr || !alert) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
    }

    // Confirm caller is in the same agency (either owner or broker member)
    const [{ data: agency }, { data: brokerRow }] = await Promise.all([
      supabase.from('agencies').select('id').eq('owner_id', user.id).maybeSingle(),
      supabase.from('brokers').select('id, role, agency_id').eq('user_id', user.id).maybeSingle(),
    ])

    const callerAgencyId = agency?.id ?? brokerRow?.agency_id
    if (callerAgencyId !== alert.agency_id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const engine = new ConfidenceScoringEngine()
    const result = await engine.processFalseAlarmFeedback({
      alertId,
      brokerId: alert.broker_id,
      agencyId: alert.agency_id,
      carrier: alert.carrier,
    })

    return NextResponse.json({
      success: true,
      thresholdChanged: result.thresholdChanged,
      newThreshold: result.newThreshold,
    })
  } catch (error: any) {
    console.error('False Alarm Error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}
