'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { CheckCircle2, Send, Download, Loader2, Megaphone } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { markVCCSigned, resendVCCFax } from '@/app/actions/vcc-submit'
import { triggerVCCFollowup } from '@/app/actions/campaigns'

interface Props {
  submissionId: string
  faxStatus: string
  isPrincipal: boolean
  pdfUrl: string | null
  doctorFax: string | null
}

export function SubmissionActions({ submissionId, faxStatus, isPrincipal, pdfUrl, doctorFax }: Props) {
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [localStatus, setLocalStatus] = useState(faxStatus)
  const [followupSent, setFollowupSent] = useState(false)

  const handleMarkSigned = () => {
    startTransition(async () => {
      try {
        await markVCCSigned(submissionId)
        setLocalStatus('signed')
        toast({ title: 'Marked as signed', description: 'Submission status updated.' })
      } catch (err: unknown) {
        toast({ variant: 'destructive', title: 'Error', description: (err as Error).message })
      }
    })
  }

  const handleResendFax = () => {
    startTransition(async () => {
      try {
        const result = await resendVCCFax(submissionId)
        if (result.success) {
          setLocalStatus('sent')
          toast({ title: 'Fax sent', description: `Resent to ${doctorFax}` })
        } else {
          toast({ variant: 'destructive', title: 'Fax failed', description: result.error })
        }
      } catch (err: unknown) {
        toast({ variant: 'destructive', title: 'Error', description: (err as Error).message })
      }
    })
  }

  const handleFollowupCampaign = () => {
    startTransition(async () => {
      try {
        const result = await triggerVCCFollowup(submissionId)
        if (result.success) {
          setFollowupSent(true)
          toast({
            title: 'VCC Follow-up campaign triggered',
            description: 'GHL tag applied and follow-up task created.',
          })
        } else {
          toast({ variant: 'destructive', title: 'Campaign failed', description: result.error })
        }
      } catch (err: unknown) {
        toast({ variant: 'destructive', title: 'Error', description: (err as Error).message })
      }
    })
  }

  const showFollowup = localStatus === 'sent' && !localStatus.includes('signed')

  return (
    <div className="flex flex-wrap gap-3">
      {pdfUrl && (
        <Button asChild variant="outline" className="rounded-2xl font-black uppercase text-[10px] tracking-widest h-10 px-4 gap-2">
          <a href={pdfUrl} download="VCC_form.pdf" target="_blank" rel="noopener noreferrer">
            <Download className="w-4 h-4" /> Download PDF
          </a>
        </Button>
      )}
      {localStatus !== 'signed' && (
        <Button onClick={handleMarkSigned} disabled={isPending} variant="outline"
          className="rounded-2xl font-black uppercase text-[10px] tracking-widest h-10 px-4 gap-2 border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10">
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Mark as Signed
        </Button>
      )}
      {isPrincipal && doctorFax && localStatus !== 'signed' && (
        <Button onClick={handleResendFax} disabled={isPending} variant="outline"
          className="rounded-2xl font-black uppercase text-[10px] tracking-widest h-10 px-4 gap-2 border-blue-500/30 text-blue-600 hover:bg-blue-500/10">
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Resend Fax
        </Button>
      )}
      {showFollowup && !followupSent && (
        <Button onClick={handleFollowupCampaign} disabled={isPending} variant="outline"
          className="rounded-2xl font-black uppercase text-[10px] tracking-widest h-10 px-4 gap-2 border-primary/30 text-primary hover:bg-primary/10">
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />}
          Send Follow-up Campaign
        </Button>
      )}
      {followupSent && (
        <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 flex items-center gap-1.5 px-2">
          <CheckCircle2 className="w-3.5 h-3.5" /> Follow-up Active
        </span>
      )}
    </div>
  )
}
