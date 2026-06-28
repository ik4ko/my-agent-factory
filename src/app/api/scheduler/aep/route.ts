import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { addGHLTag } from '@/lib/campaigns/ghl-workflow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[scheduler/aep] CRON_SECRET not set — rejecting request')
    return NextResponse.json({ error: 'Cron not configured' }, { status: 500 })
  }
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const today = new Date()

  const { data: schedules } = await supabase
    .from('aep_schedule')
    .select('id, agency_id, ghl_contact_id, aep_start, reminder_90_sent, reminder_60_sent, reminder_30_sent, reminder_7_sent')

  const rows = schedules ?? []
  let processed = 0
  let triggered = 0

  for (const row of rows) {
    const aepStart = new Date(row.aep_start)
    const daysUntil = Math.ceil((aepStart.getTime() - today.getTime()) / 86400000)

    const updates: Record<string, boolean> = {}
    const tags: string[] = []

    if (daysUntil <= 90 && !row.reminder_90_sent) {
      updates.reminder_90_sent = true
      tags.push('AEP-90-DAYS')
    }
    if (daysUntil <= 60 && !row.reminder_60_sent) {
      updates.reminder_60_sent = true
      tags.push('AEP-60-DAYS')
    }
    if (daysUntil <= 30 && !row.reminder_30_sent) {
      updates.reminder_30_sent = true
      tags.push('AEP-30-DAYS')
    }
    if (daysUntil <= 7 && !row.reminder_7_sent) {
      updates.reminder_7_sent = true
      tags.push('AEP-7-DAYS')
    }

    if (tags.length === 0) {
      processed++
      continue
    }

    // Apply GHL tags (best-effort)
    await addGHLTag(row.agency_id, row.ghl_contact_id, tags).catch(() => {})

    await supabase
      .from('aep_schedule')
      .update(updates)
      .eq('id', row.id)

    triggered += tags.length
    processed++
  }

  return NextResponse.json({ processed, triggered })
}
