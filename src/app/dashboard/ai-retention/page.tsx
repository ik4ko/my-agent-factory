"use client"

import { useState, useEffect, useTransition } from 'react'
import { CollectionSidebar } from '@/components/collection-sidebar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/hooks/use-toast'
import {
  Brain, Bot, PhoneCall, RefreshCw, ShieldAlert, CalendarDays,
  Copy, ExternalLink, CheckCircle, ShieldCheck, Loader2, FileText,
  Clock, Megaphone, Mail, MessageSquare, Send,
} from 'lucide-react'
import { generateRetentionScript, getAgencyContacts, type ScriptType } from '@/app/actions/generate-script'
import { createClient } from '@/lib/supabase/client'

// ─── Script Types ─────────────────────────────────────────────────────────────

const SCRIPT_TYPES = [
  { value: 'retention'     as ScriptType, label: 'Retention Outreach', description: 'Keep at-risk members enrolled', icon: <PhoneCall className="w-5 h-5" />, color: 'text-blue-500 bg-blue-500/10 border-blue-500/20' },
  { value: 'reactive_save' as ScriptType, label: 'Reactive Save',      description: 'Triggered by detected carrier switch', icon: <ShieldAlert className="w-5 h-5" />, color: 'text-red-500 bg-red-500/10 border-red-500/20' },
  { value: 'VCC_followup'  as ScriptType, label: 'VCC Follow-up',      description: 'Follow up on submitted plan-change form', icon: <FileText className="w-5 h-5" />, color: 'text-amber-500 bg-amber-500/10 border-amber-500/20' },
  { value: 'aep_reminder'  as ScriptType, label: 'AEP Reminder',       description: 'Annual Enrollment Period outreach', icon: <CalendarDays className="w-5 h-5" />, color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' },
]

function formatScript(raw: string) {
  return raw.split(/\n{2,}/).map((block, i) => {
    const isBold = /^\*\*/.test(block.trim())
    if (isBold) {
      const cleaned = block.replace(/\*\*/g, '')
      const [heading, ...body] = cleaned.split('\n')
      return (
        <div key={i} className="space-y-1.5">
          <p className="text-[10px] font-black uppercase tracking-widest text-primary">{heading}</p>
          {body.length > 0 && <p className="text-sm text-foreground leading-relaxed">{body.join(' ')}</p>}
        </div>
      )
    }
    return <p key={i} className="text-sm text-foreground leading-relaxed">{block}</p>
  })
}

// ─── Scripts Tab ──────────────────────────────────────────────────────────────

function ScriptsTab() {
  const [contacts, setContacts] = useState<Array<{ ghl_contact_id: string; enrollment_status: string | null; risk_level: string | null }>>([])
  const [selectedContact, setSelectedContact] = useState('')
  const [manualContactId, setManualContactId] = useState('')
  const [selectedType, setSelectedType] = useState<ScriptType>('retention')
  const [result, setResult] = useState<{ script: string; scriptType: ScriptType; generatedAt: string } | null>(null)
  const [history, setHistory] = useState<Array<{ script: string; scriptType: ScriptType; contactId: string; generatedAt: string }>>([])
  const [copied, setCopied] = useState(false)
  const [isPending, startTransition] = useTransition()
  const { toast } = useToast()

  useEffect(() => { getAgencyContacts().then(setContacts) }, [])

  const effectiveContactId = selectedContact || manualContactId

  function handleGenerate() {
    if (!effectiveContactId) {
      toast({ variant: 'destructive', title: 'No contact selected', description: 'Enter or select a GHL Contact ID.' })
      return
    }
    startTransition(async () => {
      const res = await generateRetentionScript({ ghlContactId: effectiveContactId, scriptType: selectedType })
      if (res.error) { toast({ variant: 'destructive', title: 'Generation Failed', description: res.error }); return }
      setResult(res)
      setHistory(prev => [{ script: res.script, scriptType: res.scriptType, contactId: effectiveContactId, generatedAt: res.generatedAt }, ...prev.slice(0, 4)])
    })
  }

  function handleCopy() {
    if (!result?.script) return
    navigator.clipboard.writeText(result.script)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    toast({ title: 'Copied', description: 'Script copied to clipboard.' })
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {SCRIPT_TYPES.map(type => (
          <button key={type.value} onClick={() => setSelectedType(type.value)}
            className={`p-4 rounded-2xl border text-left transition-all ${selectedType === type.value ? `${type.color} ring-2 ring-offset-1` : 'bg-card border-border hover:bg-muted/40'}`}>
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${selectedType === type.value ? type.color : 'bg-muted text-muted-foreground'}`}>
              {type.icon}
            </div>
            <p className="text-[11px] font-black uppercase tracking-widest">{type.label}</p>
            <p className="text-[9px] text-muted-foreground mt-0.5 font-medium">{type.description}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="rounded-3xl border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-black uppercase tracking-widest">Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {contacts.length > 0 && (
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Select from synced contacts</label>
                <Select value={selectedContact} onValueChange={setSelectedContact}>
                  <SelectTrigger className="rounded-2xl h-12 font-bold text-xs"><SelectValue placeholder="Choose a contact..." /></SelectTrigger>
                  <SelectContent>
                    {contacts.map(c => (
                      <SelectItem key={c.ghl_contact_id} value={c.ghl_contact_id}>
                        <span className="font-mono text-xs">{c.ghl_contact_id.slice(0, 16)}...</span>
                        {c.risk_level && <span className={`ml-2 text-[9px] font-black uppercase ${c.risk_level === 'high' ? 'text-red-500' : c.risk_level === 'medium' ? 'text-amber-500' : 'text-emerald-500'}`}>{c.risk_level}</span>}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[9px] text-muted-foreground font-black uppercase tracking-widest text-center">or enter manually</p>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">GHL Contact ID</label>
              <Input placeholder="GHL contact ID..." value={manualContactId} onChange={e => { setManualContactId(e.target.value); setSelectedContact('') }} className="rounded-2xl h-12 font-mono text-xs" />
            </div>
            <Button onClick={handleGenerate} disabled={isPending || !effectiveContactId}
              className="w-full h-12 rounded-2xl bg-primary text-white font-black uppercase tracking-widest text-[10px]">
              {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</> : <><Bot className="w-4 h-4 mr-2" /> Generate Script</>}
            </Button>
            {history.length > 0 && (
              <div className="pt-4 border-t border-border space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Recent</p>
                {history.map((h, i) => (
                  <button key={i} onClick={() => setResult({ script: h.script, scriptType: h.scriptType, generatedAt: h.generatedAt })}
                    className="w-full text-left p-2.5 rounded-xl hover:bg-muted/40 transition-colors">
                    <div className="flex items-center gap-2">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      <span className="text-[10px] font-black uppercase">{h.scriptType.replace('_', ' ')}</span>
                    </div>
                    <p className="text-[9px] text-muted-foreground mt-0.5 font-mono">{h.contactId.slice(0, 14)}...</p>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          {result ? (
            <Card className="rounded-3xl border-border h-full">
              <CardHeader className="pb-3 flex-row items-center justify-between">
                <div>
                  <Badge className="bg-primary/10 text-primary border-primary/20 font-black uppercase text-[9px] mb-2">{SCRIPT_TYPES.find(t => t.value === result.scriptType)?.label}</Badge>
                  <p className="text-[9px] text-muted-foreground font-black uppercase tracking-widest">Generated {new Date(result.generatedAt).toLocaleTimeString()}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={handleCopy} className="h-9 rounded-xl font-black uppercase text-[10px] gap-1.5">
                    {copied ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied!' : 'Copy'}
                  </Button>
                  {effectiveContactId && (
                    <Button size="sm" variant="outline" asChild className="h-9 rounded-xl font-black uppercase text-[10px] gap-1.5">
                      <a href={`https://app.gohighlevel.com/contacts/${effectiveContactId}`} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="w-3.5 h-3.5" /> GHL
                      </a>
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="bg-muted/20 rounded-2xl p-6 space-y-4 text-sm leading-relaxed">{formatScript(result.script)}</div>
              </CardContent>
            </Card>
          ) : (
            <div className="h-full min-h-[400px] rounded-3xl border border-dashed border-border flex items-center justify-center">
              <div className="text-center space-y-3">
                <div className="w-16 h-16 rounded-3xl bg-muted flex items-center justify-center mx-auto"><Bot className="w-8 h-8 text-muted-foreground" /></div>
                <p className="text-sm font-black uppercase tracking-widest text-muted-foreground">Select a script type and contact</p>
                <p className="text-[10px] text-muted-foreground">AI-generated * TPMO compliant * Under 300 words</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── AI Check-ins Tab ─────────────────────────────────────────────────────────

interface CheckIn {
  id: string
  client_name: string | null
  message_type: string
  channel: string
  scheduled_at: string | null
  status: string
  created_at: string
}

const MESSAGE_TYPES = [
  { value: 'plan_checkin',    label: 'Plan Check-in' },
  { value: 'ssbci_followup',  label: 'SSBCI Follow-up' },
  { value: 'general_retention', label: 'General Retention' },
  { value: 'aep_reminder',    label: 'AEP Reminder' },
]

function CheckInsTab() {
  const [contacts, setContacts] = useState<Array<{ ghl_contact_id: string; full_name?: string | null }>>([])
  const [selectedContact, setSelectedContact] = useState('all')
  const [messageType, setMessageType] = useState('plan_checkin')
  const [channel, setChannel] = useState('sms')
  const [scheduleMode, setScheduleMode] = useState<'now' | 'days' | 'date'>('now')
  const [daysDelay, setDaysDelay] = useState('3')
  const [scheduleDate, setScheduleDate] = useState('')
  const [sending, setSending] = useState(false)
  const [history, setHistory] = useState<CheckIn[]>([])
  const { toast } = useToast()

  useEffect(() => {
    getAgencyContacts().then(list => setContacts(list as any))
    const supabase = createClient()
    supabase.from('campaign_enrollments').select('id, enrolled_at, status, trigger_reason').order('enrolled_at', { ascending: false }).limit(20)
      .then(({ data }) => {
        if (data) setHistory(data.map((d: any) => ({
          id: d.id,
          client_name: null,
          message_type: d.trigger_reason ?? 'manual',
          channel: 'sms',
          scheduled_at: d.enrolled_at,
          status: d.status,
          created_at: d.enrolled_at,
        })))
      })
  }, [])

  const handleSchedule = async () => {
    setSending(true)
    try {
      let scheduledAt: string | null = null
      if (scheduleMode === 'days') {
        const d = new Date()
        d.setDate(d.getDate() + parseInt(daysDelay, 10))
        scheduledAt = d.toISOString()
      } else if (scheduleMode === 'date') {
        scheduledAt = new Date(scheduleDate).toISOString()
      }

      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data: broker } = await supabase.from('brokers').select('agency_id').eq('user_id', user.id).maybeSingle()

      const payload: any = {
        agency_id: broker?.agency_id ?? null,
        broker_id: user.id,
        trigger_reason: messageType,
        status: scheduledAt ? 'scheduled' : 'active',
        enrolled_at: scheduledAt ?? new Date().toISOString(),
      }
      if (selectedContact !== 'all') payload.contact_id = selectedContact

      await supabase.from('campaign_enrollments').insert(payload)

      toast({ title: 'Check-in scheduled', description: scheduledAt ? `Scheduled for ${new Date(scheduledAt).toLocaleDateString()}` : 'Check-in queued immediately.' })
      setSelectedContact('all')
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Failed', description: err.message })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-primary/5 border border-primary/15 p-5 text-[11px] text-muted-foreground leading-relaxed">
        Schedule AI-powered SMS or email check-ins for your clients. AegisSage monitors responses and flags clients who express concern about their coverage.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="rounded-3xl border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
              <Send className="w-4 h-4 text-primary" /> Schedule Check-in
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Client</Label>
              <Select value={selectedContact} onValueChange={setSelectedContact}>
                <SelectTrigger className="rounded-2xl h-11 font-bold text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All clients in agency</SelectItem>
                  {contacts.map(c => (
                    <SelectItem key={c.ghl_contact_id} value={c.ghl_contact_id}>
                      {(c as any).full_name || c.ghl_contact_id.slice(0, 16) + '...'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Message Type</Label>
              <Select value={messageType} onValueChange={setMessageType}>
                <SelectTrigger className="rounded-2xl h-11 font-bold text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MESSAGE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Channel</Label>
              <div className="flex gap-2">
                {[{ value: 'sms', label: 'SMS', icon: MessageSquare }, { value: 'email', label: 'Email', icon: Mail }].map(ch => (
                  <button key={ch.value} onClick={() => setChannel(ch.value)}
                    className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border text-[11px] font-black uppercase transition-all ${channel === ch.value ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40'}`}>
                    <ch.icon className="w-4 h-4" /> {ch.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Schedule</Label>
              <div className="space-y-2">
                {[
                  { value: 'now', label: 'Immediately' },
                  { value: 'days', label: `In ${daysDelay} day(s)` },
                  { value: 'date', label: 'On specific date' },
                ].map(opt => (
                  <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" value={opt.value} checked={scheduleMode === opt.value} onChange={() => setScheduleMode(opt.value as any)}
                      className="accent-primary" />
                    <span className="text-[11px] font-bold">{opt.label}</span>
                  </label>
                ))}
                {scheduleMode === 'days' && (
                  <Input type="number" min="1" max="90" value={daysDelay} onChange={e => setDaysDelay(e.target.value)}
                    className="h-10 rounded-xl w-24 text-sm font-bold" />
                )}
                {scheduleMode === 'date' && (
                  <Input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} className="h-10 rounded-xl font-bold" />
                )}
              </div>
            </div>

            <Button onClick={handleSchedule} disabled={sending}
              className="w-full h-12 rounded-2xl bg-primary text-white font-black uppercase tracking-widest text-[10px]">
              {sending ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Scheduling...</> : <><Send className="w-4 h-4 mr-2" /> Schedule Check-in</>}
            </Button>
          </CardContent>
        </Card>

        {/* History */}
        <div className="space-y-3">
          <h3 className="text-[11px] font-black uppercase tracking-widest text-muted-foreground px-1">Recent Check-ins</h3>
          {history.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center">
              <Megaphone className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/50">No check-ins yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map(h => (
                <div key={h.id} className="flex items-center justify-between p-3 rounded-xl border border-border bg-card hover:bg-muted/20 transition-colors">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest">{h.message_type.replace('_', ' ')}</p>
                    <p className="text-[9px] text-muted-foreground font-medium mt-0.5">{h.scheduled_at ? new Date(h.scheduled_at).toLocaleDateString() : '--'}</p>
                  </div>
                  <Badge className={`font-black uppercase text-[9px] px-2 h-5 border ${h.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : h.status === 'scheduled' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                    {h.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AIRetentionPage() {
  return (
    <div className="flex h-full w-full bg-background">
      <CollectionSidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="h-16 border-b border-border px-8 flex items-center justify-between bg-card/50 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <Brain className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-black text-foreground uppercase tracking-tight">AI Retention</h1>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Scripts + AI Check-ins</p>
            </div>
          </div>
          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 gap-1.5 px-3 h-8 font-black uppercase text-[10px]">
            <ShieldCheck className="w-3 h-3" /> TPMO Compliant
          </Badge>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          <Tabs defaultValue="scripts">
            <TabsList className="mb-6 rounded-2xl">
              <TabsTrigger value="scripts" className="rounded-xl font-black uppercase text-[10px] tracking-widest gap-2">
                <Bot className="w-4 h-4" /> Retention Scripts
              </TabsTrigger>
              <TabsTrigger value="checkins" className="rounded-xl font-black uppercase text-[10px] tracking-widest gap-2">
                <Megaphone className="w-4 h-4" /> AI Check-ins
              </TabsTrigger>
            </TabsList>
            <TabsContent value="scripts"><ScriptsTab /></TabsContent>
            <TabsContent value="checkins"><CheckInsTab /></TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
