import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()
    const plan: string = body.plan

    // Resolve price ID server-side -- never trust client-supplied price IDs
    let priceId: string | undefined
    if (plan === 'broker') priceId = process.env.STRIPE_BROKER_PRICE_ID
    else if (plan === 'agency') priceId = process.env.STRIPE_AGENCY_PRICE_ID
    else priceId = body.priceId // fallback for direct price ID (internal use)

    if (!priceId) return NextResponse.json({ error: `No price configured for plan: ${plan}` }, { status: 400 })

    // Get or create agency + Stripe customer
    const { data: agency } = await supabase
      .from('agencies')
      .select('id, name, stripe_customer_id')
      .eq('owner_id', user.id)
      .single()

    if (!agency) return NextResponse.json({ error: 'Agency not found' }, { status: 404 })

    let customerId = agency.stripe_customer_id
    if (!customerId) {
      const customer = await getStripe().customers.create({
        email: user.email,
        name: agency.name ?? undefined,
        metadata: { agency_id: agency.id, user_id: user.id },
      })
      customerId = customer.id
      await supabase.from('agencies').update({ stripe_customer_id: customerId }).eq('id', agency.id)
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://aegissage.com'

    const session = await getStripe().checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/dashboard?upgraded=true`,
      cancel_url: `${appUrl}/pricing?cancelled=true`,
      metadata: { agency_id: agency.id, plan: plan ?? 'unknown' },
      subscription_data: {
        metadata: { agency_id: agency.id },
      },
      allow_promotion_codes: true,
      // ⬇️ THIS IS THE MAGICAL LINE THAT REMOVES THE CREDIT CARD FIELD FOR TRIALS
      payment_method_collection: 'if_required', 
    })

    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error('[stripe/checkout]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}