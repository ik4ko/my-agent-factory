'use client'

/**
 * ScriptsWorkspace — Pillar 3 · Maya AI Outreach
 *
 * Client component rendered by /dashboard/scripts/page.tsx.
 *
 * Responsibilities:
 *   - Display all switch_alerts in 'mitigating' | 'contacted' status as a
 *     selectable alert list (left panel)
 *   - For the selected alert, allow the broker to choose a script type and
 *     generate a CMS-compliant AI retention script via generateRetentionScript()
 *   - Show the generated script in an editable textarea with copy-to-clipboard
 *   - Surface an empty state when no mitigating alerts exist
 *
 * The generateRetentionScript server action requires a ghl_contact_id.
 * Alerts without one show an inline notice and a link to the member profile.
 */

import { useState, useTransition } from 'react'
import { generateRetentionScript, type ScriptType } from '@/app/actions/generate-script'
import { Badge }  from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sparkles, Copy, Check, AlertTriangle, ShieldCheck,
  ChevronRight, RefreshCw, Clock, Zap, FileText, Link2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MitigatingAlert {
  id:               string
  bob_member_id:    string | null
  ghl_contact_id:   string | null
  carrier:          string | null
  switch_type:      string | null
  previous_carrier: string | null
  new_carrier:      string | null
  previous_value:   string | null
  new_value:        string | null
  detected_at:      string | null
  status:           string
  member_full_name: string | null
  member_plan:      string | null
}

