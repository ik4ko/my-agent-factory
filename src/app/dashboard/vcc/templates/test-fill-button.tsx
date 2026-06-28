"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { Eye, Loader2 } from 'lucide-react'
import { testFillTemplate } from '@/app/actions/vcc-templates'

interface Props {
  templateId: string
  storagePath: string
  fieldMap: Record<string, { page: number; x: number; y: number; size: number }>
  brokerNpn: string
  brokerName: string
}

export function TestFillButton({ templateId, storagePath, fieldMap, brokerNpn, brokerName }: Props) {
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  async function handleTestFill() {
    setLoading(true)
    try {
      const res = await testFillTemplate({ templateId, storagePath, fieldMap, brokerNpn, brokerName })
      if (res.error) {
        toast({ variant: 'destructive', title: 'Test Fill Failed', description: res.error })
        return
      }
      // Trigger download
      const bytes = Uint8Array.from(atob(res.pdfBase64!), c => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `test-fill-${templateId}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      toast({ title: 'Test PDF Downloaded', description: 'Check field placement in the downloaded PDF.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleTestFill}
      disabled={loading}
      className="h-8 rounded-xl font-black uppercase text-[9px] tracking-widest gap-1.5"
    >
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
      Test Fill
    </Button>
  )
}
