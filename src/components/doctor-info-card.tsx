'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Stethoscope, Pencil, Check, X, Phone, FileCheck, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useToast } from '@/hooks/use-toast'

interface Props {
  memberId: string
  bobId:    string
  initialDoctorName: string | null
  initialDoctorFax:  string | null
}

export function DoctorInfoCard({ memberId, bobId, initialDoctorName, initialDoctorFax }: Props) {
  const { toast } = useToast()
  const [editing,    setEditing]    = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [doctorName, setDoctorName] = useState(initialDoctorName ?? '')
  const [doctorFax,  setDoctorFax]  = useState(initialDoctorFax  ?? '')
  const [savedName,  setSavedName]  = useState(initialDoctorName ?? '')
  const [savedFax,   setSavedFax]   = useState(initialDoctorFax  ?? '')

  const hasInfo = savedName || savedFax

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/book/update-doctor', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, doctor_name: doctorName || null, doctor_fax: doctorFax || null }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast({ variant: 'destructive', title: 'Save failed', description: body.error ?? 'Please try again.' })
        return
      }
      setSavedName(doctorName)
      setSavedFax(doctorFax)
      setEditing(false)
      toast({ title: 'Physician info saved' })
    } catch {
      toast({ variant: 'destructive', title: 'Network error', description: 'Check your connection and try again.' })
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setDoctorName(savedName)
    setDoctorFax(savedFax)
    setEditing(false)
  }

  return (
    <Card className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Stethoscope className="w-4 h-4 text-violet-400" />
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-500">
            Physician (for VCC Fax)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasInfo && !editing && (
            <Button asChild size="sm" variant="ghost"
              className="h-7 px-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest text-emerald-400 hover:bg-emerald-500/10 gap-1">
              <Link href={`/dashboard/vcc/new?bob=${bobId}`}>
                <FileCheck className="w-3 h-3" /> Fill VCC
              </Link>
            </Button>
          )}
          {!editing ? (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}
              className="h-7 px-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-white hover:bg-slate-800 gap-1">
              <Pencil className="w-3 h-3" /> {hasInfo ? 'Edit' : 'Add'}
            </Button>
          ) : (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={handleSave} disabled={saving}
                className="h-7 px-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest text-emerald-400 hover:bg-emerald-500/10 gap-1">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button size="sm" variant="ghost" onClick={handleCancel} disabled={saving}
                className="h-7 px-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-500 hover:text-white hover:bg-slate-800 gap-1">
                <X className="w-3 h-3" /> Cancel
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      {editing ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[9px] font-black uppercase tracking-widest text-slate-500">Doctor Name</label>
            <Input
              value={doctorName}
              onChange={e => setDoctorName(e.target.value)}
              placeholder="Dr. John Doe"
              disabled={saving}
              className="h-10 rounded-xl text-sm bg-slate-800 border-slate-700 text-white placeholder:text-slate-600"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[9px] font-black uppercase tracking-widest text-slate-500">Fax Number</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <Input
                value={doctorFax}
                onChange={e => setDoctorFax(e.target.value)}
                placeholder="(555) 000-0000"
                disabled={saving}
                className="h-10 rounded-xl text-sm bg-slate-800 border-slate-700 text-white placeholder:text-slate-600 pl-9"
              />
            </div>
          </div>
        </div>
      ) : hasInfo ? (
        <div className="space-y-2">
          {savedName && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Doctor</span>
              <span className="text-sm text-white font-medium">{savedName}</span>
            </div>
          )}
          {savedFax && (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">Fax</span>
              <span className="text-sm text-slate-300 font-mono">{savedFax}</span>
            </div>
          )}
        </div>
      ) : (
        <p className="text-[10px] text-slate-600 leading-relaxed">
          Add the client's primary physician name and fax number.
          This info will be pre-filled when you create a VCC form for this member.
          GHL custom fields (doctor_name, doctor_fax) are imported automatically on sync.
        </p>
      )}
    </Card>
  )
}
