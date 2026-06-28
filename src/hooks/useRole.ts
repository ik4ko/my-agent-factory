'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export type UserRole = 'agency_owner' | 'agency_admin' | 'customer_service' | 'broker' | 'solo_broker' | null

export interface RoleState {
  role: UserRole
  // Groups
  isOwner: boolean        // agency_owner only
  isPrincipal: boolean    // agency_owner + agency_admin
  isCS: boolean           // customer_service
  isStaff: boolean        // agency_owner + agency_admin + customer_service
  isBroker: boolean       // broker + solo_broker
  isSolo: boolean         // solo_broker (no agency above them)
  // Permissions
  canManageTeam: boolean        // isPrincipal — add/remove brokers
  canViewAllClients: boolean    // isStaff — see all agency contacts
  canSubmitForOthers: boolean   // isStaff — VCC/AOR for any client
  canAccessBilling: boolean     // isOwner || isBroker — see own billing
  canUpgrade: boolean           // isBroker
  canInviteTeam: boolean        // isPrincipal — same as canManageTeam
  // Data
  agencyId: string | null
  brokerId: string | null       // the brokers.id UUID (not user_id)
  maxAdminSeats: number
  currentAdminCount: number
  canInviteAdmin: boolean
  loading: boolean
}

const NULL_STATE: RoleState = {
  role: null,
  isOwner: false,
  isPrincipal: false,
  isCS: false,
  isStaff: false,
  isBroker: false,
  isSolo: false,
  canManageTeam: false,
  canViewAllClients: false,
  canSubmitForOthers: false,
  canAccessBilling: false,
  canUpgrade: false,
  canInviteTeam: false,
  agencyId: null,
  brokerId: null,
  maxAdminSeats: 3,
  currentAdminCount: 0,
  canInviteAdmin: false,
  loading: false,
}

export function useRole(): RoleState {
  const [state, setState] = useState<RoleState>({ ...NULL_STATE, loading: true })

  useEffect(() => {
    let mounted = true

    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        if (mounted) setState(NULL_STATE)
        return
      }

      // Step 1: Check agency ownership (authoritative — owner_id is the source of truth)
      const { data: agency, error: agencyErr } = await supabase
        .from('agencies')
        .select('id, max_admin_seats')
        .eq('owner_id', user.id)
        .maybeSingle()

      console.log('[useRole] agency check', { email: user.email, agencyFound: !!agency, err: agencyErr?.message ?? null })

      if (agency) {
        const maxAdminSeats = agency.max_admin_seats ?? 3
        const { count: adminCount } = await supabase
          .from('brokers')
          .select('id', { count: 'exact', head: true })
          .eq('agency_id', agency.id)
          .in('role', ['agency_admin', 'agency_owner'])
        const currentAdminCount = adminCount ?? 0

        // Agency owners may also have a broker row — fetch its id
        const { data: ownerBrokerRow } = await supabase
          .from('brokers')
          .select('id')
          .eq('user_id', user.id)
          .eq('agency_id', agency.id)
          .maybeSingle()

        const resolved: RoleState = {
          role: 'agency_owner',
          isOwner: true, isPrincipal: true, isCS: false, isStaff: true,
          isBroker: false, isSolo: false,
          canManageTeam: true, canViewAllClients: true, canSubmitForOthers: true,
          canAccessBilling: true, canUpgrade: false, canInviteTeam: true,
          agencyId: agency.id,
          brokerId: ownerBrokerRow?.id ?? null,
          maxAdminSeats,
          currentAdminCount,
          canInviteAdmin: currentAdminCount < maxAdminSeats,
          loading: false,
        }
        console.log('[useRole] resolved →', { email: user.email, role: resolved.role, isStaff: resolved.isStaff, isBroker: resolved.isBroker, isPrincipal: resolved.isPrincipal })
        if (mounted) setState(resolved)
        return
      }

      // Step 2: Check brokers table for invited/solo members
      const { data: broker, error: brokerErr } = await supabase
        .from('brokers')
        .select('id, role, agency_id')
        .eq('user_id', user.id)
        .maybeSingle()

      console.log('[useRole] broker check', { email: user.email, brokerFound: !!broker, role: broker?.role ?? null, err: brokerErr?.message ?? null })

      if (broker && mounted) {
        const role = broker.role as UserRole
        const isOwner = role === 'agency_owner'
        const isPrincipal = ['agency_owner', 'agency_admin'].includes(role ?? '')
        const isCS = role === 'customer_service'
        const isSolo = role === 'solo_broker'
        const isBroker = role === 'broker' || isSolo
        const isStaff = isPrincipal || isCS

        let maxAdminSeats = 3
        let currentAdminCount = 0

        if (isPrincipal && broker.agency_id) {
          const { data: agencyData } = await supabase
            .from('agencies')
            .select('max_admin_seats')
            .eq('id', broker.agency_id)
            .maybeSingle()
          maxAdminSeats = agencyData?.max_admin_seats ?? 3

          const { count } = await supabase
            .from('brokers')
            .select('id', { count: 'exact', head: true })
            .eq('agency_id', broker.agency_id)
            .in('role', ['agency_admin', 'agency_owner'])
          currentAdminCount = count ?? 0
        }

        const resolved: RoleState = {
          role,
          isOwner,
          isPrincipal,
          isCS,
          isStaff,
          isBroker,
          isSolo,
          canManageTeam: isPrincipal,
          canViewAllClients: isStaff,
          canSubmitForOthers: isStaff,
          canAccessBilling: isOwner || isBroker || isSolo,
          canUpgrade: isBroker,
          canInviteTeam: isPrincipal,
          agencyId: broker.agency_id ?? null,
          brokerId: broker.id,
          maxAdminSeats,
          currentAdminCount,
          canInviteAdmin: isPrincipal && currentAdminCount < maxAdminSeats,
          loading: false,
        }
        console.log('[useRole] resolved →', { email: user.email, role: resolved.role, isStaff: resolved.isStaff, isBroker: resolved.isBroker, isPrincipal: resolved.isPrincipal })
        setState(resolved)
        return
      }

      console.log('[useRole] no agency or broker row found for', user.email)
      if (mounted) setState(NULL_STATE)
    }

    load()
    return () => { mounted = false }
  }, [])

  return state
}
