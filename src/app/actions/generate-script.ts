'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { ai } from '@/ai/genkit'

export type ScriptType = 'retention' | 'VCC_followup' | 'reactive_save' | 'aep_reminder'

export interface GenerateScriptInput {
  ghlContactId: string
  scriptType: ScriptType
}

export interface GenerateScriptResult {
  script: string
  scriptType: ScriptType
  generatedAt: string
  error?: string
}

export async function generateRetentionScript(
  input: GenerateScriptInput
): Promise<GenerateScriptResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const supabaseAdmin = createServiceClient()

  // Resolve agency + broker
  const { data: agencyRow } = await supabase
    .from('agencies').select('id').eq('owner_id', user.id).maybeSingle()
  const { data: brokerRow } = await supabase
    .from('brokers').select('id, agency_id, first_name').eq('user_id', user.id).maybeSingle()

  const agencyId = agencyRow?.id ?? brokerRow?.agency_id ?? null
  const brokerFirstName = brokerRow?.first_name ?? 'Your broker'

  if (!agencyId) return {
    script: '', scriptType: input.scriptType,
    generatedAt: new Date().toISOString(), error: 'No agency found'
  }

  // Fetch contact context (no raw PHI)
  const { data: contact } = await supabaseAdmin
    .from('ghl_contacts')
    .select('risk_level, risk_score, current_plan_id, enrollment_status')
    .eq('agency_id', agencyId)
    .eq('ghl_contact_id', input.ghlContactId)
    .maybeSingle()

  const { count: alertCount } = await supabaseAdmin
    .from('switch_alerts')
    .select('id', { count: 'exact', head: true })
    .eq('agency_id', agencyId)
    .eq('ghl_contact_id', input.ghlContactId)
    .in('status', ['open', 'contacted'])

  const { data: latestVCC } = await supabaseAdmin
    .from('vcc_submissions')
    .select('fax_status, signed_at')
    .eq('agency_id', agencyId)
    .eq('ghl_contact_id', input.ghlContactId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const scriptTypeLabels: Record<ScriptType, string> = {
    retention: 'member retention outreach',
    VCC_followup: 'VCC plan-change follow-up',
    reactive_save: 'reactive save after detected switch',
    aep_reminder: 'Annual Enrollment Period reminder',
  }

  const prompt = `You are a Medicare insurance retention specialist.
Generate a ${scriptTypeLabels[input.scriptType]} phone script for a broker.

COMPLIANCE: This script must follow CMS TPMO rules:
- Never guarantee benefits or coverage
- Never disparage competitors by name
- Always identify as the client's broker
- Include opt-out language for any follow-up

CLIENT CONTEXT (no PHI):
- Risk Level: ${contact?.risk_level ?? 'unknown'}
- Enrollment Status: ${contact?.enrollment_status ?? 'unknown'}
- Current Plan Type: ${contact?.current_plan_id ?? 'unknown'}
- Open Alerts: ${alertCount ?? 0}
- VCC Status: ${latestVCC?.fax_status ?? 'none'}
- Broker Name: ${brokerFirstName}

Generate a natural, conversational script with these clearly labeled sections:
**Opening**, **Purpose Statement**, **Key Talking Points** (3 bullet points), **Objection Handler**, **Close + Next Step**. Under 300 words.`

  try {
    const { text } = await ai.generate(prompt)

    await supabaseAdmin.from('audit_log').insert({
      agency_id: agencyId,
      user_id: user.id,
      action: 'SCRIPT_GENERATED',
      resource_type: 'ghl_contacts',
      resource_id: input.ghlContactId,
      metadata: { scriptType: input.scriptType, ghlContactId: input.ghlContactId },
    })

    return {
      script: text,
      scriptType: input.scriptType,
      generatedAt: new Date().toISOString(),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      script: '', scriptType: input.scriptType,
      generatedAt: new Date().toISOString(), error: msg
    }
  }
}

export async function getAgencyContacts(): Promise<Array<{
  ghl_contact_id: string
  enrollment_status: string | null
  risk_level: string | null
}>> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: agencyRow } = await supabase
    .from('agencies').select('id').eq('owner_id', user.id).maybeSingle()
  const { data: brokerRow } = await supabase
    .from('brokers').select('agency_id').eq('user_id', user.id).maybeSingle()
  const agencyId = agencyRow?.id ?? brokerRow?.agency_id ?? null
  if (!agencyId) return []

  const { data } = await supabase
    .from('ghl_contacts')
    .select('ghl_contact_id, enrollment_status, risk_level')
    .eq('agency_id', agencyId)
    .order('risk_score', { ascending: false })
    .limit(100)

  return data ?? []
}
