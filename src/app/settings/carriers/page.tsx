'use client'

import { useEffect, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  CheckCircle2, Circle, RefreshCw, Plus, Pencil, Trash2,
  Shield, Eye, EyeOff, AlertTriangle, Lock, Play,
  FlaskConical, ExternalLink, XCircle,
} from 'lucide-react'
import { getCarrierCredentials, saveCarrierCredential, removeCarrierCredential } from '@/app/actions/carriers'
import type { CarrierCredential } from '@/app/actions/carriers'

const SUPPORTED_CARRIERS = [
  { id: 'humana',   label: 'Humana',    url: 'humana.com/producer',     color: 'bg-green-500/10 text-green-600' },
  { id: 'uhc',      label: 'UHC',       url: 'uhcprovider.com/producer', color: 'bg-blue-500/10 text-blue-600' },
  { id: 'aetna',    label: 'Aetna',     url: 'aetna.com/producer',      color: 'bg-red-500/10 text-red-600' },
  { id: 'bcbs',     label: 'BCBS',      url: 'bcbs.com/producer',       color: 'bg-sky-500/10 text-sky-600' },
  { id: 'wellcare', label: 'Wellcare',  url: 'wellcare.com/producer',   color: 'bg-purple-500/10 text-purple-600' },
] as const

type CarrierId = typeof SUPPORTED_CARRIERS[number]['id']

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
]

type RunResult = {
  status?: string
  matched?: number
  missing?: number
  new?: number
  alertCount?: number
  error?: string
}

type TestResult = {
  success: boolean
  screenshot_url?: string | null
  page_title?: string
  current_url?: string
  error?: string
}

