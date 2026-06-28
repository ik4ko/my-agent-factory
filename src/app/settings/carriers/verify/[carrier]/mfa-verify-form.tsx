'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RefreshCw, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'

interface Props {
  credId: string
  carrier: string
  username: string
}

export function MfaVerifyForm({ credId, carrier, username }: Props) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()

  function handleSubmit() {
    if (!code.trim()) { setError('Enter the verification code'); return }
    setError('')
    startTransition(async () => {
      // In a full implementation, this would resume the Playwright session
      // using the stored session cookies and submit the MFA code.
      // For now, we mark the credential as active so the next scheduled
      // run will attempt a fresh login (carrier may grant a session token).
      try {
        const res = await fetch('/api/carriers/submit-mfa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credId, carrier, code }),
        })
        const data = await res.json()
        if (data.error) { setError(data.error); return }
        setDone(true)
      } catch {
        setError('Request failed — please try again')
      }
    })
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <CheckCircle2 className="w-12 h-12 text-emerald-500" />
        <div>
          <p className="font-black uppercase tracking-tight text-lg">Verification submitted</p>
          <p className="text-[11px] text-muted-foreground mt-1">
            AegisSage will complete sign-in and run detection on the next scheduled check.
          </p>
        </div>
        <Button asChild variant="outline" className="rounded-xl font-black uppercase text-[10px] tracking-widest mt-2">
          <Link href="/settings/carriers">← Back to Carrier Portals</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
          Signing in as
        </p>
        <p className="text-sm font-bold">{username}</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="mfa-code" className="text-[10px] font-black uppercase tracking-widest">
          Verification Code
        </Label>
        <Input
          id="mfa-code"
          value={code}
          onChange={e => setCode(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="000000"
          maxLength={8}
          className="rounded-xl h-12 font-mono text-xl text-center tracking-widest"
          autoFocus
          autoComplete="one-time-code"
        />
      </div>

      {error && (
        <p className="text-[11px] font-black text-red-500 uppercase tracking-widest">{error}</p>
      )}

      <Button
        onClick={handleSubmit}
        disabled={pending}
        className="w-full rounded-xl font-black uppercase text-[10px] tracking-widest h-11 gap-2"
      >
        {pending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
        Submit Verification
      </Button>

      <p className="text-[10px] text-center text-muted-foreground">
        <Link href="/settings/carriers" className="font-black uppercase tracking-widest hover:text-foreground">
          Cancel
        </Link>
      </p>
    </div>
  )
}
