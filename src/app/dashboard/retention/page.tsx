'use client'

import { useEffect, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRole } from '@/hooks/useRole'
import { cn } from '@/lib/utils'
import { assignBrokerToContact } from '@/app/actions/assign_broker'
import { CollectionSidebar } from '@/components/collection-sidebar'

type SignatureMethod = 'email_link' | 'sms_link' | 'manual_upload' | 'in_person'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Separator } from '@/components/ui/separator'
import Link from 'next/link'
import { Activity, RefreshCw, UserCheck, AlertTriangle, Lock, Shield, Mail, MessageSquare, Upload, Users, Download, ExternalLink } from 'lucide-react'
import { toast } from '@/hooks/use-toast'

interface Contact {
  id: string
  ghl_contact_id: string
  full_name: string | null
  email: string | null
  phone: string | null
  risk_level: string
  risk_score: number
  current_plan_id: string | null
  enrollment_status: string | null
  assigned_broker_id: string | null
  last_checked_at: string
  aor_status: 'none' | 'pending' | 'locked' | 'expired' | null
}

interface Broker {
  user_id: string
  first_name: string
  last_name: string
}

const RISK_COLORS: Record<string, string> = {
  critical: 'bg-destructive text-destructive-foreground',
  high:     'bg-amber-500 text-white',
  medium:   'bg-yellow-500/20 text-yellow-700 border-yellow-500/30',
  low:      'bg-emerald-500/10 text-emerald-700 border-emerald-500/30',
}

