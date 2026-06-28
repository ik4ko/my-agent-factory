import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptCredential } from '@/lib/crypto-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function getBrokerFromApiKey(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization') ?? ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (token.length < 32) return null
  const supabase = createServiceClient()
  const { data: broker } = await supabase
    .from('brokers')
    .select('id, agency_id')
    .eq('extension_api_key', token)
    .maybeSingle()
  return broker ?? null
}

export async function GET(req: NextRequest) {
  const broker = await getBrokerFromApiKey(req)
  if (!broker) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServiceClient()

  // ── Ownership gate ────────────────────────────────────────────────────────
  // Only return members assigned to the requesting broker.
  // Scoping to agency_id alone would allow any broker's extension to scrape
  // the full agency roster — a privacy and competitive-data leak.
  // broker_id = null rows (unassigned imports) are excluded to prevent
  // free-form discovery of unowned records.
  const { data: rows } = await supabase
    .from('book_of_business')
    .select(`
      id,
      full_name,
      mbi_encrypted,
      carrier,
      plan_name,
      plan_id,
      last_known_plan_code,
      plan_pbp,
      plan_contract,
      verification_status,
      enrollment_status,
      is_chronic,
      last_verified_at,
      last_marx_check
    `)
    .eq('agency_id', broker.agency_id)
    .eq('broker_id', broker.id)        // ← strict ownership: only this broker's members
    .eq('has_mbi', true)
    .order('last_marx_check', { ascending: true, nullsFirst: true })
    .limit(200)

  const members = (rows ?? []).map(row => {
    const mbi = decryptCredential(row.mbi_encrypted ?? '')
    return {
      id: row.id,
      mbi,
      full_name: row.full_name ?? null,
      fullName: row.full_name ?? null,
      carrier: row.carrier ?? null,
      plan_name: row.plan_name ?? null,
      plan_id: row.plan_id ?? null,
      last_known_plan_code: row.last_known_plan_code ?? null,
      lastKnownPlanCode: row.last_known_plan_code ?? null,
      plan_pbp: row.plan_pbp ?? null,
      plan_contract: row.plan_contract ?? null,
      verification_status: row.verification_status ?? null,
      enrollment_status: row.enrollment_status ?? null,
      is_chronic: row.is_chronic ?? false,
      lastCheck: row.last_marx_check ?? null,
    }
  })

  return NextResponse.json({ members })
}
