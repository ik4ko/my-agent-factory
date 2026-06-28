'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Logo } from '@/components/logo'
import { ShieldCheck, Loader2, CheckCircle } from 'lucide-react'
import Image from 'next/image'

type Step = 'loading' | 'enroll' | 'verify' | 'done' | 'error'

export default function MfaSetupPage() {
  const router = useRouter()
  const [step, setStep]     = useState<Step>('loading')
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [code, setCode]     = useState('')
  const [error, setError]   = useState<string | null>(null)
  const [busy, setBusy]     = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.mfa.enroll({ factorType: 'totp' }).then(({ data, error }) => {
      if (error || !data) {
        setError(error?.message ?? 'Failed to start MFA enrollment.')
        setStep('error')
        return
      }
      setFactorId(data.id)
      setQrCode(data.totp.qr_code)
      setSecret(data.totp.secret)
      setStep('enroll')
    })
  }, [])

  async function handleVerify() {
    if (!factorId || code.length < 6) return
    setBusy(true)
    setError(null)
    const supabase = createClient()

    const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId })
    if (cErr || !challenge) {
      setError(cErr?.message ?? 'Challenge failed.')
      setBusy(false)
      return
    }

    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code,
    })

    setBusy(false)
    if (vErr) {
      setError('Invalid code — try again.')
      return
    }

    setStep('done')
    setTimeout(() => router.replace('/dashboard'), 1500)
  }

  if (step === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (step === 'done') {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto" />
          <p className="text-sm font-black uppercase tracking-widest text-white">MFA Enabled</p>
          <p className="text-xs text-slate-400">Redirecting to dashboard…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6 antialiased">
      <div className="w-full max-w-sm space-y-8">

        <div className="text-center space-y-3">
          <Logo iconOnly className="mx-auto" />
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <ShieldCheck className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-xl font-black uppercase tracking-tight text-white">
            Secure Your Account
          </h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            HIPAA requires MFA for all accounts that access protected health information.
            Scan the QR code with an authenticator app (Google Authenticator, Authy, etc.).
          </p>
        </div>

        {step === 'enroll' && qrCode && (
          <div className="space-y-6">
            <div className="flex justify-center">
              <div className="p-3 bg-white rounded-2xl">
                <Image src={qrCode} alt="MFA QR code" width={180} height={180} unoptimized />
              </div>
            </div>

            {secret && (
              <div className="rounded-2xl bg-muted/20 border border-border px-4 py-3 text-center">
                <p className="text-[9px] font-black uppercase tracking-widest text-muted-foreground mb-1">
                  Manual entry key
                </p>
                <p className="text-xs font-mono text-white break-all">{secret}</p>
              </div>
            )}

            <Button
              className="w-full h-12 rounded-2xl font-black uppercase tracking-widest"
              onClick={() => setStep('verify')}
            >
              I&apos;ve Scanned the Code
            </Button>
          </div>
        )}

        {step === 'verify' && (
          <div className="space-y-4">
            <p className="text-xs text-slate-400 text-center">
              Enter the 6-digit code from your authenticator app to confirm enrollment.
            </p>
            <Input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              className="text-center text-2xl font-mono tracking-[0.5em] h-14 rounded-2xl"
              autoFocus
            />
            {error && (
              <p className="text-xs text-red-400 text-center font-medium">{error}</p>
            )}
            <Button
              className="w-full h-12 rounded-2xl font-black uppercase tracking-widest"
              disabled={code.length < 6 || busy}
              onClick={handleVerify}
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Verify &amp; Enable MFA
            </Button>
          </div>
        )}

        {step === 'error' && (
          <div className="rounded-2xl bg-red-500/10 border border-red-500/30 px-4 py-4 text-center space-y-2">
            <p className="text-xs font-bold text-red-300">{error}</p>
            <Button
              variant="ghost"
              size="sm"
              className="text-[10px] font-black uppercase tracking-widest text-red-400"
              onClick={() => router.replace('/dashboard')}
            >
              Skip for now
            </Button>
          </div>
        )}

      </div>
    </div>
  )
}
