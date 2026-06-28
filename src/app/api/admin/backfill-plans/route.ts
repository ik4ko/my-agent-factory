import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(req: NextRequest) {
  if (!process.env.ADMIN_ENABLED) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const db = getDb()

  // Fetch all members missing plan_name but having last_known_plan_code or plan_id
  const { data: members, error: fetchErr } = await db
    .from('book_of_business')
    .select('id, last_known_plan_code, plan_id, plan_contract, plan_pbp, plan_name')
    .or('plan_name.is.null,plan_name.eq.unknown,plan_name.eq.')
    .limit(2000)

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  }

  if (!members || members.length === 0) {
    return NextResponse.json({ updated: 0, needsMarx: 0, message: 'No members need backfill' })
  }

  let updated = 0
  let needsMarx = 0

  for (const member of members) {
    // Resolve contract + pbp from stored codes
    const codeSource = member.last_known_plan_code || member.plan_id || null
    let contract: string | null = member.plan_contract ?? null
    let pbp: string | null = member.plan_pbp ?? null

    if ((!contract || !pbp) && codeSource) {
      const m = String(codeSource).match(/^([A-Z]\d{4})-(\d{3})/)
      if (m) {
        contract = m[1]
        pbp = m[2]
      }
    }

    if (!contract || !pbp) {
      needsMarx++
      continue
    }

    const { data: planInfo } = await db
      .from('plan_pbp_directory')
      .select('plan_name, carrier_name, plan_type')
      .eq('contract', contract.toUpperCase())
      .eq('pbp', pbp.padStart(3, '0'))
      .maybeSingle()

    if (!planInfo) {
      needsMarx++
      continue
    }

    const updatePayload: Record<string, string> = {
      plan_name: planInfo.plan_name,
    }
    if (planInfo.carrier_name) updatePayload.carrier = planInfo.carrier_name
    if (planInfo.plan_type)    updatePayload.plan_type = planInfo.plan_type
    if (contract && pbp)       updatePayload.plan_id = `${contract}-${pbp.padStart(3, '0')}`

    const { error: updateErr } = await db
      .from('book_of_business')
      .update(updatePayload)
      .eq('id', member.id)

    if (!updateErr) updated++
  }

  return NextResponse.json({
    updated,
    needsMarx,
    total: members.length,
    message: `${updated} members backfilled from plan directory. ${needsMarx} need a MARx run to set baseline.`,
  })
}
