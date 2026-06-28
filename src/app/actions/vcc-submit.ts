'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { fillVCCForm, saveFilledPDF } from '@/lib/vcc/pdf-engine'
import { sendFax } from '@/lib/vcc/fax-dispatcher'
import { revalidatePath } from 'next/cache'
import { decryptMbi } from '@/lib/mbi-crypto'

export interface VCCSubmitInput {
  ghl_contact_id:   string
  carrier:          string
  form_template_id: string
  client_name:      string
  client_dob?:      string
  medicare_id?:     string
  doctor_name?:     string
  doctor_fax?:      string
  broker_npn?:      string
  send_fax:         boolean
  /**
   * Routes the PDF engine to the correct form template:
   *   'vcc'                → Vendor Certification Continuation (chronic / DSNP plans)
   *   'transition_notice'  → New Insurance Transition Notice (standard plans)
   * Defaults to 'vcc' when omitted for backwards compatibility.
   */
  form_type?: 'vcc' | 'transition_notice'
}

export async function getVCCCarriers() {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('vcc_form_templates')
    .select('id, carrier, carrier_display_name, year')
    .eq('active', true)
    .order('carrier_display_name')
  return data ?? []
}

export async function submitVCC(formData: VCCSubmitInput) {
  const supabase = await createClient()
  const supabaseAdmin = createServiceClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: broker } = await supabase
    .from('brokers')
    .select('id, agency_id, npn, first_name, last_name')
    .eq('user_id', user.id)
    .single()

  if (!broker) throw new Error('Broker record not found')

  const { data: template } = await supabaseAdmin
    .from('vcc_form_templates')
    .select('*')
    .eq('id', formData.form_template_id)
    .eq('active', true)
    .single()

  if (!template) throw new Error('Form template not found or inactive')

  const deadline = new Date()
  deadline.setDate(deadline.getDate() + 60)

  const { data: submission, error: insertError } = await supabaseAdmin
    .from('vcc_submissions')
    .insert({
      agency_id: broker.agency_id,
      ghl_contact_id: formData.ghl_contact_id,
      broker_id: broker.id,
      submitted_by: user.id,
      carrier: formData.carrier,
      form_template_id: formData.form_template_id,
      client_name: formData.client_name,
      client_dob: formData.client_dob ?? null,
      doctor_name: formData.doctor_name ?? null,
      doctor_fax: formData.doctor_fax ?? null,
      broker_npn: formData.broker_npn ?? broker.npn ?? null,
      deadline_at: deadline.toISOString(),
      fax_status: 'pending',
    })
    .select()
    .single()

  if (insertError || !submission) {
    throw new Error(`Failed to create submission: ${insertError?.message}`)
  }

  let pdfPath: string | null = null
  let faxStatus = 'no_fax'

  try {
    const pdfBytes = await fillVCCForm(
      template.storage_path,
      template.field_map as Record<string, any>,
      {
        client_name: formData.client_name,
        client_dob: formData.client_dob,
        medicare_id: formData.medicare_id,
        doctor_name: formData.doctor_name,
        doctor_fax: formData.doctor_fax,
        broker_npn: formData.broker_npn ?? broker.npn ?? '',
        broker_name: `${broker.first_name} ${broker.last_name}`,
      }
    )

    pdfPath = await saveFilledPDF(pdfBytes, broker.agency_id, submission.id)

    await supabaseAdmin
      .from('vcc_submissions')
      .update({ filled_pdf_path: pdfPath })
      .eq('id', submission.id)

    if (formData.send_fax && formData.doctor_fax) {
      const faxResult = await sendFax(
        pdfBytes,
        formData.doctor_fax,
        `VCC Form -- ${formData.client_name} -- ${formData.carrier}`
      )
      faxStatus = faxResult.success ? 'sent' : 'failed'

      await supabaseAdmin
        .from('vcc_submissions')
        .update({
          fax_status: faxStatus,
          fax_confirmation_id: faxResult.confirmationId ?? null,
          fax_sent_at: faxResult.success ? new Date().toISOString() : null,
        })
        .eq('id', submission.id)
    }
  } catch (err: any) {
    // PDF/fax failure doesn't roll back the submission record
    console.error('[submitVCC] PDF/fax error:', err.message)
  }

  await supabaseAdmin.from('audit_log').insert({
    agency_id: broker.agency_id,
    user_id: user.id,
    action: 'VCC_SUBMITTED',
    resource_type: 'vcc_submissions',
    resource_id: submission.id,
    metadata: { carrier: formData.carrier, fax_status: faxStatus },
  })

  revalidatePath('/dashboard/vcc')
  return { success: true, submissionId: submission.id, faxStatus }
}