function fmtAgo(ts: string | null) {
  if (!ts) return 'Never'
  const diff = Date.now() - new Date(ts).getTime()
  const h = Math.floor(diff / 3_600_000)
  if (h < 1) return 'Just now'
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export default function CarrierPortalsPage() {
  const [credentials, setCredentials] = useState<CarrierCredential[]>([])
  const [loadingCreds, setLoadingCreds] = useState(true)
  const [open, setOpen] = useState(false)
  const [editCarrier, setEditCarrier] = useState<CarrierId | ''>('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [bcbsState, setBcbsState] = useState('')
  const [authorized, setAuthorized] = useState(false)
  const [formError, setFormError] = useState('')
  const [saving, startSave] = useTransition()
  const [removing, setRemoving] = useState<string | null>(null)

  // Detection state
  const [runningCarrier, setRunningCarrier] = useState<string | null>(null)
  const [testingCarrier, setTestingCarrier] = useState<string | null>(null)
  const [runResults, setRunResults] = useState<Record<string, RunResult>>({})
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({})
  const [runningAll, setRunningAll] = useState(false)

  async function loadCreds() {
    setLoadingCreds(true)
    const data = await getCarrierCredentials()
    setCredentials(data)
    setLoadingCreds(false)
  }

  useEffect(() => { loadCreds() }, [])

  function openModal(carrierId: CarrierId) {
    const existing = credentials.find(c => c.carrier === carrierId || c.carrier === `${carrierId}_${bcbsState}`)
    setEditCarrier(carrierId)
    setUsername(existing?.username ?? '')
    setPassword('')
    setShowPw(false)
    setAuthorized(false)
    setFormError('')
    setBcbsState('')
    setOpen(true)
  }

  function handleSave() {
    setFormError('')
    const finalCarrier = editCarrier === 'bcbs' && bcbsState ? `bcbs_${bcbsState.toLowerCase()}` : editCarrier
    if (!finalCarrier) { setFormError('Select a carrier'); return }
    if (!username.trim()) { setFormError('Username is required'); return }
    if (!password.trim()) { setFormError('Password is required'); return }
    if (!authorized) { setFormError('You must authorize AegisSage to access this portal'); return }

    startSave(async () => {
      const fd = new FormData()
      fd.set('carrier', finalCarrier)
      fd.set('username', username)
      fd.set('password', password)
      fd.set('authorized', 'true')
      const result = await saveCarrierCredential(fd)
      if (result.error) { setFormError(result.error); return }
      setOpen(false)
      loadCreds()
    })
  }

  async function handleRemove(id: string) {
    setRemoving(id)
    await removeCarrierCredential(id)
    setRemoving(null)
    loadCreds()
  }

  async function handleRunDetection(carrierId: string) {
    setRunningCarrier(carrierId)
    setRunResults(prev => ({ ...prev, [carrierId]: {} }))
    try {
      const res = await fetch('/api/detection/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrierId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setRunResults(prev => ({ ...prev, [carrierId]: { error: data.error ?? 'Request failed' } }))
        return
      }
      // Find this carrier's result in the results array
      const result: RunResult = data.results?.find(
        (r: { carrier: string }) => r.carrier === carrierId || r.carrier?.startsWith(`${carrierId}_`)
      ) ?? { error: data.message ?? 'No result returned' }
      setRunResults(prev => ({ ...prev, [carrierId]: result }))
    } catch (e: any) {
      setRunResults(prev => ({ ...prev, [carrierId]: { error: e?.message ?? 'Network error' } }))
    } finally {
      setRunningCarrier(null)
      loadCreds()
    }
  }

  async function handleRunAll() {
    setRunningAll(true)
    setRunResults({})
    try {
      const res = await fetch('/api/detection/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) return
      const newResults: Record<string, RunResult> = {}
      for (const r of data.results ?? []) {
        const base = (r.carrier as string)?.split('_')[0] ?? r.carrier
        newResults[base] = r
      }
      setRunResults(newResults)
    } catch {
      // silent
    } finally {
      setRunningAll(false)
      loadCreds()
    }
  }

  async function handleTestLogin(carrierId: string) {
    setTestingCarrier(carrierId)
    setTestResults(prev => ({ ...prev, [carrierId]: { success: false } }))
    try {
      const res = await fetch('/api/detection/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carrier: carrierId }),
      })
      const data: TestResult = await res.json()
      setTestResults(prev => ({ ...prev, [carrierId]: data }))
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, [carrierId]: { success: false, error: e?.message ?? 'Network error' } }))
    } finally {
      setTestingCarrier(null)
    }
  }

  const connectedCount = SUPPORTED_CARRIERS.filter(c =>
    credentials.some(cr => cr.carrier === c.id || cr.carrier.startsWith(`${c.id}_`))
  ).length

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <header className="h-16 border-b border-border px-8 flex items-center justify-between bg-card/50 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Shield className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-black text-foreground uppercase tracking-tight">Carrier Portal Access</h1>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
              {connectedCount} of {SUPPORTED_CARRIERS.length} carriers connected · Auto-check every 72h
            </p>
          </div>
        </div>
        {connectedCount > 0 && (
          <Button
            onClick={handleRunAll}
            disabled={runningAll || runningCarrier !== null}
            size="sm"
            className="rounded-xl font-black uppercase text-[9px] tracking-widest h-8 px-4 gap-1.5"
          >
            {runningAll
              ? <><RefreshCw className="w-3 h-3 animate-spin" /> Checking All Carriers...</>
              : <><Play className="w-3 h-3" /> Run All Carriers</>
            }
          </Button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-8 max-w-3xl mx-auto w-full space-y-6 pb-32">
        {/* Description */}
        <div className="p-4 rounded-2xl bg-primary/5 border border-primary/15">
          <p className="text-[11px] font-medium text-muted-foreground leading-relaxed">
            AegisSage monitors your carrier portals automatically every 72 hours to detect plan switches.
            Your credentials are encrypted with AES-256-GCM and never shared or transmitted in plaintext.
            Use <strong>Test Login</strong> to verify a connection works before waiting for the next automated check.
            You can revoke access at any time by clicking Remove.
          </p>
        </div>

        {/* Carrier Cards */}
        {loadingCreds ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3">
            {SUPPORTED_CARRIERS.map(carrier => {
              const cred = credentials.find(c =>
                c.carrier === carrier.id || c.carrier.startsWith(`${carrier.id}_`)
              )
              const isConnected = !!cred
              const statusCls = cred?.status === 'login_failed'
                ? 'bg-red-500/10 text-red-500 border-red-500/20'
                : cred?.status === 'mfa_required'
                  ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                  : isConnected
                    ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                    : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
              const statusLabel = cred?.status === 'login_failed'
                ? 'Login Failed'
                : cred?.status === 'mfa_required'
                  ? 'MFA Required'
                  : isConnected
                    ? 'Connected'
                    : 'Not Connected'

              const isRunning = runningCarrier === carrier.id
              const isTesting = testingCarrier === carrier.id
              const runResult = runResults[carrier.id]
              const testResult = testResults[carrier.id]

              return (
                <Card key={carrier.id} className="rounded-2xl border border-border bg-card shadow-sm">
                  <CardContent className="p-5 space-y-3">
                    <div className="flex items-center gap-5">
                      <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 font-black text-sm ${carrier.color}`}>
                        {carrier.label.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-black uppercase tracking-tight">{carrier.label}</p>
                          <Badge className={`font-black uppercase text-[8px] px-2 h-4 border ${statusCls}`}>
                            {isConnected ? <CheckCircle2 className="w-2.5 h-2.5 mr-1" /> : <Circle className="w-2.5 h-2.5 mr-1" />}
                            {statusLabel}
                          </Badge>
                          {cred?.status === 'mfa_required' && (
                            <a href={`/settings/carriers/verify/${cred.carrier}`}
                              className="text-[9px] font-black uppercase tracking-widest text-amber-500 hover:underline">
                              Verify →
                            </a>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground font-medium">{carrier.url}</p>
                        {cred && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            <span className="opacity-60">Last checked:</span>{' '}
                            <span className="font-bold">{fmtAgo(cred.last_checked_at)}</span>
                            {cred.last_checked_at && (
                              <span className="opacity-40 ml-2">
                                · {new Date(cred.last_checked_at).toLocaleDateString()}
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                        {cred?.status === 'login_failed' && (
                          <AlertTriangle className="w-4 h-4 text-red-500" />
                        )}
                        {isConnected && (
                          <Button
                            onClick={() => handleTestLogin(carrier.id)}
                            disabled={isTesting || isRunning || runningAll}
                            variant="outline"
                            size="sm"
                            className="rounded-xl font-black uppercase text-[9px] tracking-widest h-8 px-3 gap-1.5 border-blue-500/30 text-blue-500 hover:bg-blue-500/10 hover:text-blue-500"
                          >
                            {isTesting
                              ? <><RefreshCw className="w-3 h-3 animate-spin" /> Testing...</>
                              : <><FlaskConical className="w-3 h-3" /> Test Login</>
                            }
                          </Button>
                        )}
                        {isConnected && (
                          <Button
                            onClick={() => handleRunDetection(carrier.id)}
                            disabled={isRunning || isTesting || runningAll}
                            variant="outline"
                            size="sm"
                            className="rounded-xl font-black uppercase text-[9px] tracking-widest h-8 px-3 gap-1.5 border-primary/30 text-primary hover:bg-primary/10"
                          >
                            {isRunning
                              ? <><RefreshCw className="w-3 h-3 animate-spin" /> Checking {carrier.label}...</>
                              : <><Play className="w-3 h-3" /> Run Now</>
                            }
                          </Button>
                        )}
                        <Button
                          onClick={() => openModal(carrier.id)}
                          variant="outline"
                          size="sm"
                          className="rounded-xl font-black uppercase text-[9px] tracking-widest h-8 px-3 gap-1.5"
                        >
                          {isConnected ? <><Pencil className="w-3 h-3" /> Update</> : <><Plus className="w-3 h-3" /> Add</>}
                        </Button>
                        {cred && (
                          <Button
                            onClick={() => handleRemove(cred.id)}
                            variant="ghost"
                            size="sm"
                            disabled={removing === cred.id}
                            className="rounded-xl font-black uppercase text-[9px] tracking-widest h-8 px-3 text-red-500 hover:bg-red-500/10 hover:text-red-500"
                          >
                            {removing === cred.id
                              ? <RefreshCw className="w-3 h-3 animate-spin" />
                              : <Trash2 className="w-3 h-3" />}
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Run detection result */}
                    {runResult && Object.keys(runResult).length > 0 && (
                      <div className={`px-4 py-2.5 rounded-xl text-[10px] font-bold flex items-center gap-2 ${
                        runResult.error
                          ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                          : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                      }`}>
                        {runResult.error
                          ? <><XCircle className="w-3.5 h-3.5 shrink-0" /> {runResult.error}</>
                          : (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              <span>
                                Found <strong>{runResult.matched ?? 0}</strong> members
                                {(runResult.missing ?? 0) > 0 && <> · <span className="text-red-400"><strong>{runResult.missing}</strong> missing since last check</span></>}
                                {(runResult.new ?? 0) > 0 && <> · <strong>{runResult.new}</strong> new</>}
                                {(runResult.alertCount ?? 0) > 0 && <> · <strong>{runResult.alertCount}</strong> alerts created</>}
                              </span>
                            </>
                          )
                        }
                      </div>
                    )}

                    {/* Test login result */}
                    {testResult && (
                      <div className={`px-4 py-2.5 rounded-xl text-[10px] font-bold space-y-1.5 ${
                        testResult.error || !testResult.success
                          ? 'bg-red-500/10 border border-red-500/20'
                          : 'bg-emerald-500/10 border border-emerald-500/20'
                      }`}>
                        <div className={`flex items-center gap-2 ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                          {testResult.success
                            ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            : <XCircle className="w-3.5 h-3.5 shrink-0" />
                          }
                          {testResult.success ? 'Login successful' : (testResult.error ?? 'Login failed')}
                        </div>
                        {testResult.current_url && (
                          <p className="text-muted-foreground uppercase tracking-widest text-[9px] truncate">
                            Landed: {testResult.current_url}
                          </p>
                        )}
                        {testResult.screenshot_url && (
                          <a
                            href={testResult.screenshot_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 uppercase tracking-widest text-[9px]"
                          >
                            <ExternalLink className="w-3 h-3" /> View Screenshot
                          </a>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

        {/* Encryption notice */}
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-muted/20 border border-border">
          <Lock className="w-4 h-4 text-primary shrink-0" />
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
            All credentials encrypted at rest with AES-256-GCM. Passwords are never retrievable after saving.
            Read our{' '}
            <a href="/terms#carrier-authorization" className="text-primary hover:underline">authorization terms</a>.
          </p>
        </div>
      </div>

      {/* Add/Update Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-3xl max-w-md bg-card border border-border">
          <DialogHeader>
            <DialogTitle className="text-lg font-black uppercase tracking-tight">
              {editCarrier ? `${SUPPORTED_CARRIERS.find(c => c.id === editCarrier)?.label ?? ''} Credentials` : 'Add Carrier'}
            </DialogTitle>
            <DialogDescription className="text-[11px] font-medium text-muted-foreground">
              Your credentials are encrypted immediately and never stored in plaintext.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 pt-2">
            {/* BCBS state selector */}
            {editCarrier === 'bcbs' && (
              <div className="space-y-1.5">
                <Label className="text-[10px] font-black uppercase tracking-widest">State</Label>
                <Select value={bcbsState} onValueChange={setBcbsState}>
                  <SelectTrigger className="rounded-xl h-11 font-bold text-sm">
                    <SelectValue placeholder="Select state..." />
                  </SelectTrigger>
                  <SelectContent>
                    {US_STATES.map(s => (
                      <SelectItem key={s} value={s} className="font-bold">{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="cred-username" className="text-[10px] font-black uppercase tracking-widest">
                Username / Email
              </Label>
              <Input
                id="cred-username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="your@email.com"
                className="rounded-xl h-11 font-medium text-sm"
                autoComplete="off"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cred-password" className="text-[10px] font-black uppercase tracking-widest">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="cred-password"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="rounded-xl h-11 font-medium text-sm pr-10"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest opacity-60">
                Never shown again after saving
              </p>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-2xl bg-muted/30 border border-border">
              <Checkbox
                id="authorize"
                checked={authorized}
                onCheckedChange={v => setAuthorized(!!v)}
                className="mt-0.5 shrink-0"
              />
              <Label htmlFor="authorize" className="text-[11px] font-medium text-muted-foreground leading-relaxed cursor-pointer">
                I authorize AegisSage to access this carrier portal on my behalf to retrieve my active
                member roster for retention monitoring purposes.
              </Label>
            </div>

            {formError && (
              <p className="text-[11px] font-black text-red-500 uppercase tracking-widest">{formError}</p>
            )}

            <Button
              onClick={handleSave}
              disabled={saving}
              className="w-full rounded-xl font-black uppercase text-[10px] tracking-widest h-11 gap-2"
            >
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
              Save Securely
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
