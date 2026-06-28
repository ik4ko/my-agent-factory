'use client'

import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'

interface SubmissionRow {
  client_name: string
  carrier: string
  broker_name: string
  fax_status: string
  fax_sent_at: string | null
  deadline_at: string
  fax_confirmation_id: string | null
}

export function FaxAuditExport({ submissions }: { submissions: SubmissionRow[] }) {
  function handleExport() {
    const headers = ['Client Name', 'Carrier', 'Broker', 'Fax Status', 'Fax Sent At', 'Deadline', 'Confirmation ID']
    const rows = submissions.map(s => [
      s.client_name,
      s.carrier,
      s.broker_name,
      s.fax_status,
      s.fax_sent_at ?? '',
      s.deadline_at,
      s.fax_confirmation_id ?? '',
    ])
    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fax_audit_${new Date().toISOString().split('T')[0]}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <Button
      onClick={handleExport}
      variant="outline"
      size="sm"
      className="rounded-2xl font-black uppercase text-[10px] tracking-widest h-8 px-4 gap-2"
    >
      <Download className="w-3.5 h-3.5" /> Export CSV
    </Button>
  )
}
