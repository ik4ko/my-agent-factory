import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function extractCleanToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization')
    ?? request.headers.get('Authorization')
    ?? ''
  const token = authHeader.replace('Bearer ', '').trim()
  if (token.length < 32) return null
  return token
}

// GET /api/extension/verify
// Kill-switch endpoint — validates API key and confirms agency is active.
// Returns { valid: false } for suspended, expired-trial, or cancelled accounts.
export async function GET(req: NextRequest) {
  const token = extractCleanToken(req)
  if (!token) {
    return NextResponse.json({ valid: false, error: 'No token provided' })
  }

  const supabase = createServiceClient()

  const { data: broker } = await supabase
    .from('brokers')
    .select('id, agency_id, first_name, last_name')
    .eq('extension_api_key', token)
    .maybeSingle()

  if (!broker) {
    return NextResponse.json({ valid: false, error: 'Invalid API key' })
  }

  if (!broker.agency_id) {
    return NextResponse.json({ valid: false, error: 'Account setup incomplete' })
  }

  const { data: agency } = await supabase
    .from('agencies')
    .select('id, name, status, subscription_status, is_beta, trial_expires_at')
    .eq('id', broker.agency_id)
    .maybeSingle()

  if (!agency) {
    return NextResponse.json({ valid: false, error: 'Agency not found' })
  }

  const now = new Date()

  // An account is active if any of these are true:
  // 1. Flagged as beta (permanent access regardless of billing)
  // 2. subscription_status = 'active' or 'beta' (paying customer or granted)
  // 3. On trial with a future or no expiry (subscription_status or legacy status column)
  const trialValid = !agency.trial_expires_at || new Date(agency.trial_expires_at) > now

  const isActive =
    agency.is_beta === true ||
    agency.subscription_status === 'active' ||
    agency.subscription_status === 'beta' ||
    (agency.subscription_status === 'trial' && trialValid) ||
    (agency.status === 'trial' && trialValid)

  if (!isActive) {
    console.warn(
      '[extension/verify] inactive agency:', agency.id,
      '| subscription_status:', agency.subscription_status ?? 'null',
      '| status:', agency.status ?? 'null',
      '| trial_expires_at:', agency.trial_expires_at ?? 'null',
    )
    return NextResponse.json({
      valid: false,
      error: 'Subscription inactive. Visit aegissage.com to reactivate.',
    })
  }

  const brokerName = `${broker.first_name ?? ''} ${broker.last_name ?? ''}`.trim()
  console.log('[extension/verify] OK | broker:', broker.id, '| agency:', agency.name)

  return NextResponse.json({
    valid: true,
    broker_id: broker.id,
    agency_id: broker.agency_id,
    broker_name: brokerName || null,
    agency_name: agency.name,
  })
}