const AOR_CONFIG: Record<string, { label: string; cls: string }> = {
  none:    { label: 'Unlocked',          cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  pending: { label: 'Sig. Pending',      cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  locked:  { label: '[locked] Locked',         cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  expired: { label: 'Expired',           cls: 'bg-red-50 text-red-600 border-red-200' },
}

const CARRIERS = [
  'Humana', 'United Healthcare', 'Aetna', 'Blue Cross Blue Shield',
  'Wellcare', 'Cigna', 'Centene', 'Molina', 'Anthem', 'Other',
]

export default function RetentionPage() {
  const { isPrincipal, isStaff, isBroker, agencyId, loading: roleLoading } = useRole()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [brokers, setBrokers] = useState<Broker[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  // AOR modal state
  const [lockContact, setLockContact] = useState<Contact | null>(null)
  const [lockForm, setLockForm] = useState({
    carrier: '', carrierFax: '', medicareId: '',
    signatureMethod: '' as SignatureMethod | '',
  })
  const [lockDownloadUrl, setLockDownloadUrl] = useState<string | null>(null)
  const [lockSubmissionId, setLockSubmissionId] = useState<string | null>(null)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [lockPending, startLockTransition] = useTransition()

  const closeModal = () => {
    setLockContact(null)
    setLockForm({ carrier: '', carrierFax: '', medicareId: '', signatureMethod: '' })
    setLockDownloadUrl(null)
    setLockSubmissionId(null)
    setUploadFile(null)
  }

  useEffect(() => {
    if (roleLoading || !agencyId) return
    let mounted = true

    const load = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !mounted) return

      let query = supabase
        .from('ghl_contacts')
        .select('id, ghl_contact_id, full_name, email, phone, risk_level, risk_score, current_plan_id, enrollment_status, assigned_broker_id, last_checked_at, aor_status')
        .eq('agency_id', agencyId)
        .order('risk_score', { ascending: false })
        .limit(200)

      if (!isStaff) {
        query = query.eq('assigned_broker_id', user.id)
      }

      const [{ data: contactData }, brokerResult] = await Promise.all([
        query,
        isStaff
          ? supabase.from('brokers').select('user_id, first_name, last_name').eq('agency_id', agencyId).eq('role', 'broker')
          : Promise.resolve({ data: null }),
      ])

      if (mounted) {
        setContacts((contactData ?? []) as Contact[])
        if (isStaff) setBrokers((brokerResult as any)?.data ?? [])
        setDataLoading(false)
      }
    }

    load()
    return () => { mounted = false }
  }, [roleLoading, agencyId, isStaff])

  const handleAssign = (contactId: string, brokerUserId: string) => {
    startTransition(async () => {
      const value = brokerUserId === '__unassign__' ? null : brokerUserId
      const result = await assignBrokerToContact(contactId, value)
      if (result.error) {
        toast({ title: 'Assignment failed', description: result.error, variant: 'destructive' })
      } else {
        setContacts(prev => prev.map(c => c.id === contactId ? { ...c, assigned_broker_id: value } : c))
        toast({ title: 'Assigned', description: value ? 'Broker assigned.' : 'Broker unassigned.' })
      }
    })
  }

  const handleRequestLock = () => {
    if (!lockContact || !lockForm.carrier || !lockForm.signatureMethod) {
      toast({ variant: 'destructive', title: 'Incomplete', description: 'Select a carrier and signature method.' })
      return
    }
    startLockTransition(async () => {
      toast({ variant: 'destructive', title: 'AOR Not Available', description: 'AOR submission is not yet available in this version.' })
    })
  }

  const handleUploadSigned = () => {
    if (!lockSubmissionId || !uploadFile) return
    startLockTransition(async () => {
      toast({ variant: 'destructive', title: 'AOR Not Available', description: 'AOR submission is not yet available in this version.' })
    })
  }

  const brokerName = (userId: string | null) => {
    if (!userId) return null
    const b = brokers.find(x => x.user_id === userId)
    return b ? `${b.first_name} ${b.last_name}` : 'Unknown'
  }

  const loading = roleLoading || dataLoading

  return (
    <div className="flex h-full w-full bg-background">
      <CollectionSidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <header className="h-16 border-b border-border px-8 flex items-center justify-between bg-white/50 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-black text-foreground uppercase tracking-tight">
                {isStaff ? 'All Clients' : 'My Book'}
              </h1>
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                {isStaff ? 'All Agency Contacts' : 'Your Assigned Contacts'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {loading && <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />}
            <Badge variant="outline" className="font-black text-[9px] uppercase">{contacts.length} contacts</Badge>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto w-full space-y-8 pb-32">
          {/* Risk Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {(['critical', 'high', 'medium', 'low'] as const).map(level => {
              const count = contacts.filter(c => c.risk_level === level).length
              return (
                <Card key={level} className="rounded-3xl border-none p-5 bg-muted/30">
                  <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{level} risk</p>
                  <p className="text-3xl font-black mt-1">{count}</p>
                </Card>
              )
            })}
          </div>

          <Separator className="opacity-50" />

          {/* Contacts Table */}
          <Card className="rounded-3xl border border-border shadow-sm overflow-hidden">
            <CardHeader className="bg-muted/30 border-b">
              <CardTitle className="text-sm font-black uppercase tracking-tight flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive" />
                {isBroker ? 'My Assigned Contacts' : 'All Contacts'}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="py-16 flex items-center justify-center">
                  <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : contacts.length === 0 ? (
                <div className="py-16 text-center space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground opacity-40">
                    {isBroker ? 'No clients assigned yet.' : 'No contacts found.'}
                  </p>
                  {isBroker && (
                    <p className="text-[10px] font-medium text-muted-foreground opacity-40">
                      Contact your agency manager to get clients assigned.
                    </p>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-none hover:bg-transparent bg-transparent">
                        {['Contact', 'Risk', 'Score', 'Plan', 'Status', 'Last Checked', 'Aegis Lock', ...(isStaff ? ['Assigned Broker'] : [])].map(h => (
                          <TableHead key={h} className="font-black uppercase tracking-widest text-[9px] py-4 px-4 text-muted-foreground">{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contacts.map(contact => {
                        const aorStatus = contact.aor_status ?? 'none'
                        const aorCfg = AOR_CONFIG[aorStatus] ?? AOR_CONFIG.none
                        return (
                          <TableRow key={contact.id} className="border-border/50 hover:bg-muted/20">
                            <TableCell className="px-4 py-3">
                              <Link
                                href={`/dashboard/clients/${contact.ghl_contact_id}`}
                                className="group flex items-start gap-1.5 hover:text-primary transition-colors"
                              >
                                <div>
                                  <div className="font-bold text-sm group-hover:underline underline-offset-2">
                                    {contact.full_name ?? '--'}
                                  </div>
                                  <div className="font-mono text-[9px] text-muted-foreground flex items-center gap-1">
                                    {contact.ghl_contact_id.slice(0, 10)}...
                                    <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                                  </div>
                                </div>
                              </Link>
                            </TableCell>
                            <TableCell>
                              <Badge className={`text-[8px] font-black uppercase px-2 ${RISK_COLORS[contact.risk_level] ?? ''}`}>
                                {contact.risk_level}
                              </Badge>
                            </TableCell>
                            <TableCell className="px-4 text-xs font-black">{contact.risk_score}</TableCell>
                            <TableCell className="px-4 text-[10px] font-bold text-muted-foreground">{contact.current_plan_id ?? '--'}</TableCell>
                            <TableCell className="px-4 text-[10px] font-bold text-muted-foreground uppercase">{contact.enrollment_status ?? '--'}</TableCell>
                            <TableCell className="px-4 text-[10px] font-mono text-muted-foreground">
                              {new Date(contact.last_checked_at).toLocaleDateString()}
                            </TableCell>
                            <TableCell className="px-4">
                              {aorStatus === 'none' || aorStatus === 'expired' ? (
                                <Button
                                  size="sm" variant="outline" disabled={isPending}
                                  className="h-7 rounded-xl font-black uppercase text-[9px] tracking-widest gap-1 border-primary/30 text-primary hover:bg-primary/10"
                                  onClick={() => { setLockContact(contact); setLockForm({ carrier: '', carrierFax: '', medicareId: '', signatureMethod: '' as SignatureMethod | '' }) }}
                                >
                                  <Shield className="w-3 h-3" /> Request Lock
                                </Button>
                              ) : (
                                <Badge className={`font-black uppercase text-[9px] px-2 h-5 border ${aorCfg.cls}`}>
                                  {aorCfg.label}
                                </Badge>
                              )}
                            </TableCell>
                            {isStaff && (
                              <TableCell className="min-w-[160px]">
                                <Select
                                  value={contact.assigned_broker_id ?? '__unassign__'}
                                  onValueChange={val => handleAssign(contact.id, val)}
                                  disabled={isPending}
                                >
                                  <SelectTrigger className="h-7 rounded-xl text-[10px] font-bold border-border w-full">
                                    <SelectValue>
                                      <span className="flex items-center gap-1.5">
                                        <UserCheck className="w-3 h-3" />
                                        {contact.assigned_broker_id ? brokerName(contact.assigned_broker_id) : 'Unassigned'}
                                      </span>
                                    </SelectValue>
                                  </SelectTrigger>
                                  <SelectContent className="rounded-xl">
                                    <SelectItem value="__unassign__" className="text-[10px] font-bold">Unassigned</SelectItem>
                                    {brokers.map(b => (
                                      <SelectItem key={b.user_id} value={b.user_id} className="text-[10px] font-bold">
                                        {b.first_name} {b.last_name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                            )}
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
      </div>

      {/* Request Lock Modal */}
      <Dialog open={!!lockContact} onOpenChange={open => { if (!open) closeModal() }}>
        <DialogContent className="rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle className="font-black uppercase tracking-tight flex items-center gap-2">
              <Lock className="w-5 h-5 text-primary" /> Request Aegis Lock
            </DialogTitle>
            <DialogDescription className="text-[11px] font-medium">
              CMS-1696 AOR for <strong>{lockContact?.full_name ?? 'client'}</strong>
            </DialogDescription>
          </DialogHeader>

          {lockDownloadUrl ? (
            /* -- Download / Upload Phase -- */
            <div className="space-y-4 pt-2">
              <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">AOR Created</p>
                <p className="text-[10px] font-medium text-emerald-600 mt-1">
                  Download the pre-filled CMS-1696, collect the signature, then upload the signed copy below.
                </p>
              </div>
              <a href={lockDownloadUrl} target="_blank" rel="noopener noreferrer" className="block">
                <Button variant="outline" className="w-full rounded-2xl font-black uppercase text-[10px] gap-2 border-primary/30 text-primary hover:bg-primary/5">
                  <Download className="w-4 h-4" /> Download Pre-filled CMS-1696
                </Button>
              </a>
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest">Upload Signed Copy</Label>
                <Input type="file" accept=".pdf" className="h-11 rounded-2xl cursor-pointer"
                  onChange={e => setUploadFile(e.target.files?.[0] ?? null)} />
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1 rounded-2xl font-black uppercase text-[10px]"
                  onClick={closeModal} disabled={lockPending}>
                  Close
                </Button>
                <Button className="flex-1 rounded-2xl font-black uppercase text-[10px] bg-emerald-600 gap-2"
                  onClick={handleUploadSigned} disabled={lockPending || !uploadFile}>
                  {lockPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                  {lockPending ? 'Uploading...' : 'Submit Signed Copy'}
                </Button>
              </div>
            </div>
          ) : (
            /* -- Form Phase -- */
            <div className="space-y-4 pt-2">
              {/* Signature Method Selector */}
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest">Signature Method *</Label>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { value: 'email_link',     icon: Mail,           label: 'Email Link',   desc: 'Secure link to email' },
                    { value: 'sms_link',       icon: MessageSquare,  label: 'SMS Link',     desc: 'Via GHL SMS' },
                    { value: 'manual_upload',  icon: Upload,         label: "I'll Upload",  desc: 'Collect & upload sig' },
                    { value: 'in_person',      icon: Users,          label: 'In Person',    desc: 'Sign on device' },
                  ] as const).map(({ value, icon: Icon, label, desc }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setLockForm(f => ({ ...f, signatureMethod: value }))}
                      className={cn(
                        'flex flex-col items-start p-3 rounded-2xl border text-left transition-all',
                        lockForm.signatureMethod === value
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border hover:border-primary/40 hover:bg-muted/40 text-foreground'
                      )}
                    >
                      <Icon className="w-4 h-4 mb-1" />
                      <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
                      <span className="text-[9px] text-muted-foreground font-medium">{desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest">Carrier *</Label>
                <Select value={lockForm.carrier} onValueChange={v => setLockForm(f => ({ ...f, carrier: v }))}>
                  <SelectTrigger className="h-11 rounded-2xl">
                    <SelectValue placeholder="Select carrier..." />
                  </SelectTrigger>
                  <SelectContent className="rounded-2xl">
                    {CARRIERS.map(c => (
                      <SelectItem key={c} value={c} className="text-[11px] font-bold">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest">Carrier Fax (optional)</Label>
                <Input value={lockForm.carrierFax} onChange={e => setLockForm(f => ({ ...f, carrierFax: e.target.value }))}
                  placeholder="(800) 555-0100" className="h-11 rounded-2xl" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest">Medicare ID (optional)</Label>
                <Input value={lockForm.medicareId} onChange={e => setLockForm(f => ({ ...f, medicareId: e.target.value }))}
                  placeholder="1EG4-TE5-MK72" className="h-11 rounded-2xl" />
                <p className="text-[9px] text-muted-foreground font-medium">Stored as SHA-256 hash only -- never raw</p>
              </div>

              {lockForm.signatureMethod && (
                <div className="rounded-2xl bg-primary/5 border border-primary/15 px-4 py-3">
                  <p className="text-[10px] font-medium text-muted-foreground">
                    {lockForm.signatureMethod === 'email_link' && <>A signing link will be sent to <strong className="text-foreground">{lockContact?.email ?? 'client email'}</strong>. Expires in 72 hrs.</>}
                    {lockForm.signatureMethod === 'sms_link' && <>A signing link will be sent via SMS to <strong className="text-foreground">{lockContact?.phone ?? 'client phone'}</strong>.</>}
                    {lockForm.signatureMethod === 'manual_upload' && <>You'll download the pre-filled CMS-1696, collect the client's signature, and upload the signed copy.</>}
                    {lockForm.signatureMethod === 'in_person' && <>Download a pre-filled form for the client to sign in person. You'll upload the completed copy.</>}
                  </p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1 rounded-2xl font-black uppercase text-[10px]"
                  onClick={closeModal} disabled={lockPending}>
                  Cancel
                </Button>
                <Button className="flex-1 rounded-2xl font-black uppercase text-[10px] bg-primary gap-2"
                  onClick={handleRequestLock}
                  disabled={lockPending || !lockForm.carrier || !lockForm.signatureMethod}>
                  {lockPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                  {lockPending ? 'Processing...' : (
                    lockForm.signatureMethod === 'manual_upload' || lockForm.signatureMethod === 'in_person'
                      ? 'Generate Form'
                      : 'Send Link'
                  )}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

