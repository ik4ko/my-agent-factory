'use client'

import { useState, useEffect, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Loader2, CheckCircle2, AlertCircle, Clock, FileText,
  Send, Calendar, ChevronRight, Search, AlertTriangle,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { getVCCCarriers, submitVCC } from '@/app/actions/vcc-submit'
import { createClient } from '@/lib/supabase/client'

interface Contact {
  id: string
  ghl_contact_id: string
  full_name: string | null
  current_plan_id: string | null
  aor_status: string | null
  doctor_name?: string | null
  doctor_fax?: string | null
}

interface Carrier {
  id: string
  carrier: string
  carrier_display_name: string
  year: number
}

type FaxStatus = 'pending' | 'sent' | 'failed' | 'signed' | 'expired' | 'no_fax' | 'scheduled'

const STATUS_CONFIG: Record<FaxStatus, { label: string; cls: string }> = {
  pending:   { label: 'Pending',   cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20' },
  sent:      { label: 'Faxed',     cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  signed:    { label: 'Signed',    cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  failed:    { label: 'Failed',    cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  expired:   { label: 'Expired',   cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
  no_fax:    { label: 'No Fax',    cls: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
  scheduled: { label: 'Scheduled', cls: 'bg-violet-500/10 text-violet-400 border-violet-500/20' },
}

interface Submission {
  id: string
  client_name: string
  carrier: string
  fax_status: string
  deadline_at: string
  created_at: string
  send_scheduled_at: string | null
  broker_id?: string | null
}

interface Props {
  submissions: Submission[]
  isPrincipal: boolean
  brokerId?: string | null
  agencyId: string
  brokerMap?: Record<string, string>
}

function daysUntil(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
}

function StepDot({ n, current }: { n: number; current: number }) {
  const done = n < current
  const active = n === current
  return (
    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-black shrink-0 transition-all ${
      done ? 'bg-primary text-white' : active ? 'bg-primary/20 text-primary border border-primary' : 'bg-slate-800 text-slate-500 border border-slate-700'
    }`}>
      {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : n}
    </div>
  )
}

export function VCCSmartPage({ submissions: initialSubmissions, isPrincipal, brokerId, agencyId, brokerMap }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  const [step, setStep] = useState(1)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [carriers, setCarriers] = useState<Carrier[]>([])
  const [search, setSearch] = useState('')
  const [submissions, setSubmissions] = useState<Submission[]>(initialSubmissions)

  // Form state
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [carrierId, setCarrierId] = useState('')
  const [doctorName, setDoctorName] = useState('')
  const [doctorFax, setDoctorFax] = useState('')
  const [planName, setPlanName] = useState('')
  const [planEffectiveDate, setPlanEffectiveDate] = useState('')
  const [sendMode, setSendMode] = useState<'now' | 'schedule'>('now')
  const [scheduleDate, setScheduleDate] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data: broker } = await supabase
        .from('brokers')
        .select('id, agency_id')
        .eq('user_id', user.id)
        .maybeSingle()
      if (!broker) return
      const { data: rows } = await supabase
        .from('ghl_contacts')
        .select('id, ghl_contact_id, full_name, current_plan_id, aor_status, doctor_name, doctor_fax')
        .eq('agency_id', broker.agency_id)
        .order('full_name')
      setContacts(rows ?? [])
    })
    getVCCCarriers().then(setCarriers)
  }, [])

  const filteredContacts = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return contacts.slice(0, 50)
    return contacts.filter(c => (c.full_name ?? '').toLowerCase().includes(q)).slice(0, 50)
  }, [contacts, search])

  const selectedCarrier = carriers.find(c => c.id === carrierId)

  function selectContact(c: Contact) {
    setSelectedContact(c)
    setPlanName(c.current_plan_id ?? '')
    setDoctorName(c.doctor_name ?? '')
    setDoctorFax(c.doctor_fax ?? '')
    setError('')
    setStep(2)
  }

  function goToStep3() {
    if (!carrierId) { setError('Please select a carrier'); return }
    setError('')
    setStep(3)
  }

  function reset() {
    setStep(1)
    setSelectedContact(null)
    setCarrierId('')
    setDoctorName('')
    setDoctorFax('')
    setPlanName('')
    setPlanEffectiveDate('')
    setSendMode('now')
    setScheduleDate('')
    setSearch('')
    setError('')
  }

  function handleSend() {
    if (!selectedContact) return
    if (sendMode === 'schedule' && !scheduleDate) {
      setError('Please select a send date')
      return
    }
    setError('')

    startTransition(async () => {
      try {
        const supabase = createClient()
        if (sendMode === 'schedule' && scheduleDate) {
          // Insert as scheduled - call server action but pass extra scheduling metadata
          // We do this by inserting directly then letting the cron pick it up
          const { data: { user } } = await supabase.auth.getUser()
          if (!user) throw new Error('Not authenticated')
          const { data: broker } = await supabase
            .from('brokers').select('id, agency_id, npn').eq('user_id', user.id).maybeSingle()
          if (!broker) throw new Error('Broker not found')

          const deadline = new Date()
          deadline.setDate(deadline.getDate() + 60)

          // Destructure the error — Supabase client never throws, it returns
          // errors in the result object. Without this check a failed insert
          // (e.g. RLS rejection or constraint violation) would silently fire
          // the success toast and leave the user with a phantom confirmation.
          const { error: insertErr } = await supabase.from('vcc_submissions').insert({
            agency_id: broker.agency_id,
            ghl_contact_id: selectedContact.ghl_contact_id,
            broker_id: broker.id,
            submitted_by: user.id,
            carrier: selectedCarrier?.carrier ?? carrierId,
            form_template_id: carrierId,
            client_name: selectedContact.full_name ?? 'Unknown',
            doctor_name: doctorName || null,
            doctor_fax: doctorFax || null,
            broker_npn: broker.npn ?? null,
            deadline_at: deadline.toISOString(),
            fax_status: 'scheduled',
            send_scheduled_at: new Date(scheduleDate).toISOString(),
            plan_effective_date: planEffectiveDate || null,
          })
          if (insertErr) throw new Error(insertErr.message)

          toast({ title: 'VCC scheduled', description: `Will fax on ${new Date(scheduleDate).toLocaleDateString()}` })
        } else {
          const result = await submitVCC({
            ghl_contact_id: selectedContact.ghl_contact_id,
            carrier: selectedCarrier?.carrier ?? carrierId,
            form_template_id: carrierId,
            client_name: selectedContact.full_name ?? 'Unknown',
            doctor_name: doctorName || undefined,
            doctor_fax: doctorFax || undefined,
            send_fax: !!doctorFax,
          })
          toast({
            title: 'VCC submitted',
            description: doctorFax
              ? `Fax ${result.faxStatus === 'sent' ? 'sent' : 'queued'} to ${doctorFax}`
              : 'PDF generated and saved',
          })
        }

        // Refresh submissions list with same filters applied server-side
        let freshQ = supabase
          .from('vcc_submissions')
          .select('id, client_name, carrier, fax_status, deadline_at, created_at, send_scheduled_at, broker_id')
          .eq('agency_id', agencyId)
          .order('deadline_at', { ascending: true })
        if (!isPrincipal && brokerId) freshQ = freshQ.eq('broker_id', brokerId)
        const { data: fresh } = await freshQ
        setSubmissions(fresh ?? [])

        reset()
        router.refresh()
      } catch (err: any) {
        toast({ variant: 'destructive', title: 'Submission failed', description: err.message })
      }
    })
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full space-y-8 pb-32">

      {/* === Submit VCC Form === */}
      <Card className="rounded-3xl border border-slate-800 bg-slate-900/60 shadow-sm overflow-hidden">
        <CardHeader className="border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Send className="w-4 h-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm font-black uppercase tracking-tight text-white">Submit VCC Form</CardTitle>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                Step {step} of 3
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {[1, 2, 3].map(n => (
                <div key={n} className="flex items-center gap-2">
                  <StepDot n={n} current={step} />
                  {n < 3 && <div className={`w-8 h-px ${step > n ? 'bg-primary' : 'bg-slate-700'}`} />}
                </div>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-6">

          {/* Step 1: Select Client */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-black uppercase tracking-tight text-white">Select Client</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">Choose the member to submit a VCC form for</p>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by name..."
                  className="pl-8 h-10 rounded-xl bg-slate-800 border-slate-700 text-white placeholder:text-slate-500 text-sm"
                />
              </div>
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {contacts.length === 0 ? (
                  <p className="text-center text-[11px] text-slate-500 py-8">No contacts synced yet</p>
                ) : filteredContacts.length === 0 ? (
                  <p className="text-center text-[11px] text-slate-500 py-8">No matches</p>
                ) : filteredContacts.map(c => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => selectContact(c)}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 hover:border-primary/40 transition-all text-left group"
                  >
                    <div>
                      <p className="text-sm font-bold text-white">{c.full_name ?? 'Unknown'}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{c.current_plan_id ?? 'No plan on file'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {c.aor_status === 'locked' && (
                        <Badge className="text-[8px] font-black uppercase px-1.5 bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border">
                          AOR
                        </Badge>
                      )}
                      <ChevronRight className="w-3.5 h-3.5 text-slate-600 group-hover:text-primary transition-colors" />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: Confirm Details */}
          {step === 2 && selectedContact && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-tight text-white">Confirm Details</h3>
                  <p className="text-[10px] text-slate-400 mt-0.5">Review and update before sending</p>
                </div>
                <button type="button" onClick={() => setStep(1)} className="text-[10px] text-slate-400 hover:text-white font-bold uppercase tracking-widest">
                  Change client
                </button>
              </div>

              {/* Client read-only */}
              <div className="rounded-xl bg-slate-800/50 border border-slate-700 px-4 py-3">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Client</p>
                <p className="text-sm font-bold text-white">{selectedContact.full_name}</p>
                {selectedContact.current_plan_id && (
                  <p className="text-[10px] text-slate-400 mt-0.5">{selectedContact.current_plan_id}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-slate-300">Carrier *</Label>
                  <Select value={carrierId} onValueChange={v => { setCarrierId(v); setError('') }}>
                    <SelectTrigger className="h-10 rounded-xl bg-slate-800 border-slate-700 text-white">
                      <SelectValue placeholder="Select carrier..." />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-700">
                      {carriers.map(c => (
                        <SelectItem key={c.id} value={c.id} className="text-white hover:bg-slate-800">
                          {c.carrier_display_name} ({c.year})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-slate-300">Plan Name</Label>
                  <Input
                    value={planName}
                    onChange={e => setPlanName(e.target.value)}
                    placeholder="e.g. Humana Gold Plus"
                    className="h-10 rounded-xl bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-slate-300">Plan Effective Date</Label>
                  <Input
                    type="date"
                    value={planEffectiveDate}
                    onChange={e => setPlanEffectiveDate(e.target.value)}
                    className="h-10 rounded-xl bg-slate-800 border-slate-700 text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-slate-300">Doctor Name</Label>
                  <Input
                    value={doctorName}
                    onChange={e => setDoctorName(e.target.value)}
                    placeholder="Dr. Jane Smith"
                    className="h-10 rounded-xl bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-slate-300">Doctor Fax</Label>
                  <Input
                    value={doctorFax}
                    onChange={e => setDoctorFax(e.target.value)}
                    placeholder="(555) 000-0000"
                    className="h-10 rounded-xl bg-slate-800 border-slate-700 text-white placeholder:text-slate-500"
                  />
                </div>
              </div>

              {/* Scheduling */}
              <div className="space-y-3">
                <Label className="text-[10px] font-black uppercase tracking-widest text-slate-300">Send Options</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSendMode('now')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      sendMode === 'now' ? 'border-primary bg-primary/10' : 'border-slate-700 hover:border-slate-600 bg-slate-800/50'
                    }`}
                  >
                    <p className="text-xs font-black text-white">Send now</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">Fax immediately on submit</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSendMode('schedule')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      sendMode === 'schedule' ? 'border-primary bg-primary/10' : 'border-slate-700 hover:border-slate-600 bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3 h-3 text-violet-400" />
                      <p className="text-xs font-black text-white">Schedule send</p>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">Fax on a future date</p>
                  </button>
                </div>
                {sendMode === 'schedule' && (
                  <Input
                    type="date"
                    value={scheduleDate}
                    onChange={e => setScheduleDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    className="h-10 rounded-xl bg-slate-800 border-slate-700 text-white"
                  />
                )}
              </div>

              {error && (
                <div className="flex items-center gap-1.5 text-red-400">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <p className="text-[10px] font-bold">{error}</p>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  className="rounded-xl font-black uppercase text-[10px] tracking-widest border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  Back
                </Button>
                <Button
                  onClick={goToStep3}
                  className="flex-1 rounded-xl font-black uppercase text-[10px] tracking-widest"
                >
                  Review <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Send */}
          {step === 3 && selectedContact && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-black uppercase tracking-tight text-white">Ready to Send</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">Review the summary and confirm</p>
              </div>

              <div className="rounded-xl bg-slate-800/50 border border-slate-700 divide-y divide-slate-700">
                {[
                  ['Client', selectedContact.full_name ?? 'Unknown'],
                  ['Carrier', selectedCarrier?.carrier_display_name ?? carrierId],
                  ['Doctor', doctorName || '--'],
                  ['Fax', doctorFax || '--'],
                  ['Plan Effective', planEffectiveDate || '--'],
                  ['Send Mode', sendMode === 'schedule' ? `Scheduled: ${scheduleDate}` : 'Immediately'],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">{label}</span>
                    <span className="text-[11px] font-bold text-slate-200">{value}</span>
                  </div>
                ))}
              </div>

              {!doctorFax && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-amber-400 font-bold">
                    No doctor fax number -- form will be saved as PDF only. Add a fax number in Step 2 to auto-dispatch.
                  </p>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-1.5 text-red-400">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <p className="text-[10px] font-bold">{error}</p>
                </div>
              )}

              <div className="flex gap-3 pt-1">
                <Button
                  variant="outline"
                  onClick={() => setStep(2)}
                  className="rounded-xl font-black uppercase text-[10px] tracking-widest border-slate-700 text-slate-300 hover:bg-slate-800"
                >
                  Back
                </Button>
                <Button
                  onClick={handleSend}
                  disabled={isPending}
                  className="flex-1 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2"
                >
                  {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  {isPending ? 'Sending...' : sendMode === 'schedule' ? 'Schedule VCC' : 'Send VCC to Doctor'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* === Submission History === */}
      <Card className="rounded-3xl border border-slate-800 bg-slate-900/60 shadow-sm overflow-hidden">
        <CardHeader className="border-b border-slate-800">
          <CardTitle className="text-sm font-black uppercase tracking-tight text-white flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-400" />
            Submission History
            <Badge className="ml-1 text-[8px] font-black bg-slate-800 text-slate-300 border-slate-700 border">
              {submissions.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {submissions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <FileText className="w-10 h-10 text-slate-700" />
              <p className="text-[11px] font-black uppercase tracking-widest text-slate-600">No submissions yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-slate-800">
                    <TableHead className="font-black uppercase text-[9px] tracking-widest text-slate-500 py-3 px-6">Client</TableHead>
                    <TableHead className="font-black uppercase text-[9px] tracking-widest text-slate-500">Carrier</TableHead>
                    {isPrincipal && <TableHead className="font-black uppercase text-[9px] tracking-widest text-slate-500">Broker</TableHead>}
                    <TableHead className="font-black uppercase text-[9px] tracking-widest text-slate-500">Status</TableHead>
                    <TableHead className="font-black uppercase text-[9px] tracking-widest text-slate-500">Deadline</TableHead>
                    <TableHead className="font-black uppercase text-[9px] tracking-widest text-slate-500">Scheduled For</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.map(s => {
                    const status = (s.fax_status ?? 'pending') as FaxStatus
                    const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending
                    const days = daysUntil(s.deadline_at)
                    return (
                      <TableRow key={s.id} className="border-slate-800 hover:bg-slate-800/40">
                        <TableCell className="px-6 py-3 font-bold text-sm text-slate-200">{s.client_name}</TableCell>
                        <TableCell className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                          {s.carrier}
                        </TableCell>
                        {isPrincipal && (
                          <TableCell className="text-[10px] text-slate-400 font-medium">
                            {s.broker_id ? (brokerMap?.[s.broker_id] ?? '—') : '—'}
                          </TableCell>
                        )}
                        <TableCell>
                          <Badge className={`text-[8px] font-black uppercase px-2 border ${cfg.cls}`}>
                            {cfg.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className={`flex items-center gap-1 text-[10px] font-bold ${days < 14 ? 'text-red-400' : 'text-slate-400'}`}>
                            {days < 14 && <Clock className="w-3 h-3" />}
                            {days > 0 ? `${days}d left` : 'Overdue'}
                          </span>
                        </TableCell>
                        <TableCell className="text-[10px] text-slate-500">
                          {s.send_scheduled_at
                            ? new Date(s.send_scheduled_at).toLocaleDateString()
                            : '--'}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
