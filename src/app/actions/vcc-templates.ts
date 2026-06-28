'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

export interface FieldDef {
  page: number
  x: number
  y: number
  size: number
}

export interface TemplatePayload {
  carrier: string
  year: number
  formName: string
  version: number
  fieldMap: Record<string, FieldDef>
  storagePath: string
}

export async function saveTemplate(payload: TemplatePayload): Promise<{ id?: string; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const supabaseAdmin = createServiceClient()

  const id = `${payload.carrier}_${payload.year}_v${payload.version}`

  const { data, error } = await supabaseAdmin
    .from('vcc_form_templates')
    .upsert({
      id,
      carrier: payload.carrier,
      carrier_display_name: CARRIER_LABELS[payload.carrier] ?? payload.carrier,
      year: payload.year,
      form_name: payload.formName,
      storage_path: payload.storagePath,
      version: payload.version,
      field_map: payload.fieldMap,
      active: true,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  return { id: data?.id }
}

export async function testFillTemplate(input: {
  templateId: string
  storagePath: string
  fieldMap: Record<string, FieldDef>
  brokerNpn: string
  brokerName: string
}): Promise<{ pdfBase64?: string; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const supabaseAdmin = createServiceClient()

  // Download original PDF from storage
  const { data: fileData, error: dlError } = await supabaseAdmin
    .storage
    .from('vcc-templates')
    .download(input.storagePath)

  if (dlError || !fileData) return { error: `Could not download template: ${dlError?.message}` }

  const arrayBuffer = await fileData.arrayBuffer()
  const pdfDoc = await PDFDocument.load(arrayBuffer)
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const pages = pdfDoc.getPages()

  const DUMMY: Record<string, string> = {
    client_name: 'John Medicare',
    client_dob: '01/01/1945',
    medicare_id: 'TEST-MBI-HASH',
    doctor_name: 'Dr. Jane Smith',
    doctor_fax: '(555) 000-0000',
    broker_npn: input.brokerNpn,
    broker_name: input.brokerName,
    submission_date: new Date().toLocaleDateString(),
  }

  for (const [fieldName, def] of Object.entries(input.fieldMap)) {
    const pageIndex = (def.page ?? 1) - 1
    if (pageIndex < 0 || pageIndex >= pages.length) continue
    const page = pages[pageIndex]
    const value = DUMMY[fieldName] ?? `[${fieldName}]`
    page.drawText(value, {
      x: def.x,
      y: def.y,
      size: def.size || 10,
      font,
      color: rgb(0.8, 0, 0),
    })
  }

  const pdfBytes = await pdfDoc.save()
  const base64 = Buffer.from(pdfBytes).toString('base64')
  return { pdfBase64: base64 }
}

export async function uploadTemplatePDF(
  formData: FormData
): Promise<{ storagePath?: string; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const supabaseAdmin = createServiceClient()
  const file = formData.get('file') as File | null
  const carrier = formData.get('carrier') as string
  const year = formData.get('year') as string
  const version = formData.get('version') as string

  if (!file || file.size === 0) return { error: 'No file provided' }
  if (!carrier || !year) return { error: 'Missing carrier or year' }

  const ext = file.name.split('.').pop() ?? 'pdf'
  const storagePath = `${year}/${carrier}/form_v${version ?? '1'}.${ext}`
  const buffer = await file.arrayBuffer()

  const { error } = await supabaseAdmin
    .storage
    .from('vcc-templates')
    .upload(storagePath, new Uint8Array(buffer), {
      contentType: file.type || 'application/pdf',
      upsert: true,
    })

  if (error) return { error: error.message }
  return { storagePath }
}

const CARRIER_LABELS: Record<string, string> = {
  humana: 'Humana',
  uhc: 'United Healthcare',
  aetna: 'Aetna',
  bcbs: 'Blue Cross Blue Shield',
  wellcare: 'Wellcare',
  cigna: 'Cigna',
  other: 'Other',
}
