import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase'
import { TeamManagement } from './team-management'

// ── Tier constants ────────────────────────────────────────────────────────────
// Tiers that map to the solo/individual broker plan.
// Users on these tiers are redirected away from all admin pages regardless
// of their role string — self-provisioned solo brokers receive role='agency_owner'
// which would otherwise pass a role-only guard.
const BROKER_TIERS = ['broker', 'solo', 'starter']

export default async function TeamPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // ── Auth + tier resolution ─────────────────────────────────────────────────
  const [{ data: agency }, { data: brokerRow }] = await Promise.all([
    supabase
      .from('agencies')
      .select('id, name, subscription_tier')
      .eq('owner_id', user.id)
      .maybeSingle(),
    supabase
      .from('brokers')
      .select('agency_id, role')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  const isOwner    = !!agency
  const agencyTier = agency?.subscription_tier ?? 'broker'
  let   agencyId: string | null = agency?.id ?? null

  // ── Gate 1: broker-tier owners ────────────────────────────────────────────
  // Solo plan owners have role='agency_owner' (set by auto-provision) but
  // must NOT access team management. Redirect before any data is fetched.
  if (isOwner && BROKER_TIERS.includes(agencyTier)) {
    redirect('/dashboard/alerts')
  }

  // ── Gate 2: non-owner users ───────────────────────────────────────────────
  // Must be agency staff AND their parent agency must be on an agency-tier plan.
  if (!agencyId) {
    if (!brokerRow || !['agency_admin', 'agency_owner', 'customer_service'].includes(brokerRow.role ?? '')) {
      redirect('/dashboard/alerts')
    }
    // Also block staff under a broker-tier parent agency
    const { data: parentAgency } = await supabase
      .from('agencies')
      .select('subscription_tier')
      .eq('id', brokerRow.agency_id)
      .maybeSingle()
    if (BROKER_TIERS.includes(parentAgency?.subscription_tier ?? 'broker')) {
      redirect('/dashboard/alerts')
    }
    agencyId = brokerRow.agency_id
  }

  const { data: brokers } = await supabaseAdmin
    .from('brokers')
    .select('id, user_id, first_name, last_name, email, role, npn, created_at')
    .eq('agency_id', agencyId)
    .order('created_at', { ascending: false })

  const { data: contactRows } = await supabaseAdmin
    .from('ghl_contacts')
    .select('assigned_broker_id')
    .eq('agency_id', agencyId)
    .not('assigned_broker_id', 'is', null)

  const countMap: Record<string, number> = {}
  contactRows?.forEach(c => {
    if (c.assigned_broker_id) countMap[c.assigned_broker_id] = (countMap[c.assigned_broker_id] ?? 0) + 1
  })

  const brokersWithCounts = (brokers ?? []).map(b => ({
    ...b,
    assignedCount: countMap[b.user_id] ?? 0,
  }))

  // Fetch pending invites (non-fatal if table doesn't exist)
  let pendingInvites: Array<{ id: string; email: string; role: string; created_at: string; expires_at: string }> = []
  try {
    const { data: invites } = await supabaseAdmin
      .from('agency_invites')
      .select('id, email, role, created_at, expires_at')
      .eq('agency_id', agencyId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
    pendingInvites = invites ?? []
  } catch (_) {}

  // agencyId is guaranteed non-null here — all null paths redirect above.
  // The assertion satisfies the compiler (redirect() doesn't narrow to never).
  if (!agencyId) redirect('/dashboard/alerts')

  return (
    <TeamManagement
      brokers={brokersWithCounts}
      agencyId={agencyId}
      isOwner={isOwner}
      pendingInvites={pendingInvites}
      agencyTier={agencyTier}
    />
  )
}
