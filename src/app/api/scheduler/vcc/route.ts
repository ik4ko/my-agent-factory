import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendFax } from '@/lib/vcc/fax-dispatcher'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('[scheduler/vcc] CRON_SECRET not set — rejecting request')
    return NextResponse.json({ error: 'Cron not configured' }, { status: 500 })
  }
  const secret = req.headers.get('authorization')?.replace('Bearer ', '')
  if (secret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const now = new Date().toISOString()

  const { data: due, error } = await supabase
    .from('vcc_submissions')
    .select('id, doctor_fax, filled_pdf_path, carrier')
    .eq('fax_status', 'scheduled')
    .lte('send_scheduled_at', now)

  if (error) {
    console.error('[scheduler/vcc] fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let sent = 0
  let failed = 0

  for (const sub of due ?? []) {
    try {
      if (sub.doctor_fax && sub.filled_pdf_path) {
        // Filled PDFs are stored in the 'VCC-filled' bucket by saveFilledPDF().
        // 'phi-vault' is a separate raw-PHI bucket — this was a bucket-name mismatch
        // that caused every scheduled fax to silently download nothing and fail.
        const { data: fileData } = await supabase.storage
          .from('VCC-filled')
          .download(sub.filled_pdf_path)
        if (fileData) {
          const buf = await fileData.arrayBuffer()
          const faxResult = await sendFax(
            new Uint8Array(buf),
            sub.doctor_fax,
            `VCC Form — ${sub.carrier ?? 'Unknown'} — ${sub.id}`
          )
          await supabase.from('vcc_submissions')
            .update({ fax_status: faxResult.success ? 'sent' : 'failed' })
            .eq('id', sub.id)
          faxResult.success ? sent++ : failed++
        } else {
          await supabase.from('vcc_submissions').update({ fax_status: 'failed' }).eq('id', sub.id)
          failed++
        }
      }
    } catch (e: any) {
      console.error('[scheduler/vcc] fax error for', sub.id, e.message)
      await supabase.from('vcc_submissions').update({ fax_status: 'failed' }).eq('id', sub.id)
      failed++
    }
  }

  return NextResponse.json({ processed: (due ?? []).length, sent, failed })
}
