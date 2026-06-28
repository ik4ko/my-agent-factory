'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { resolveAlert, dismissAlert } from '@/app/actions/roster-upload'
import { triggerReactiveSave } from '@/app/actions/campaigns'
import { CheckCircle2, XCircle, Megaphone, Loader2 } from 'lucide-react'

interface AlertActionsProps {
  alertId: string
  ghlContactId: string
  status: string
  ghlWorkflowTriggered: boolean
}

export function AlertActions({ alertId, ghlContactId, status, ghlWorkflowTriggered }: AlertActionsProps) {
  const [loading, setLoading] = useState<'resolve' | 'dismiss' | 'campaign' | null>(null)
  const [campaignActive, setCampaignActive] = useState(ghlWorkflowTriggered)
  const router = useRouter()
  const { toast } = useToast()

  if (status === 'resolved' || status === 'dismissed') {
    return (
      <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/50">
        {status}
      </span>
    )
  }

  async function handleResolve() {
    setLoading('resolve')
    await resolveAlert(alertId)
    router.refresh()
  }

  async function handleDismiss() {
    setLoading('dismiss')
    await dismissAlert(alertId)
    router.refresh()
  }

  async function handleCampaign() {
    setLoading('campaign')
    const res = await triggerReactiveSave(alertId)
    setLoading(null)
    if (res.success) {
      setCampaignActive(true)
      toast({
        title: 'Reactive Save campaign triggered in GHL',
        description: 'Contact tagged and urgent task created.',
      })
      router.refresh()
    } else {
      toast({ variant: 'destructive', title: 'Campaign failed', description: res.error })
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={handleResolve}
        disabled={loading !== null}
        className="h-7 w-7 p-0 rounded-xl hover:bg-emerald-500/10 hover:text-emerald-600"
        title="Mark resolved"
      >
        {loading === 'resolve' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleDismiss}
        disabled={loading !== null}
        className="h-7 w-7 p-0 rounded-xl hover:bg-muted"
        title="Dismiss"
      >
        {loading === 'dismiss' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5 text-muted-foreground" />}
      </Button>
      {!ghlContactId.startsWith('new:') && (
        campaignActive ? (
          <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600 px-2">
            Campaign Active
          </span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCampaign}
            disabled={loading !== null}
            className="h-7 px-2 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-primary/10 hover:text-primary gap-1"
            title="Trigger Reactive Save campaign"
          >
            {loading === 'campaign'
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Megaphone className="w-3.5 h-3.5" />}
            Save
          </Button>
        )
      )}
    </div>
  )
}
