import { NextRequest, NextResponse } from 'next/server'
import { createClient }        from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const brokerId = req.nextUrl.searchParams.get('brokerId')
    if (!brokerId) return NextResponse.json({ error: 'brokerId query param required' }, { status: 400 })

    const svc = createServiceClient()

    // Resolve agency and verify the caller is an owner or admin
    let agencyId: string | null = null

    const { data: agency } = await supabase
      .from('agencies')
      .select('id')
      .eq('owner_id', user.id)
      .maybeSingle()

    if (agency) {
      agencyId = agency.id
    } else {
      const { data: callerBroker } = await supabase
        .from('brokers')
        .select('agency_id, role')
        .eq('user_id', user.id)
        .maybeSingle()

      if (!callerBroker || callerBroker.role !== 'agency_admin') {
        return NextResponse.json({ error: 'Forbidden: agency_admin role required' }, { status: 403 })
      }
      agencyId = callerBroker.agency_id
    }

    // Verify the target broker belongs to the same agency
    const { data: target } = await svc
      .from('brokers')
      .select('id, user_id, first_name, last_name, agency_id')
      .eq('id', brokerId)
      .maybeSingle()

    if (!target || target.agency_id !== agencyId) {
      return NextResponse.json({ error: 'Broker not found in this agency' }, { status: 404 })
    }

    // Prevent self-deletion (owners can't be removed via this route)
    if (target.user_id === user.id) {
      return NextResponse.json({ error: 'Cannot remove your own account via this route' }, { status: 400 })
    }

    // ── Step 1: Unassign their GHL contacts ───────────────────────────────────
    await svc
      .from('ghl_contacts')
      .update({ assigned_broker_id: null })
      .eq('agency_id', agencyId)
      .eq('assigned_broker_id', target.user_id)

    // ── Step 2: Delete the brokers row ────────────────────────────────────────
    const { error: brokerDeleteErr } = await svc
      .from('brokers')
      .delete()
      .eq('id', brokerId)

    if (brokerDeleteErr) {
      console.error('[team/remove] broker row delete error:', brokerDeleteErr.message)
      return NextResponse.json({ error: brokerDeleteErr.message }, { status: 500 })
    }

    // ── Step 3: Anonymise audit_log entries for this user ─────────────────────
    // We NULL the user_id rather than hard-deleting rows so that HIPAA-required
    // audit records are preserved while the departed user's identity is removed.
    const { error: auditErr } = await svc
      .from('audit_log')
      .update({ user_id: null })
      .eq('user_id', target.user_id)
      .eq('agency_id', agencyId)

    if (auditErr) {
      // Non-fatal — broker row is already gone; log and continue
      console.warn('[team/remove] audit_log anonymise error:', auditErr.message)
    }

    // ── Step 4: Delete the Supabase Auth user ─────────────────────────────────
    // Requires the service-role key. This invalidates all active sessions for
    // the removed broker immediately — they cannot log in again.
    const { error: authDeleteErr } = await svc.auth.admin.deleteUser(target.user_id)

    if (authDeleteErr) {
      // The broker row is already gone so the user can no longer reach any data,
      // but we log the failure for ops investigation.
      console.error('[team/remove] auth.admin.deleteUser error:', authDeleteErr.message)
      // Return partial-success so the UI can refresh, noting the auth cleanup issue
      return NextResponse.json({
        ok:      true,
        warning: 'Broker profile removed but auth user could not be deleted — contact support.',
      })
    }

    // ── Step 5: Compliance audit record ───────────────────────────────────────
    await svc.from('audit_log').insert({
      agency_id:     agencyId,
      user_id:       user.id,
      action:        'BROKER_REMOVED',
      resource_type: 'brokers',
      resource_id:   brokerId,
      metadata: {
        removed_user_id:    target.user_id,
        removed_name:       `${target.first_name ?? ''} ${target.last_name ?? ''}`.trim(),
        auth_user_deleted:  !authDeleteErr,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[team/remove] unexpected error:', msg)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
