'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { saveMbi, removeMbi } from '@/app/actions/mbi'
import { useRouter } from 'next/navigation'
import { KeyRound, X, RefreshCw } from 'lucide-react'

interface Props {
  memberId: string
  hasMbi: boolean
}

export function MbiForm({ memberId, hasMbi: initialHasMbi }: Props) {
  const [hasMbi, setHasMbi] = useState(initialHasMbi)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    // Auto-format as user types: insert dashes at positions 4 and 7
    let raw = e.target.value.replace(/[-\s]/g, '').toUpperCase()
    let formatted = raw
    if (raw.length > 4) formatted = raw.slice(0, 4) + '-' + raw.slice(4)
    if (raw.length > 7) formatted = formatted.slice(0, 8) + '-' + raw.slice(7)
    setValue(formatted)
  }

  function handleSave() {
    setError(null)
    startTransition(async () => {
      const result = await saveMbi(memberId, value)
      if (result.error) {
        setError(result.error)
      } else {
        setHasMbi(true)
        setEditing(false)
        setValue('')
        router.refresh()
      }
    })
  }

  function handleRemove() {
    setError(null)
    startTransition(async () => {
      const result = await removeMbi(memberId)
      if (result.error) {
        setError(result.error)
      } else {
        setHasMbi(false)
        setEditing(false)
        router.refresh()
      }
    })
  }

  if (hasMbi && !editing) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-mono text-emerald-400 tracking-widest">
              ●●●●-●●●-●●●●
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(true)}
              className="h-7 px-2.5 rounded-lg text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-white gap-1"
            >
              <RefreshCw className="w-3 h-3" />Update
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={handleRemove}
              className="h-7 px-2.5 rounded-lg text-[9px] font-black uppercase tracking-widest text-red-400 hover:text-white hover:bg-red-500/20 gap-1"
            >
              <X className="w-3 h-3" />Remove
            </Button>
          </div>
        </div>
        <p className="text-[9px] text-slate-600 font-medium">
          MBI is encrypted at rest using AES-256-GCM. It is never displayed in plaintext.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <input
          type="text"
          value={value}
          onChange={handleInput}
          placeholder="e.g. 1EG4-TE5-MK72"
          maxLength={13}
          className="w-full h-10 bg-slate-800 border border-slate-700 rounded-xl px-3 text-sm font-mono text-white placeholder:text-slate-600 focus:outline-none focus:border-primary/50 tracking-widest uppercase"
        />
        <p className="text-[9px] text-slate-500 font-medium">
          Format: Any 11 characters or digits · CMS Medicare Beneficiary ID
        </p>
      </div>
      {error && (
        <p className="text-[10px] text-red-400 font-medium">{error}</p>
      )}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={isPending || value.replace(/-/g, '').length < 11}
          onClick={handleSave}
          className="h-8 px-4 rounded-xl text-[9px] font-black uppercase tracking-widest"
        >
          {isPending ? 'Saving...' : 'Save MBI'}
        </Button>
        {(hasMbi || editing) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setEditing(false); setValue(''); setError(null) }}
            className="h-8 px-3 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-500"
          >
            Cancel
          </Button>
        )}
      </div>
      <p className="text-[9px] text-slate-600 font-medium">
        Encrypted before storage. Never shared outside your agency.
      </p>
    </div>
  )
}
