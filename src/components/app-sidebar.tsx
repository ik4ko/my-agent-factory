import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { SidebarNav } from './sidebar-nav'

/**
 * AppSidebar — server component that resolves user identity and passes
 * clean, pre-computed props to the client-side SidebarNav.
 *
 * Role partitioning logic (single source of truth):
 *
 *   isOwner:
 *     TRUE  → user has an agencies row with owner_id = uid
 *
 *   isBrokerTier:
 *     TRUE  → the EFFECTIVE agency subscription_tier is 'broker' | 'solo' | 'starter'
 *             → show stripped 3-item broker nav (My Clients, Alerts, Import)
 *             → Team and Agency View are NEVER rendered, not hidden
 *     FALSE → tier is 'agency' | 'professional' | 'enterprise'
 *             → show full nav + Management section
 *
 * Tier resolution order:
 *   1. Owned agency  →  use agency.subscription_tier directly
 *   2. Non-owner staff → look up parent agency tier via brokerRow.agency_id
 *      (agency_admin / customer_service under a professional-tier agency
 *       should see the full nav, not the broker-stripped nav)
 *   3. Fallback → 'broker' (most restrictive — show broker nav)
 *
 * The same sidebar output is passed to both the desktop layout and the
 * mobile Sheet drawer in AppShell. Role gating is evaluated once,
 * server-side, before either surface renders.
 */
export async function AppSidebar() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // ── Step 1: Parallel fetch for owned agency + broker profile ─────────────
  const [{ data: agency }, { data: brokerRow }] = await Promise.all([
    supabase
      .from('agencies')
      .select('id, subscription_tier')
      .eq('owner_id', user.id)
      .maybeSingle(),
    supabase
      .from('brokers')
      .select('id, role, agency_id, first_name, last_name')
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  const isOwner = agency !== null

  // ── Step 2: Resolve the effective tier ───────────────────────────────────
  // For agency owners: read directly from their owned agency row.
  // For non-owner staff (agency_admin, customer_service): fetch the parent
  //   agency tier so they see the correct nav for their employer's plan.
  // Fallback to 'broker' (most restrictive) if nothing resolves.
  const AGENCY_TIERS  = ['agency', 'professional', 'enterprise', 'agency_plan']
  const BROKER_TIERS  = ['broker', 'solo', 'starter']

  let effectiveTier: string

  if (isOwner) {
    effectiveTier = agency.subscription_tier ?? 'broker'
  } else if (brokerRow?.agency_id) {
    // Non-owner: look up the parent agency's tier
    const { data: parentAgency } = await supabase
      .from('agencies')
      .select('subscription_tier')
      .eq('id', brokerRow.agency_id)
      .maybeSingle()
    effectiveTier = parentAgency?.subscription_tier ?? 'broker'
  } else {
    effectiveTier = 'broker'
  }

  // isBrokerTier = true  → stripped 3-item nav (solo/broker plan)
  // isBrokerTier = false → full nav (agency plan)
  const isBrokerTier = BROKER_TIERS.includes(effectiveTier) || !AGENCY_TIERS.includes(effectiveTier)

  // ── Step 3: Supporting data ───────────────────────────────────────────────
  const agencyId = brokerRow?.agency_id ?? agency?.id
  const role     = brokerRow?.role ?? (isOwner ? 'agency_owner' : 'broker')

  // ── isStaff: non-owner members with elevated access ───────────────────────
  // agency_admin (Manager) and customer_service (CSR) are not the agency owner
  // but operate at the agency scope. They get the full operational nav (all
  // core items + Agency View) but NOT Team management (owner-only).
  const STAFF_ROLES = ['agency_admin', 'customer_service']
  const isStaff     = !isOwner && STAFF_ROLES.includes(role)
  const name     = brokerRow
    ? `${brokerRow.first_name ?? ''} ${brokerRow.last_name ?? ''}`.trim()
      || (user.email?.split('@')[0] ?? 'User')
    : (user.email?.split('@')[0] ?? 'User')
  const email = user.email ?? ''

  // ── Step 4: Critical alert badge count ───────────────────────────────────
  let criticalAlerts = 0
  if (agencyId) {
    const svc = createServiceClient()
    let q = svc
      .from('switch_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('agency_id', agencyId)
      .eq('priority', 'critical')
      .in('status', ['open', 'contacted'])
    // Broker-tier users see only their own alerts; agency staff see all
    if (isBrokerTier && brokerRow?.id) {
      q = q.eq('broker_id', brokerRow.id) as typeof q
    }
    const { count } = await q
    criticalAlerts = count ?? 0
  }

  return (
    <SidebarNav
      isOwner={isOwner}
      isStaff={isStaff}
      isBrokerTier={isBrokerTier}
      role={role}
      name={name}
      email={email}
      criticalAlerts={criticalAlerts}
    />
  )
}
