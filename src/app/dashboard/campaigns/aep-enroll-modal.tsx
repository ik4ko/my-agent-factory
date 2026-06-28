'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { enrollInAEPShield } from '@/app/actions/campaigns'
import { useToast } from '@/hooks/use-toast'
import { Shield, Loader2, Plus } from 'lucide-react'

export function AEPEnrollModal() {
  const [open, setOpen] = useState(false)
  const [contactId, setContactId] = useState('')
  const [anniversary, setAnniversary] = useState('')
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()
  const router = useRouter()

  async function handleEnroll() {
    if (!contactId.trim()) return
    setLoading(true)
    const res = await enrollInAEPShield(contactId.trim(), anniversary || undefined)
    setLoading(false)
    if (res.success) {
      toast({ title: 'Enrolled in AEP Shield', description: `GHL tag AEP-SHIELD-ACTIVE applied.` })
      setOpen(false)
      setContactId('')
      setAnniversary('')
      router.refresh()
    } else {
      toast({ variant: 'destructive', title: 'Error', description: res.error })
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="rounded-2xl font-black uppercase text-[10px] tracking-widest h-9 px-4 gap-2">
          <Plus className="w-4 h-4" /> Enroll Contact
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-3xl max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-black uppercase tracking-tight flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" /> Enroll in AEP Shield
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">GHL Contact ID</label>
            <Input
              value={contactId}
              onChange={e => setContactId(e.target.value)}
              placeholder="GHL contact ID..."
              className="rounded-2xl font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Enrollment Anniversary <span className="normal-case font-normal">(optional)</span>
            </label>
            <Input
              type="date"
              value={anniversary}
              onChange={e => setAnniversary(e.target.value)}
              className="rounded-2xl text-sm"
            />
          </div>
          <Button
            onClick={handleEnroll}
            disabled={loading || !contactId.trim()}
            className="w-full rounded-2xl font-black uppercase text-[10px] tracking-widest h-11 gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            Enroll & Tag GHL
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
