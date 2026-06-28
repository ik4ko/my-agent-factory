'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle2, Circle, X, ChevronDown, ChevronUp } from 'lucide-react'

const DISMISS_KEY = 'aegissage_onboarding_v1'

interface Step {
  id: string
  label: string
  description: string
  href?: string
  checkFn: (ctx: CheckContext) => boolean
}

interface CheckContext {
  hasGHL: boolean
  hasContacts: boolean
  hasRoster: boolean
  hasVCC: boolean
  hasAEP: boolean
}

const STEPS: Step[] = [
  {
    id: 'ghl',
    label: 'Connect GoHighLevel',
    description: 'Sync your GHL account to import contacts automatically.',
    // GHL connect is embedded in the unified import page — /settings/ghl-connect removed
    href: '/dashboard/churn/upload',
    checkFn: ctx => ctx.hasGHL,
  },
  {
    id: 'contacts',
    label: 'Sync your contacts',
    description: 'Run a contact sync from your GHL workspace.',
    href: '/dashboard',
    checkFn: ctx => ctx.hasContacts,
  },
  {
    id: 'roster',
    label: 'Upload member roster',
    description: 'Import your existing Medicare book of business via CSV.',
    href: '/dashboard/retention',
    checkFn: ctx => ctx.hasRoster,
  },
  {
    id: 'vcc',
    label: 'Submit your first VCC form',
    description: 'Send a Verification of Coverage Continuation form to a member\'s doctor.',
    href: '/dashboard/vcc',
    checkFn: ctx => ctx.hasVCC,
  },
  {
    id: 'aep',
    label: 'Enroll a client in AEP Shield',
    description: 'Protect a client from plan changes during Annual Enrollment Period.',
    href: '/dashboard/campaigns',
    checkFn: ctx => ctx.hasAEP,
  },
]

export function OnboardingChecklist() {
  const [ctx, setCtx] = useState<CheckContext | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (localStorage.getItem(DISMISS_KEY) === '1') {
        setDismissed(true)
        return
      }
    }

    const supabase = createClient()
    const loadChecklist = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data: broker } = await supabase
          .from('brokers')
          .select('id, agency_id, ghl_api_key')
          .eq('user_id', user.id)
          .maybeSingle()

        if (!broker) return

        const [{ count: contactCount }, { count: rosterCount }, { count: vccCount }, { count: aepCount }] = await Promise.all([
          supabase.from('ghl_contacts').select('id', { count: 'exact', head: true }).eq('agency_id', broker.agency_id),
          supabase.from('book_of_business').select('id', { count: 'exact', head: true }).eq('agency_id', broker.agency_id),
          supabase.from('vcc_submissions').select('id', { count: 'exact', head: true }).eq('broker_id', broker.id),
          supabase.from('campaign_enrollments').select('id', { count: 'exact', head: true }).eq('agency_id', broker.agency_id),
        ])

        setCtx({
          hasGHL: !!(broker as any).ghl_api_key,
          hasContacts: (contactCount ?? 0) > 0,
          hasRoster: (rosterCount ?? 0) > 0,
          hasVCC: (vccCount ?? 0) > 0,
          hasAEP: (aepCount ?? 0) > 0,
        })
      } catch {
        // Non-fatal — checklist silently fails if data unavailable
      }
    }
    loadChecklist()
  }, [])

  function dismiss() {
    if (typeof window !== 'undefined') localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  if (dismissed || !ctx) return null

  const completedCount = STEPS.filter(s => s.checkFn(ctx)).length
  const allDone = completedCount === STEPS.length

  if (allDone) return null

  return (
    <Card className="rounded-3xl border border-primary/20 bg-primary/5 shadow-sm overflow-hidden">
      <CardContent className="p-0">
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-black">
              {completedCount}/{STEPS.length}
            </div>
            <div>
              <p className="text-sm font-black text-white uppercase tracking-tight">Get Started</p>
              <p className="text-[10px] text-slate-400 font-bold">
                {STEPS.length - completedCount} step{STEPS.length - completedCount !== 1 ? 's' : ''} remaining
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCollapsed(c => !c)}
              className="h-7 w-7 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            >
              {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={dismiss}
              className="h-7 w-7 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {!collapsed && (
          <div className="divide-y divide-primary/10">
            {STEPS.map(step => {
              const done = step.checkFn(ctx)
              return (
                <div key={step.id} className={`flex items-start gap-4 px-6 py-4 ${done ? 'opacity-50' : ''}`}>
                  {done
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    : <Circle className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />}
                  <div className="flex-1 min-w-0">
                    <p className={`text-[11px] font-black uppercase tracking-tight ${done ? 'line-through text-slate-500' : 'text-white'}`}>
                      {step.label}
                    </p>
                    {!done && (
                      <p className="text-[10px] text-slate-400 mt-0.5">{step.description}</p>
                    )}
                  </div>
                  {!done && step.href && (
                    <a
                      href={step.href}
                      className="text-[9px] font-black uppercase tracking-widest text-primary hover:text-primary/80 shrink-0 mt-0.5"
                    >
                      Go &rarr;
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
