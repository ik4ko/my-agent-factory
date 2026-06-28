'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Loader2, ArrowLeft, ArrowRight, FileText, CheckCircle2,
  AlertCircle, Phone, User2, Stethoscope, Info,
} from 'lucide-react'
import Link from 'next/link'
import { useToast } from '@/hooks/use-toast'
import { getVCCCarriers, submitVCC, getMemberForVCC } from '@/app/actions/vcc-submit'

interface Carrier { id: string; carrier: string; carrier_display_name: string; year: number }

interface FormState {
  carrier_id:     string
  client_name:    string
  client_dob:     string
  medicare_id:    string
  doctor_name:    string
  doctor_fax:     string
  broker_npn:     string
  bob_member_id:  string   // book_of_business.id (preferred when coming from Book page)
  ghl_contact_id: string   // GHL contact id (fallback)
  send_fax:       boolean
  is_chronic:     boolean
}

const STEPS = ['Carrier', 'Client Info', 'Physician', 'Review & Send']

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
      <p className="text-[10px] font-bold text-red-400">{msg}</p>
    </div>
  )
}

export default function VCCNewPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()

  const [step, setStep]         = useState(1)
  const [carriers, setCarriers] = useState<Carrier[]>([])
  const [prefilling, setPrefilling] = useState(false)
  const [prefilled, setPrefilled]   = useState(false)
  const [errors, setErrors]     = useState<Partial<Record<keyof FormState, string>>>({})

  const bobId      = searchParams?.get('bob')        ?? ''
  const contactId  = searchParams?.get('contact_id') ?? ''
  // is_chronic=1 → pre-check the Chronic Condition Plan flag (from DSNP button)
  const isChronicParam = searchParams?.get('is_chronic') === '1'
  // type=transition_notice → member is on a standard plan (non-chronic).
  // Routes to the Insurance Transition Notice template instead of the
  // Chronic Condition form. Passed by the VCC button in book-member-table
  // for any non-DSNP member row.
  const isTransitionNotice = searchParams?.get('type') === 'transition_notice'

  const [form, setForm] = useState<FormState>({
    carrier_id:     '',
    client_name:    '',
    client_dob:     '',
    medicare_id:    '',
    doctor_name:    '',
    doctor_fax:     '',
    broker_npn:     '',
    bob_member_id:  bobId,
    ghl_contact_id: contactId,
    send_fax:       true,
    is_chronic:     isChronicParam,
  })

  // ── Load carriers ────────────────────────────────────────────────────────────
  useEffect(() => {
    getVCCCarriers().then(setCarriers)
  }, [])

  // ── Pre-fill from Book of Business member ────────────────────────────────────
  useEffect(() => {
    if (!bobId) return
    setPrefilling(true)
    getMemberForVCC(bobId).then(member => {
      if (!member) return
      setForm(f => ({
        ...f,
        client_name:   member.full_name ?? f.client_name,
        medicare_id:   member.mbi       ?? f.medicare_id,
        doctor_name:   member.doctor_name ?? f.doctor_name,
        doctor_fax:    member.doctor_fax  ?? f.doctor_fax,
        bob_member_id: member.id,
      }))
      setPrefilled(true)
    }).finally(() => setPrefilling(false))
  }, [bobId])

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, [key]: e.target.value }))
    setErrors(e => ({ ...e, [key]: undefined }))
  }

  const selectedCarrier = carriers.find(c => c.id === form.carrier_id)

  const validateStep = () => {
    const errs: typeof errors = {}
    if (step === 1 && !form.carrier_id)      errs.carrier_id  = 'Select a carrier'
    if (step === 2 && !form.client_name.trim()) errs.client_name = 'Client name is required'
    if (step === 3 && form.send_fax && !form.doctor_fax.trim()) {
      errs.doctor_fax = 'Fax number required to auto-send (or choose manual dispatch below)'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const next = () => { if (validateStep()) setStep(s => s + 1) }
  const back = () => setStep(s => s - 1)

  const handleSubmit = () => {
    if (!validateStep()) return
    startTransition(async () => {
      try {
        const result = await submitVCC({
          ghl_contact_id:   form.ghl_contact_id || form.bob_member_id || 'n/a',
          carrier:          selectedCarrier?.carrier ?? form.carrier_id,
          form_template_id: form.carrier_id,
          // form_type routes the PDF engine to the correct template:
          //   'transition_notice' → New Insurance Transition Notice (standard plans)
          //   'vcc'               → Vendor Certification Continuation (chronic/DSNP)
          form_type:        isTransitionNotice ? 'transition_notice' : 'vcc',
          client_name:      form.client_name,
          client_dob:       form.client_dob    || undefined,
          medicare_id:      form.medicare_id   || undefined,
          doctor_name:      form.doctor_name   || undefined,
          doctor_fax:       form.doctor_fax    || undefined,
          broker_npn:       form.broker_npn    || undefined,
          send_fax:         form.send_fax,
        })
        toast({
          title: 'VCC Form submitted',
          description: form.send_fax && form.doctor_fax
            ? `Fax ${result.faxStatus === 'sent' ? 'sent ✓' : 'queued'} to ${form.doctor_fax}`
            : 'PDF generated and stored securely',
        })
        router.push('/dashboard/vcc')
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        toast({ variant: 'destructive', title: 'Submission failed', description: msg })
      }
    })
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="h-16 border-b border-border px-8 flex items-center gap-4 bg-slate-950/80 backdrop-blur sticky top-0 z-10">
        <Button variant="ghost" size="sm" asChild className="rounded-xl font-black uppercase text-[10px] tracking-widest">
          <Link href="/dashboard/vcc"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Link>
        </Button>
        <div className="flex items-center gap-2 text-muted-foreground">
          <FileText className="w-4 h-4" />
          <span className="text-[11px] font-black uppercase tracking-widest">
            {isTransitionNotice ? 'Insurance Transition Notice' : 'New VCC Submission'}
          </span>
        </div>
        {prefilled && (
          <Badge className="ml-auto text-[8px] font-black bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border">
            <CheckCircle2 className="w-3 h-3 mr-1" /> Pre-filled from Book of Business
          </Badge>
        )}
      </header>

      {/* Step indicator */}
      <div className="px-8 py-4 border-b border-border">
        <div className="flex items-center gap-2 max-w-2xl mx-auto">
          {STEPS.map((label, i) => {
            const n = i + 1
            const active = n === step
            const done   = n < step
            return (
              <div key={label} className="flex items-center gap-2 flex-1">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-black shrink-0 transition-colors ${
                  done ? 'bg-primary text-white' : active ? 'bg-primary/20 text-primary border border-primary' : 'bg-muted text-muted-foreground'
                }`}>
                  {done ? <CheckCircle2 className="w-3 h-3" /> : n}
                </div>
                <span className={`text-[10px] font-black uppercase tracking-widest hidden sm:block ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {label}
                </span>
                {i < STEPS.length - 1 && <div className="flex-1 h-px bg-border mx-2" />}
              </div>
            )
          })}
        </div>
      </div>

      <main className="flex-1 flex items-start justify-center p-8">
        <Card className="w-full max-w-2xl rounded-3xl border border-border shadow-sm p-8 space-y-6">

          {prefilling && (
            <div className="flex items-center gap-2 text-[11px] text-slate-400 font-medium">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading member details…
            </div>
          )}

          {/* ── Step 1: Carrier ─────────────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-black uppercase tracking-tight">Select Carrier</h2>
                <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mt-0.5">
                  Choose the insurance carrier for this VCC Form
                </p>
              </div>
              {carriers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border p-8 text-center">
                  <p className="text-[11px] font-black uppercase tracking-widest text-muted-foreground/60">
                    No carrier templates configured yet
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    Upload PDF templates in VCC Templates to enable form filling.
                  </p>
                  <Button asChild variant="outline" size="sm" className="mt-4 rounded-xl font-black uppercase text-[9px] tracking-widest">
                    <Link href="/dashboard/vcc/templates/upload">Upload Template</Link>
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {carriers.map(c => (
                    <button key={c.id} type="button"
                      onClick={() => { setForm(f => ({ ...f, carrier_id: c.id })); setErrors({}) }}
                      className={`p-4 rounded-2xl border text-left transition-all ${
                        form.carrier_id === c.id
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border hover:border-primary/40 hover:bg-muted/40'
                      }`}
                    >
                      <p className="font-black text-sm uppercase tracking-tight">{c.carrier_display_name}</p>
                      <p className="text-[9px] font-bold text-muted-foreground mt-0.5 uppercase">{c.year}</p>
                    </button>
                  ))}
                </div>
              )}
              <FieldError msg={errors.carrier_id} />
            </div>
          )}

          {/* ── Step 2: Client Info ──────────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
                  <User2 className="w-5 h-5 text-primary" /> Client Information
                </h2>
                <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mt-0.5">
                  {isTransitionNotice
                    ? 'Beneficiary details for the Insurance Transition Notice'
                    : 'Beneficiary details for the VCC form'}
                </p>
              </div>

              {/* Template context chip — shows which template path is active */}
              {isTransitionNotice ? (
                <div className="p-3 rounded-xl border border-blue-500/30 bg-blue-500/5 flex items-center gap-3">
                  <div className="w-4 h-4 rounded border-2 border-blue-500 bg-blue-500 flex items-center justify-center">
                    <CheckCircle2 className="w-3 h-3 text-white" />
                  </div>
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-blue-400">
                      Insurance Transition Notice
                    </p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">
                      Standard plan — notifying physician of insurance change
                    </p>
                  </div>
                </div>
              ) : (
                /* Chronic plan toggle — visible for standard VCC path only */
                <div className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  form.is_chronic ? 'border-amber-500/40 bg-amber-500/10' : 'border-border hover:border-amber-500/30'
                }`}
                  onClick={() => setForm(f => ({ ...f, is_chronic: !f.is_chronic }))}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                      form.is_chronic ? 'border-amber-500 bg-amber-500' : 'border-slate-600'
                    }`}>
                      {form.is_chronic && <CheckCircle2 className="w-3 h-3 text-white" />}
                    </div>
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-widest text-amber-400">Chronic Condition Plan (C-SNP)</p>
                      <p className="text-[9px] text-muted-foreground mt-0.5">Check if this is a Chronic Special Needs Plan — requires additional forms</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-widest">Client Full Name *</Label>
                  <Input value={form.client_name} onChange={set('client_name')} placeholder="Jane Smith" className="h-12 rounded-2xl" />
                  <FieldError msg={errors.client_name} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-black uppercase tracking-widest">Date of Birth</Label>
                    <Input type="date" value={form.client_dob} onChange={set('client_dob')} className="h-12 rounded-2xl" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[10px] font-black uppercase tracking-widest">Medicare ID (MBI)</Label>
                    <Input value={form.medicare_id} onChange={set('medicare_id')} placeholder="1EG4-TE5-MK72" className="h-12 rounded-2xl font-mono" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 3: Physician ────────────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-black uppercase tracking-tight flex items-center gap-2">
                  <Stethoscope className="w-5 h-5 text-primary" /> Physician Details
                </h2>
                <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mt-0.5">
                  Primary care doctor for VCC fax dispatch
                </p>
              </div>

              {prefilled && (form.doctor_name || form.doctor_fax) && (
                <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 flex items-center gap-2">
                  <Info className="w-4 h-4 text-emerald-400 shrink-0" />
                  <p className="text-[10px] text-emerald-400 font-bold">
                    Doctor info pre-filled from your client's GHL record. Edit below if needed.
                  </p>
                </div>
              )}

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-widest">Primary Doctor Name</Label>
                  <Input
                    value={form.doctor_name}
                    onChange={set('doctor_name')}
                    placeholder="Dr. John Doe"
                    className="h-12 rounded-2xl"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                    Doctor Fax Number
                    <Badge className="text-[7px] font-black bg-amber-500/10 text-amber-400 border-amber-500/20 border">
                      Required for auto-fax
                    </Badge>
                  </Label>
                  <div className="relative">
                    <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input
                      value={form.doctor_fax}
                      onChange={set('doctor_fax')}
                      placeholder="(555) 000-0000"
                      className="h-12 rounded-2xl pl-10"
                    />
                  </div>
                  <FieldError msg={errors.doctor_fax} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[10px] font-black uppercase tracking-widest">Broker NPN (optional)</Label>
                  <Input value={form.broker_npn} onChange={set('broker_npn')} placeholder="12345678" className="h-12 rounded-2xl font-mono" />
                </div>
              </div>

              {/* Dispatch choice embedded in physician step */}
              <div className="space-y-2 pt-2">
                <Label className="text-[10px] font-black uppercase tracking-widest">Delivery Method</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button"
                    onClick={() => setForm(f => ({ ...f, send_fax: true }))}
                    className={`p-3.5 rounded-2xl border text-left transition-all ${
                      form.send_fax ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40'
                    }`}
                  >
                    <p className="font-black text-xs">Auto-Fax Doctor</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">
                      {form.doctor_fax ? `Send to ${form.doctor_fax}` : 'Add fax number above'}
                    </p>
                  </button>
                  <button type="button"
                    onClick={() => setForm(f => ({ ...f, send_fax: false }))}
                    className={`p-3.5 rounded-2xl border text-left transition-all ${
                      !form.send_fax ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40'
                    }`}
                  >
                    <p className="font-black text-xs">Manual (Download PDF)</p>
                    <p className="text-[9px] text-muted-foreground mt-0.5">Save PDF to your secure storage</p>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Step 4: Review & Send ────────────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-black uppercase tracking-tight">Review & Submit</h2>
                <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest mt-0.5">
                  Confirm details before generating the VCC PDF
                </p>
              </div>
              <div className="rounded-2xl bg-muted/40 border border-border p-5 space-y-3">
                {[
                  ['Carrier',        selectedCarrier?.carrier_display_name ?? form.carrier_id],
                  ['Client Name',    form.client_name],
                  ['Date of Birth',  form.client_dob || '--'],
                  ['Medicare ID',    form.medicare_id ? '●●●● provided' : '--'],
                  ['Doctor',         form.doctor_name || '--'],
                  ['Doctor Fax',     form.doctor_fax || '--'],
                  ['C-SNP / Chronic', form.is_chronic ? 'Yes' : 'No'],
                  ['Delivery',       form.send_fax && form.doctor_fax ? `Fax → ${form.doctor_fax}` : 'Manual PDF download'],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-start justify-between gap-4">
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground shrink-0 w-32">{label}</span>
                    <span className={`text-[11px] font-bold text-right ${value === 'Yes' ? 'text-amber-400' : ''}`}>{value}</span>
                  </div>
                ))}
              </div>
              <div className="rounded-2xl bg-amber-500/5 border border-amber-500/20 p-4">
                <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400">
                  This submission creates a 60-day compliance deadline. The filled PDF will be generated and stored securely in your agency vault.
                </p>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between pt-2">
            {step > 1 ? (
              <Button variant="outline" onClick={back} className="rounded-2xl font-black uppercase text-[10px] tracking-widest h-11 px-5">
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
            ) : (
              <div />
            )}
            {step < 4 ? (
              <Button onClick={next} disabled={step === 1 && carriers.length === 0}
                className="rounded-2xl font-black uppercase text-[10px] tracking-widest h-11 px-5">
                Next <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={isPending}
                className="rounded-2xl font-black uppercase text-[10px] tracking-widest h-11 px-6 bg-emerald-600 hover:bg-emerald-700">
                {isPending ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                {isPending ? 'Submitting…' : 'Submit VCC Form'}
              </Button>
            )}
          </div>
        </Card>
      </main>
    </div>
  )
}
