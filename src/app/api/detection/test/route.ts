import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptCredential } from '@/lib/crypto-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: agency }, { data: brokerRow }] = await Promise.all([
    supabase.from('agencies').select('id').eq('owner_id', user.id).maybeSingle(),
    supabase.from('brokers').select('id, agency_id').eq('user_id', user.id).maybeSingle(),
  ])

  const agencyId = agency?.id ?? brokerRow?.agency_id
  if (!agencyId) return NextResponse.json({ error: 'No agency found' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as { carrier?: string; mode?: 'carrier_test' | 'mock_marx' }
  const { carrier, mode = 'carrier_test' } = body

  // ── Mock MARX Scan Mode ─────────────────────────────────────────────────────
  if (mode === 'mock_marx') {
    const supabaseAdmin = createServiceClient()

    // Fetch a random test member from the agency
    const { data: members, error: fetchErr } = await supabaseAdmin
      .from('book_of_business')
      .select('id, full_name, plan_name, carrier')
      .eq('agency_id', agencyId)
      .limit(10)

    if (fetchErr || !members || members.length === 0) {
      return NextResponse.json({ error: 'No members found for mock scan' }, { status: 404 })
    }

    // Randomly select one member
    const randomMember = members[Math.floor(Math.random() * members.length)]
    const now = new Date()
    const futureDate = new Date(now)
    futureDate.setMonth(futureDate.getMonth() + 1)

    // Create a mock switch_alert with FUTURE_CHURN status
    const { error: alertErr } = await supabaseAdmin
      .from('switch_alerts')
      .insert({
        agency_id: agencyId,
        bob_member_id: randomMember.id,
        alert_type: 'plan_change',
        status: 'open',
        switch_type: 'future_plan_change',
        risk_level: 'HIGH',
        detected_at: now.toISOString(),
        effective_date: futureDate.toISOString(),
        metadata: {
          mock_scan: true,
          current_plan: randomMember.plan_name,
          future_plan: 'Mock Future Plan',
        },
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      })

    if (alertErr) {
      console.error('[detection/test] mock alert creation failed:', alertErr.message)
      return NextResponse.json({ error: 'Failed to create mock alert' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      mode: 'mock_marx',
      member: {
        id: randomMember.id,
        full_name: randomMember.full_name,
        plan_name: randomMember.plan_name,
        carrier: randomMember.carrier,
      },
      alert: {
        status: 'open',
        switch_type: 'future_plan_change',
        risk_level: 'HIGH',
        effective_date: futureDate.toISOString(),
      },
    })
  }

  // ── Carrier Test Mode (existing logic) ─────────────────────────────────────
  if (!carrier) return NextResponse.json({ error: 'carrier is required' }, { status: 400 })

  const supabaseAdmin = createServiceClient()

  // Fetch stored credential — brokers see own, principals see all
  const brokerId = brokerRow?.id ?? null
  let credQuery = supabaseAdmin
    .from('carrier_logins')
    .select('username, password_encrypted')
    .eq('agency_id', agencyId)
    .or(`carrier.eq.${carrier},carrier.like.${carrier}_%`)

  if (brokerId !== null) {
    credQuery = credQuery.eq('broker_id', brokerId) as typeof credQuery
  }

  const { data: cred } = await credQuery.maybeSingle()
  if (!cred) return NextResponse.json({ error: 'No saved credentials for this carrier' }, { status: 404 })

  let password: string
  try {
    password = decryptCredential(cred.password_encrypted)
  } catch {
    return NextResponse.json({ error: 'Credential decryption failed' }, { status: 500 })
  }

  // Lazy-load heavy modules — only run in Node.js runtime
  const chromium = (await import('@sparticuz/chromium')).default
  const { chromium: playwrightChromium } = await import('playwright-core')

  const { HumanaScraper } = await import('@/lib/detection/carrier-scrapers/humana')
  const { UHCScraper } = await import('@/lib/detection/carrier-scrapers/uhc')

  const base = carrier.split('_')[0]
  const scraperMap: Record<string, { doLogin: (p: any, u: string, pw: string) => Promise<boolean> }> = {
    humana: new HumanaScraper(),
    uhc: new UHCScraper(),
  }
  const scraper = scraperMap[base]
  if (!scraper) return NextResponse.json({ error: `No scraper available for carrier: ${base}` }, { status: 400 })

  const executablePath = await chromium.executablePath()
  const browser = await playwrightChromium.launch({
    args: chromium.args,
    executablePath,
    headless: (chromium as any).headless ?? true,
  })

  try {
    const ctx = await browser.newContext({
      viewport: (chromium as any).defaultViewport ?? { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    })
    const page = await ctx.newPage()

    const loggedIn = await scraper.doLogin(page, cred.username, password)

    const screenshot = await page.screenshot({ type: 'png' })
    const pageTitle = await page.title()
    const currentUrl = page.url()
    await browser.close()

    // Upload screenshot to detection-logs bucket
    const path = `${agencyId}/${carrier}/${Date.now()}.png`
    await supabaseAdmin.storage
      .from('detection-logs')
      .upload(path, screenshot, { contentType: 'image/png', upsert: false })

    const { data: signedUrlData } = await supabaseAdmin.storage
      .from('detection-logs')
      .createSignedUrl(path, 3600)

    return NextResponse.json({
      success: loggedIn,
      screenshot_url: signedUrlData?.signedUrl ?? null,
      page_title: pageTitle,
      current_url: currentUrl,
    })
  } catch (err: any) {
    await browser.close().catch(() => {})
    return NextResponse.json({
      success: false,
      error: err?.message ?? 'Unknown error',
    })
  }
}
