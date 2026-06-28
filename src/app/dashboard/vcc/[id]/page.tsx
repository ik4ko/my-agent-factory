import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { CollectionSidebar } from '@/components/collection-sidebar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, FileText, CheckCircle2, Clock, Send } from 'lucide-react'
import { SubmissionActions } from './submission-actions'

type FaxStatus = 'pending' | 'sent' | 'failed' | 'signed' | 'expired' | 'no_fax'

const STATUS_CONFIG: Record<FaxStatus, { label: string; cls: string }> = {
  pending: { label: 'Pending',   cls: 'bg-gray-500/10 text-gray-500 border-gray-500/20' },
  sent:    { label: 'Faxed',     cls: 'bg-blue-500/10 text-blue-600 border-blue-500/20' },
  signed:  { label: 'Signed',    cls: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' },
  failed:  { label: 'Failed',    cls: 'bg-red-500/10 text-red-600 border-red-500/20' },
  expired: { label: 'Expired',   cls: 'bg-red-500/10 text-red-600 border-red-500/20' },
  no_fax:  { label: 'No Fax',    cls: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20' },
}

function fmt(d: string | null | undefined) {
  if (!d) return '--'
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default async function VCCDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const supabaseAdmin = createServiceClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch submission via auth client (RLS enforces access)
  const { data: submission } = await supabase
    .from('vcc_submissions')
    .select('*, broker:broker_id (first_name, last_name, npn)')
    .eq('id', id)
    .single()

  if (!submission) notFound()

  // Role check for principal features
  const { data: agency } = await supabase
    .from('agencies').select('id').eq('owner_id', user.id).maybeSingle()
  const { data: brokerRow } = await supabase
    .from('brokers').select('role').eq('user_id', user.id).maybeSingle()
  const isPrincipal = !!agency || ['agency_admin', 'agency_owner'].includes(brokerRow?.role ?? '')

  // Generate signed URL for PDF download (1-hour expiry)
  let pdfUrl: string | null = null
  if (submission.filled_pdf_path) {
    const { data: signed } = await supabaseAdmin.storage
      .from('VCC-filled')
      .createSignedUrl(submission.filled_pdf_path, 3600)
    pdfUrl = signed?.signedUrl ?? null
  }

  const status = (submission.fax_status ?? 'pending') as FaxStatus
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
  const broker = (submission.broker as unknown) as { first_name: string; last_name: string; npn: string | null } | null
  const daysLeft = Math.ceil((new Date(submission.deadline_at).getTime() - Date.now()) / 86400000)

  const timeline = [
    { label: 'Submitted',  date: submission.created_at,  done: true,  icon: FileText },
    { label: 'Faxed',      date: submission.fax_sent_at, done: !!submission.fax_sent_at, icon: Send },
    { label: 'Signed',     date: submission.signed_at,   done: !!submission.signed_at, icon: CheckCircle2 },
  ]

  return (
    <div className="flex h-full w-full bg-background">
      <CollectionSidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="h-16 border-b border-border px-8 flex items-center gap-4 bg-white/50 backdrop-blur-md sticky top-0 z-10">
          <Button variant="ghost" size="sm" asChild className="rounded-xl font-black uppercase text-[10px] tracking-widest">
            <Link href="/dashboard/vcc"><ArrowLeft className="w-4 h-4 mr-1" /> VCC Forms</Link>
          </Button>
          <div className="flex items-center gap-3 ml-2">
            <span className="text-[11px] font-black uppercase tracking-widest text-foreground">{submission.client_name}</span>
            <Badge className={`text-[8px] font-black uppercase px-2 border ${cfg.cls}`}>{cfg.label}</Badge>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full pb-32 space-y-6">
          {/* Actions */}
          <SubmissionActions
            submissionId={id}
            faxStatus={status}
            isPrincipal={isPrincipal}
            pdfUrl={pdfUrl}
            doctorFax={submission.doctor_fax ?? null}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Submission Details */}
            <Card className="rounded-3xl border border-border shadow-sm">
              <CardHeader className="border-b bg-muted/30">
                <CardTitle className="text-sm font-black uppercase tracking-tight">Submission Details</CardTitle>
              </CardHeader>
              <CardContent className="p-5 space-y-3">
                {[
                  ['Client',          submission.client_name],
                  ['Date of Birth',   submission.client_dob ?? '--'],
                  ['Carrier',         submission.carrier],
                  ['Broker NPN',      submission.broker_npn ?? '--'],
                  ['Broker Name',     broker ? `${broker.first_name} ${broker.last_name}` : '--'],
                  ['GHL Contact ID',  submission.ghl_contact_id],
                  ['Submitted',       fmt(submission.created_at)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</span>
                    <span className="text-[11px] font-bold text-right">{value}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Fax Details */}
            <Card className="rounded-3xl border border-border shadow-sm">
              <CardHeader className="border-b bg-muted/30">
                <CardTitle className="text-sm font-black uppercase tracking-tight">Fax Details</CardTitle>
              </CardHeader>
              <CardContent className="p-5 space-y-3">
                {[
                  ['Doctor Name',      submission.doctor_name ?? '--'],
                  ['Doctor Fax',       submission.doctor_fax ?? '--'],
                  ['Fax Status',       cfg.label],
                  ['Confirmation ID',  submission.fax_confirmation_id ?? '--'],
                  ['Fax Sent',         fmt(submission.fax_sent_at)],
                  ['Signed',           fmt(submission.signed_at)],
                  ['Deadline',         fmt(submission.deadline_at)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</span>
                    <span className={`text-[11px] font-bold text-right ${label === 'Deadline' && daysLeft < 14 ? 'text-red-500' : ''}`}>
                      {value}{label === 'Deadline' && daysLeft > 0 && daysLeft < 14 && ` (${daysLeft}d left)`}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Timeline */}
          <Card className="rounded-3xl border border-border shadow-sm">
            <CardHeader className="border-b bg-muted/30">
              <CardTitle className="text-sm font-black uppercase tracking-tight flex items-center gap-2">
                <Clock className="w-4 h-4" /> Timeline
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5">
              <div className="flex items-center gap-0">
                {timeline.map((step, i) => (
                  <div key={step.label} className="flex items-center flex-1">
                    <div className="flex flex-col items-center gap-2 flex-1">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                        step.done ? 'bg-primary/10 text-primary border border-primary/30' : 'bg-muted text-muted-foreground border border-border'
                      }`}>
                        <step.icon className="w-4 h-4" />
                      </div>
                      <div className="text-center">
                        <p className="text-[9px] font-black uppercase tracking-widest">{step.label}</p>
                        {step.date && (
                          <p className="text-[8px] text-muted-foreground mt-0.5">{fmt(step.date)}</p>
                        )}
                      </div>
                    </div>
                    {i < timeline.length - 1 && (
                      <div className={`flex-1 h-px mx-2 ${step.done ? 'bg-primary/30' : 'bg-border'}`} />
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
