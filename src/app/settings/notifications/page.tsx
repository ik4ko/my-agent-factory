'use client'

import { useEffect, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Bell, RefreshCw, CheckCircle2 } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

interface NotifPrefs {
  switch_alert: boolean
  vcc_deadline: boolean
  weekly_digest: boolean
}

const DEFAULTS: NotifPrefs = { switch_alert: true, vcc_deadline: true, weekly_digest: true }

const TOGGLES: { key: keyof NotifPrefs; label: string; desc: string }[] = [
  { key: 'switch_alert',   label: 'Switch Alerts',   desc: 'Notify me when a client shows a plan-switch signal' },
  { key: 'vcc_deadline',   label: 'VCC Deadlines',   desc: 'Remind me when a VCC form is approaching its deadline' },
  { key: 'weekly_digest',  label: 'Weekly Digest',   desc: 'Sunday email summary of my book\'s health and open items' },
]

export default function NotificationsPage() {
  const [prefs, setPrefs] = useState<NotifPrefs>(DEFAULTS)
  const [brokerId, setBrokerId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data: broker } = await supabase
        .from('brokers')
        .select('id, notification_preferences')
        .eq('user_id', user.id)
        .maybeSingle()
      if (broker) {
        setBrokerId(broker.id)
        setPrefs({ ...DEFAULTS, ...(broker.notification_preferences ?? {}) })
      }
      setLoading(false)
    })
  }, [])

  const toggle = (key: keyof NotifPrefs) =>
    setPrefs(p => ({ ...p, [key]: !p[key] }))

  const handleSave = () => {
    if (!brokerId) return
    startTransition(async () => {
      const supabase = createClient()
      const { error } = await supabase
        .from('brokers')
        .update({ notification_preferences: prefs })
        .eq('id', brokerId)
      if (error) {
        toast({ variant: 'destructive', title: 'Save failed', description: error.message })
      } else {
        setSaved(true)
        toast({ title: 'Notification preferences saved' })
        setTimeout(() => setSaved(false), 2500)
      }
    })
  }

  return (
    <div className="flex flex-col h-full w-full">
      <header className="h-16 border-b border-border px-8 flex items-center gap-3 bg-background sticky top-0 z-10">
        <div className="w-9 h-9 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Bell className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-black uppercase tracking-tight">Notifications</h1>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Email &amp; alert preferences</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8 max-w-xl mx-auto w-full space-y-6 pb-32">
        {loading ? (
          <div className="flex justify-center py-16">
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Card className="rounded-3xl border border-border bg-card shadow-sm">
            <CardHeader className="border-b border-border">
              <CardTitle className="text-sm font-black uppercase tracking-tight">Alert Preferences</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              {TOGGLES.map(({ key, label, desc }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggle(key)}
                  className={cn(
                    'w-full flex items-center justify-between p-4 rounded-2xl border transition-all text-left',
                    prefs[key]
                      ? 'border-primary/30 bg-primary/5'
                      : 'border-border hover:border-primary/20 hover:bg-muted/30'
                  )}
                >
                  <div>
                    <p className={cn(
                      'text-[11px] font-black uppercase tracking-widest',
                      prefs[key] ? 'text-primary' : 'text-foreground'
                    )}>
                      {label}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{desc}</p>
                  </div>
                  <div className={cn(
                    'w-9 h-5 rounded-full transition-all flex items-center shrink-0 ml-4',
                    prefs[key] ? 'bg-primary justify-end' : 'bg-muted justify-start'
                  )}>
                    <div className="w-3.5 h-3.5 rounded-full bg-white mx-0.5 shadow-sm" />
                  </div>
                </button>
              ))}

              <Button
                onClick={handleSave}
                disabled={isPending}
                className="w-full h-11 rounded-2xl font-black uppercase text-[10px] tracking-widest gap-2 mt-2"
              >
                {isPending
                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  : saved
                  ? <CheckCircle2 className="w-3.5 h-3.5" />
                  : null}
                {isPending ? 'Saving...' : saved ? 'Saved!' : 'Save Preferences'}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