interface Props {
  initialAlerts: MitigatingAlert[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SCRIPT_TYPES: { value: ScriptType; label: string; desc: string }[] = [
  {
    value: 'retention',
    label: 'Retention Outreach',
    desc:  'Proactive check-in to affirm plan value before a switch occurs',
  },
  {
    value: 'reactive_save',
    label: 'Reactive Save',
    desc:  'Post-switch recovery call — keep the relationship alive',
  },
  {
    value: 'VCC_followup',
    label: 'VCC Follow-Up',
    desc:  'Confirm physician sign-off on the Vendor Certification form',
  },
  {
    value: 'aep_reminder',
    label: 'AEP Reminder',
    desc:  'Annual Enrollment Period window — prompt plan review',
  },
]

const SWITCH_TYPE_LABELS: Record<string, string> = {
  plan_changed:       'Plan Change',
  carrier_switch:     'Carrier Switch',
  future_plan_change: 'Upcoming Switch',
  termed:             'Termed',
  fully_disenrolled:  'Disenrolled',
  pending_switch:     'Pending Switch',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function switchBadgeCls(type: string | null) {
  if (!type) return 'bg-slate-500/10 text-slate-400 border-slate-500/20'
  if (['termed', 'fully_disenrolled'].includes(type))
    return 'bg-red-500/10 text-red-400 border-red-500/20'
  if (['future_plan_change', 'pending_switch'].includes(type))
    return 'bg-amber-500/10 text-amber-400 border-amber-500/20'
  return 'bg-orange-500/10 text-orange-400 border-orange-500/20'
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ScriptsWorkspace({ initialAlerts }: Props) {
  const [selected,     setSelected]     = useState<MitigatingAlert | null>(
    initialAlerts.length > 0 ? initialAlerts[0] : null
  )
  const [scriptType,   setScriptType]   = useState<ScriptType>('retention')
  const [script,       setScript]       = useState('')
  const [scriptError,  setScriptError]  = useState<string | null>(null)
  const [copied,       setCopied]       = useState(false)
  const [isPending,    startTransition] = useTransition()

  const pendingAlerts   = initialAlerts.filter(a => a.status === 'mitigating')
  const contactedAlerts = initialAlerts.filter(a => a.status === 'contacted')

  // ── Generate ────────────────────────────────────────────────────────────────
  const handleGenerate = () => {
    if (!selected?.ghl_contact_id) return
    setScript('')
    setScriptError(null)
    startTransition(async () => {
      const result = await generateRetentionScript({
        ghlContactId: selected.ghl_contact_id!,
        scriptType,
      })
      if (result.error) {
        setScriptError(result.error)
      } else {
        setScript(result.script)
      }
    })
  }

  // ── Copy ─────────────────────────────────────────────────────────────────────
  const handleCopy = () => {
    if (!script) return
    navigator.clipboard.writeText(script).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (initialAlerts.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-5 py-24 text-center px-8">
        <div className="w-16 h-16 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
          <ShieldCheck className="w-8 h-8 text-emerald-400" />
        </div>
        <div className="space-y-1 max-w-sm">
          <p className="text-base font-black uppercase tracking-tight text-white">
            All Clear — No Active Campaigns
          </p>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            When switch alerts reach the "mitigating" stage, your outreach
            campaigns will appear here for AI-assisted script generation.
          </p>
        </div>
        <Button asChild variant="outline" size="sm"
          className="rounded-xl font-black uppercase text-[9px] tracking-widest border-slate-700 text-slate-400 hover:text-white gap-1.5">
          <Link href="/dashboard/alerts">
            <AlertTriangle className="w-3.5 h-3.5" />
            View All Alerts
          </Link>
        </Button>
      </div>
    )
  }

  // ── Two-column workspace ─────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">

      {/* ── Left panel: alert list ──────────────────────────────────────── */}
      <div className="w-full md:w-80 md:shrink-0 border-b md:border-b-0 md:border-r border-slate-800 flex flex-col overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-800 shrink-0">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
            Pending Outreach · {pendingAlerts.length}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Pending / mitigating */}
          {pendingAlerts.map(alert => (
            <AlertRow
              key={alert.id}
              alert={alert}
              isSelected={selected?.id === alert.id}
              onClick={() => { setSelected(alert); setScript(''); setScriptError(null) }}
            />
          ))}

          {/* Contacted section */}
          {contactedAlerts.length > 0 && (
            <>
              <div className="px-5 py-2.5 border-t border-slate-800 mt-1">
                <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                  Contacted · {contactedAlerts.length}
                </p>
              </div>
              {contactedAlerts.map(alert => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  isSelected={selected?.id === alert.id}
                  onClick={() => { setSelected(alert); setScript(''); setScriptError(null) }}
                  dimmed
                />
              ))}
            </>
          )}
        </div>
      </div>

      {/* ── Right panel: script generator ──────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {selected ? (
          <>
            {/* Member context bar */}
            <div className="px-6 py-4 border-b border-slate-800 shrink-0 space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-black uppercase tracking-tight text-white truncate">
                    {selected.member_full_name ?? 'Unknown Member'}
                  </p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    {selected.member_plan ?? selected.previous_value ?? '—'}
                    {selected.new_value ? ` → ${selected.new_value}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge className={cn(
                    'font-black text-[8px] uppercase tracking-widest px-2 h-5 border',
                    switchBadgeCls(selected.switch_type)
                  )}>
                    {SWITCH_TYPE_LABELS[selected.switch_type ?? ''] ?? selected.switch_type ?? 'Alert'}
                  </Badge>
                  <span className="text-[8px] text-slate-600 font-medium whitespace-nowrap">
                    {fmtDate(selected.detected_at)}
                  </span>
                </div>
              </div>

              {/* No GHL contact ID warning */}
              {!selected.ghl_contact_id && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 flex items-center gap-2.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <p className="text-[10px] text-amber-400 font-medium leading-tight flex-1">
                    No GHL contact linked — script generation requires a GHL contact ID.
                    {selected.bob_member_id && (
                      <> <Link
                        href={`/dashboard/book/${selected.bob_member_id}`}
                        className="ml-1 underline underline-offset-2 hover:text-amber-300 transition-colors font-black"
                      >
                        View member profile →
                      </Link></>
                    )}
                  </p>
                </div>
              )}
            </div>

            {/* Script type selector */}
            <div className="px-6 py-4 border-b border-slate-800 shrink-0">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-3">
                Script Type
              </p>
              <div className="grid grid-cols-2 gap-2">
                {SCRIPT_TYPES.map(st => (
                  <button
                    key={st.value}
                    onClick={() => { setScriptType(st.value); setScript(''); setScriptError(null) }}
                    className={cn(
                      'text-left px-3 py-2.5 rounded-xl border transition-all text-[10px] space-y-0.5',
                      scriptType === st.value
                        ? 'border-violet-500/40 bg-violet-500/10 text-violet-300'
                        : 'border-slate-800 bg-slate-900/40 text-slate-500 hover:border-slate-700 hover:text-slate-300'
                    )}
                  >
                    <p className="font-black uppercase tracking-widest">{st.label}</p>
                    <p className="text-[8px] opacity-70 leading-tight font-medium">{st.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Script output */}
            <div className="flex-1 flex flex-col overflow-hidden px-6 py-4 gap-4 min-h-0">

              {/* Generate button */}
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  onClick={handleGenerate}
                  disabled={isPending || !selected.ghl_contact_id}
                  className="rounded-xl h-9 font-black uppercase text-[9px] tracking-widest gap-2 bg-violet-600 hover:bg-violet-700 text-white shadow-lg shadow-violet-900/30"
                >
                  {isPending
                    ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Generating…</>
                    : <><Sparkles className="w-3.5 h-3.5" /> Generate Script</>
                  }
                </Button>

                {script && (
                  <Button
                    onClick={handleCopy}
                    variant="outline"
                    className="rounded-xl h-9 font-black uppercase text-[9px] tracking-widest gap-1.5 border-slate-700 text-slate-400 hover:text-white"
                  >
                    {copied
                      ? <><Check className="w-3.5 h-3.5 text-emerald-400" /> Copied!</>
                      : <><Copy className="w-3.5 h-3.5" /> Copy</>
                    }
                  </Button>
                )}
              </div>

              {/* Error */}
              {scriptError && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 shrink-0 flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-red-400 font-medium leading-relaxed">{scriptError}</p>
                </div>
              )}

              {/* Script textarea / placeholder */}
              {!script && !isPending && !scriptError && (
                <div className="flex-1 rounded-2xl border border-slate-800 border-dashed flex flex-col items-center justify-center gap-3 text-center p-8">
                  <div className="w-10 h-10 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-violet-400" />
                  </div>
                  <div className="space-y-1 max-w-xs">
                    <p className="text-[11px] font-black uppercase tracking-tight text-slate-400">
                      Ready to generate
                    </p>
                    <p className="text-[9px] text-slate-600 leading-relaxed">
                      Select a script type above and click Generate Script.
                      Maya will produce a CMS-compliant outreach script tailored to this member's risk profile.
                    </p>
                  </div>
                </div>
              )}

              {isPending && (
                <div className="flex-1 rounded-2xl border border-violet-500/20 bg-violet-500/5 flex flex-col items-center justify-center gap-3">
                  <Sparkles className="w-5 h-5 text-violet-400 animate-pulse" />
                  <p className="text-[10px] font-black uppercase tracking-widest text-violet-400">
                    Maya is writing your script…
                  </p>
                </div>
              )}

              {script && !isPending && (
                <textarea
                  value={script}
                  onChange={e => setScript(e.target.value)}
                  className="flex-1 w-full rounded-2xl border border-slate-800 bg-slate-900/60 text-slate-200 text-[12px] font-medium leading-relaxed px-5 py-4 resize-none focus:outline-none focus:border-violet-500/40 focus:bg-violet-500/5 transition-colors placeholder:text-slate-600"
                  placeholder="Generated script will appear here…"
                  spellCheck={false}
                />
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center px-8">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">
              Select an alert to generate a script
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Alert row sub-component ───────────────────────────────────────────────────

function AlertRow({
  alert,
  isSelected,
  onClick,
  dimmed = false,
}: {
  alert:      MitigatingAlert
  isSelected: boolean
  onClick:    () => void
  dimmed?:    boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-5 py-3.5 border-b border-slate-800/60 transition-all group',
        isSelected
          ? 'bg-violet-500/10 border-l-2 border-l-violet-500'
          : 'hover:bg-slate-800/40',
        dimmed && 'opacity-50 hover:opacity-80'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className={cn(
            'text-[11px] font-black uppercase tracking-tight truncate',
            isSelected ? 'text-violet-200' : 'text-slate-300'
          )}>
            {alert.member_full_name ?? 'Unknown Member'}
          </p>
          <p className="text-[9px] text-slate-600 font-medium mt-0.5 truncate">
            {SWITCH_TYPE_LABELS[alert.switch_type ?? ''] ?? alert.switch_type ?? 'Alert'}
            {alert.detected_at ? ` · ${fmtDate(alert.detected_at)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {!alert.ghl_contact_id && (
            <span title="No GHL contact linked">
              <Link2 className="w-3 h-3 text-amber-600/60" />
            </span>
          )}
          {alert.status === 'contacted' ? (
            <Check className="w-3 h-3 text-emerald-600" />
          ) : (
            <Zap className="w-3 h-3 text-violet-600 group-hover:text-violet-400 transition-colors" />
          )}
          <ChevronRight className={cn(
            'w-3 h-3 transition-colors',
            isSelected ? 'text-violet-400' : 'text-slate-700 group-hover:text-slate-400'
          )} />
        </div>
      </div>

      {/* Carrier context */}
      {(alert.previous_carrier || alert.new_carrier || alert.member_plan) && (
        <p className="text-[8px] text-slate-700 mt-1 truncate font-medium">
          {alert.member_plan ?? alert.previous_carrier}
          {alert.new_carrier && alert.new_carrier !== alert.previous_carrier
            ? ` → ${alert.new_carrier}` : ''}
        </p>
      )}
    </button>
  )
}
