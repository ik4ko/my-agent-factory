import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FileCheck } from 'lucide-react'
import { VCCSmartPage } from './vcc-smart-page'

export default async function VCCPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: agency }, { data: brokerRow }] = await Promise.all([
    supabase.from('agencies').select('id').eq('owner_id', user.id).maybeSingle(),
    supabase.from('brokers').select('id, role, agency_id').eq('user_id', user.id).maybeSingle(),
  ])

  const isPrincipal = !!agency || ['agency_admin', 'agency_owner'].includes(brokerRow?.role ?? '')
  const agencyId = agency?.id ?? brokerRow?.agency_id ?? ''
  const brokerId = brokerRow?.id ?? null

  // Fetch submissions — principals see all, brokers see their own
  let query = supabase
    .from('vcc_submissions')
    .select('id, client_name, carrier, fax_status, deadline_at, created_at, send_scheduled_at, broker_id')
    .eq('agency_id', agencyId)
    .order('deadline_at', { ascending: true })

  if (!isPrincipal && brokerId) {
    query = query.eq('broker_id', brokerId)
  }

  const { data: submissions } = await query

  // Fetch broker name map for principal view
  let brokerMap: Record<string, string> = {}
  if (isPrincipal && (submissions ?? []).length > 0) {
    const ids = [...new Set((submissions ?? []).map(s => s.broker_id).filter(Boolean) as string[])]
    if (ids.length > 0) {
      const { data: brokers } = await supabase
        .from('brokers').select('id, first_name, last_name').in('id', ids)
      brokerMap = Object.fromEntries((brokers ?? []).map(b => [b.id, `${b.first_name} ${b.last_name}`]))
    }
  }

  return (
    <div className="flex flex-col h-full w-full bg-background">
      <header className="h-16 border-b border-slate-800 px-8 flex items-center gap-3 bg-slate-950/80 backdrop-blur-md sticky top-0 z-10">
        <div className="w-9 h-9 rounded-2xl bg-primary/10 flex items-center justify-center">
          <FileCheck className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-black text-white uppercase tracking-tight">VCC Forms</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            Doctor-signed carrier verification
          </p>
        </div>
      </header>

      <VCCSmartPage
        submissions={submissions ?? []}
        isPrincipal={isPrincipal}
        brokerId={brokerId}
        agencyId={agencyId}
        brokerMap={brokerMap}
      />
    </div>
  )
}