/** Fetch member data for VCC pre-fill — used when navigating from Book of Business */
export async function getMemberForVCC(memberId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const svc = createServiceClient()

  // Resolve caller's agency
  const [{ data: agencyRow }, { data: brokerRow }] = await Promise.all([
    svc.from('agencies').select('id').eq('owner_id', user.id).maybeSingle(),
    svc.from('brokers').select('agency_id').eq('user_id', user.id).maybeSingle(),
  ])
  const agencyId = agencyRow?.id ?? brokerRow?.agency_id
  if (!agencyId) return null

  const { data } = await svc
    .from('book_of_business')
    .select('id, full_name, mbi_encrypted, doctor_name, doctor_fax, carrier, carrier_display_name, plan_name')
    .eq('id', memberId)
    .eq('agency_id', agencyId)
    .maybeSingle()

  if (!data) return null

  // Decrypt server-side — the VCC form needs the real MBI for the carrier fax
  const { mbi_encrypted, ...member } = data
  return { ...member, mbi: decryptMbi(mbi_encrypted) }
}

export async function markVCCSigned(submissionId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  // Use the auth client to verify the caller has RLS access to this submission.
  // This enforces both tenant isolation (wrong agency → null) and, once the
  // broker-isolated RLS policy is applied, cross-broker isolation (wrong broker
  // within the same agency → null). Service-role writes never happen without
  // this gate passing first.
  const { data: accessCheck } = await supabase
    .from('vcc_submissions')
    .select('id')
    .eq('id', submissionId)
    .maybeSingle()
  if (!accessCheck) throw new Error('Submission not found or access denied')

  const supabaseAdmin = createServiceClient()
  await supabaseAdmin
    .from('vcc_submissions')
    .update({ fax_status: 'signed', signed_at: new Date().toISOString() })
    .eq('id', submissionId)

  revalidatePath(`/dashboard/vcc/${submissionId}`)
  revalidatePath('/dashboard/vcc')
}

export async function resendVCCFax(submissionId: string) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  // Gate: auth-client check enforces RLS before any service-role operations.
  const { data: accessCheck } = await supabase
    .from('vcc_submissions')
    .select('id')
    .eq('id', submissionId)
    .maybeSingle()
  if (!accessCheck) throw new Error('Submission not found or access denied')

  const supabaseAdmin = createServiceClient()
  const { data: submission } = await supabaseAdmin
    .from('vcc_submissions')
    .select('*, vcc_form_templates(*)')
    .eq('id', submissionId)
    .single()

  if (!submission) throw new Error('Submission not found')
  if (!submission.doctor_fax) throw new Error('No doctor fax number on file')

  const pdfBytes = await fillVCCForm(
    submission.vcc_form_templates?.storage_path ?? '',
    (submission.vcc_form_templates?.field_map ?? {}) as Record<string, any>,
    {
      client_name: submission.client_name,
      client_dob: submission.client_dob ?? undefined,
      doctor_name: submission.doctor_name ?? undefined,
      doctor_fax: submission.doctor_fax ?? undefined,
      broker_npn: submission.broker_npn ?? undefined,
    }
  )

  const faxResult = await sendFax(
    pdfBytes,
    submission.doctor_fax,
    `VCC Form (Resend) -- ${submission.client_name} -- ${submission.carrier}`
  )

  await supabaseAdmin
    .from('vcc_submissions')
    .update({
      fax_status: faxResult.success ? 'sent' : 'failed',
      fax_confirmation_id: faxResult.confirmationId ?? null,
      fax_sent_at: faxResult.success ? new Date().toISOString() : null,
    })
    .eq('id', submissionId)

  revalidatePath(`/dashboard/vcc/${submissionId}`)
  return { success: faxResult.success, error: faxResult.error }
}
