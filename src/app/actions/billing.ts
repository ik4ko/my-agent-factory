'use server'

import { createClient } from '@/lib/supabase/server'
import { getStripe } from '@/lib/stripe'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://aegissage.com'

async function getStripeCustomerId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Agency owner path
  const { data: agency } = await supabase
    .from('agencies')
    .select('stripe_customer_id')
    .eq('owner_id', user.id)
    .maybeSingle()

  if (agency?.stripe_customer_id) return agency.stripe_customer_id

  // Solo broker path (may have their own stripe record)
  const { data: broker } = await supabase
    .from('brokers')
    .select('agency_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (broker?.agency_id) {
    const { data: ag } = await supabase
      .from('agencies')
      .select('stripe_customer_id')
      .eq('id', broker.agency_id)
      .maybeSingle()
    if (ag?.stripe_customer_id) return ag.stripe_customer_id
  }

  return null
}

export async function getCancelUrl(): Promise<{ url?: string; error?: string }> {
  const customerId = await getStripeCustomerId()
  if (!customerId) return { error: 'No billing account found' }

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${APP_URL}/settings/billing?cancelled=true`,
    })
    return { url: session.url }
  } catch (err: any) {
    return { error: err.message }
  }
}
