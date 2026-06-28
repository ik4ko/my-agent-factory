'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { cancelCampaignEnrollment } from '@/app/actions/campaigns'
import { XCircle } from 'lucide-react'

interface Props {
  enrollmentId: string
  status: string
}

export function CampaignEnrollmentActions({ enrollmentId, status }: Props) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  if (status !== 'active') return null

  async function handleCancel() {
    setLoading(true)
    await cancelCampaignEnrollment(enrollmentId)
    router.refresh()
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCancel}
      disabled={loading}
      className="h-7 px-2 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-red-500/10 hover:text-red-600 gap-1"
    >
      <XCircle className="w-3.5 h-3.5" /> Cancel
    </Button>
  )
}
