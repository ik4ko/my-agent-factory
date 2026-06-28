import { NextRequest, NextResponse } from 'next/server'
import { notifyVCCDeadlines, sendWeeklyDigests, notifyOpenAlerts } from '@/lib/email/send-notifications'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[scheduler/notifications] CRON_SECRET not set — rejecting request')
    return NextResponse.json({ error: 'Cron not configured' }, { status: 500 })
  }
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: Record<string, string> = {}

  // Open switch/termed/AOR alerts — runs every cron tick, only emails unnotified ones
  try {
    await notifyOpenAlerts()
    results.alerts = 'ok'
  } catch (err: unknown) {
    results.alerts = `error: ${err instanceof Error ? err.message : String(err)}`
  }

  try {
    await notifyVCCDeadlines()
    results.vcc = 'ok'
  } catch (err: unknown) {
    results.vcc = `error: ${err instanceof Error ? err.message : String(err)}`
  }

  // Send weekly digests on Mondays only
  const today = new Date()
  if (today.getDay() === 1) {
    try {
      await sendWeeklyDigests()
      results.weekly = 'ok'
    } catch (err: unknown) {
      results.weekly = `error: ${err instanceof Error ? err.message : String(err)}`
    }
  } else {
    results.weekly = 'skipped (not Monday)'
  }

  return NextResponse.json({ ok: true, ...results })
}
