import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendTeamInviteEmail } from '@/lib/email/send-notifications'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:9002'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Resolve agency and verify admin role
    let agencyId: string | null = null
    let maxAdminSeats = 3
    let agencySeatLimit = 1

    const { data: agency } = await supabase
      .from('agencies')
      .select('id, max_admin_seats, seat_limit')
      .eq('owner_id', user.id)
      .maybeSingle()

    if (agency) {
      agencyId = agency.id
      maxAdminSeats = agency.max_admin_seats ?? 3
      agencySeatLimit = agency.seat_limit ?? 1
    } else {
      const { data: broker } = await supabase
        .from('brokers')
        .select('agency_id, role')
        .eq('user_id', user.id)
        .maybeSingle()

      if (!broker || broker.role !== 'agency_admin') {
        return NextResponse.json({ error: 'Forbidden: agency_admin role required' }, { status: 403 })
      }
      agencyId = broker.agency_id

      const { data: agencyData } = await supabase
        .from('agencies')
        .select('max_admin_seats, seat_limit')
        .eq('id', agencyId)
        .maybeSingle()
      maxAdminSeats = agencyData?.max_admin_seats ?? 3
      agencySeatLimit = agencyData?.seat_limit ?? 1
    }

    const body = await req.json()
    const { email, npn, role: inviteRole = 'broker' } = body as {
      email: string
      first_name?: string
      last_name?: string
      npn?: string
      role?: string
    }

    // Derive name from email prefix when not explicitly supplied (e.g. bulk invites)
    const first_name = (body.first_name as string | undefined)?.trim() || email.split('@')[0]
    const last_name  = (body.last_name  as string | undefined)?.trim() || ''

    if (!email) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 })
    }

    // agency_owner cannot be invited (only 1 per agency)
    if (inviteRole === 'agency_owner') {
      return NextResponse.json({ error: 'agency_owner cannot be invited -- only 1 per agency' }, { status: 400 })
    }

    // Seat limit check for agency_admin invites (custom admin-seat cap)
    if (inviteRole === 'agency_admin') {
      const { count: adminCount } = await supabase
        .from('brokers')
        .select('id', { count: 'exact', head: true })
        .eq('agency_id', agencyId)
        .in('role', ['agency_admin', 'agency_owner'])

      if ((adminCount ?? 0) >= maxAdminSeats) {
        return NextResponse.json(
          { error: `Admin seat limit reached (${adminCount}/${maxAdminSeats})` },
          { status: 403 }
        )
      }
    }

    // Seat limit check for broker invites — enforced at the write layer so a
    // direct API call cannot bypass the UI pre-flight gate (/api/team/seat-check).
    // This is the authoritative enforcement point; the seat-check endpoint is
    // purely informational for the frontend.
    if (inviteRole !== 'agency_admin' && agencySeatLimit !== 999) {
      const { count: brokerCount } = await supabase
        .from('brokers')
        .select('id', { count: 'exact', head: true })
        .eq('agency_id', agencyId!)

      if ((brokerCount ?? 0) >= agencySeatLimit) {
        return NextResponse.json(
          { error: 'Seat limit reached. Contact support to add more seats.' },
          { status: 400 }
        )
      }
    }

    // Create the user + invite token WITHOUT sending Supabase's default email.
    // generateLink (unlike inviteUserByEmail) returns the link instead of
    // emailing it, so the branded email below is the only one the invitee gets.
    const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        data: { first_name, last_name, agency_id: agencyId },
        redirectTo: `${APP_URL}/auth/set-password`,
      },
    })

    if (inviteError) {
      console.error('[team/invite] invite error:', inviteError)
      return NextResponse.json({ error: inviteError.message }, { status: 500 })
    }

    const invitedUserId = inviteData.user?.id
    if (!invitedUserId) {
      return NextResponse.json({ error: 'Invite succeeded but no user ID returned' }, { status: 500 })
    }

    // Route the token through our own /auth/confirm (public, verifies server-side
    // and sets session cookies) rather than the raw action_link, whose implicit
    // URL-fragment session is silently dropped by the PKCE browser client.
    const hashedToken = inviteData.properties?.hashed_token
    if (!hashedToken) {
      return NextResponse.json({ error: 'Invite link could not be generated' }, { status: 500 })
    }
    const inviteUrl =
      `${APP_URL}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}` +
      `&type=invite&next=${encodeURIComponent('/auth/set-password')}`

    // Insert broker record immediately using the new user's UUID
    const { data: brokerRow, error: brokerError } = await supabaseAdmin
      .from('brokers')
      .insert({
        agency_id: agencyId,
        user_id: invitedUserId,
        first_name,
        last_name,
        email,
        npn: npn ?? null,
        role: inviteRole === 'agency_admin' ? 'agency_admin' : 'broker',
      })
      .select('id, user_id, first_name, last_name, email, role, npn, created_at')
      .single()

    if (brokerError) {
      console.error('[team/invite] broker insert error:', brokerError)
      return NextResponse.json({ error: brokerError.message }, { status: 500 })
    }

    // Record in agency_invites for pending-invites display
    await supabaseAdmin.from('agency_invites').insert({
      agency_id: agencyId,
      email,
      role: inviteRole === 'agency_admin' ? 'agency_admin' : 'broker',
      status: 'pending',
      invited_by: user.id,
    }).then(() => {}) // non-fatal if table doesn't exist yet

    // Audit log
    await supabaseAdmin.from('audit_log').insert({
      agency_id: agencyId,
      user_id: user.id,
      action: 'BROKER_INVITED',
      resource_type: 'brokers',
      resource_id: brokerRow.id,
      metadata: { invited_email: email, invited_user_id: invitedUserId, role: inviteRole },
    })

    // Send the branded invite email — now the ONLY email carrying the invite
    // link, so a failure here means the invitee never receives anything.
    let emailError: string | null = null
    try {
      const [{ data: inviter }, { data: agencyData }] = await Promise.all([
        supabaseAdmin.from('brokers').select('first_name, last_name').eq('user_id', user.id).maybeSingle(),
        supabaseAdmin.from('agencies').select('name').eq('id', agencyId).maybeSingle(),
      ])
      const inviterName = inviter ? `${inviter.first_name} ${inviter.last_name}` : 'Your agency admin'
      const agencyName = agencyData?.name ?? 'AegisSage'
      const sent = await sendTeamInviteEmail({
        inviteeEmail: email,
        inviterName,
        agencyName,
        role: inviteRole,
        inviteUrl,
      })
      if (!sent) emailError = 'Invite created but the email could not be sent'
    } catch (emailErr) {
      emailError = emailErr instanceof Error ? emailErr.message : 'Failed to send invite email'
      console.error('[team/invite] invite email failed:', emailError)
    }

    return NextResponse.json(
      { broker: { ...brokerRow, assignedCount: 0 }, ...(emailError && { emailError }) },
      { status: 201 }
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[team/invite] unexpected error:', msg)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
