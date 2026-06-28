"use client"

// Invite landing page. Reached from the branded invite email via
// /auth/confirm?token_hash=...&type=invite&next=/auth/set-password —
// the confirm route verifies the token server-side and sets the session
// cookies, so by the time this renders the invitee is authenticated and
// only needs to choose a password.

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'
import { Logo } from '@/components/logo'
import { useRouter } from 'next/navigation'
import { Key, ShieldCheck, CheckCircle2, AlertCircle, Loader2, Eye, EyeOff } from 'lucide-react'

export default function SetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)

    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setErrorMsg('Passwords do not match.')
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      setErrorMsg('Your invite link has expired or was already used. Ask your agency admin to send a new invite.')
      return
    }

    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setErrorMsg(error.message)
    } else {
      setDone(true)
      setTimeout(() => {
        router.refresh()
        router.push('/dashboard')
      }, 2000)
    }
  }

  return (
    <div className="relative flex flex-col min-h-screen bg-slate-950 text-foreground overflow-hidden">
      <header className="relative h-20 px-8 flex items-center z-10">
        <Logo />
      </header>

      <main className="flex-1 flex items-center justify-center p-8 z-10">
        <Card className="max-w-md w-full rounded-[3.5rem] shadow-2xl p-10 border border-white/10 bg-white/5 backdrop-blur-2xl animate-in zoom-in-95 duration-500">
          <div className="space-y-8">
            <div className="text-center space-y-2">
              <div className="flex justify-center mb-4">
                <Logo iconOnly className="scale-125" />
              </div>
              <h2 className="text-3xl font-black uppercase tracking-tighter text-white">Welcome Aboard</h2>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/60">
                Set a password to finish your account setup
              </p>
            </div>

            {done ? (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                </div>
                <div className="text-center">
                  <p className="text-white font-bold text-sm">Account ready</p>
                  <p className="text-white/50 text-[11px] font-medium mt-1">Taking you to your dashboard...</p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest ml-2 text-white/70">Password</Label>
                  <div className="relative group">
                    <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 group-focus-within:text-primary transition-colors" />
                    <Input
                      required
                      type={showPw ? 'text' : 'password'}
                      placeholder="Min. 8 characters"
                      className="h-14 rounded-2xl bg-white/5 border-white/10 text-white pl-12 pr-12 font-bold placeholder:text-white/20 focus:ring-primary shadow-inner"
                      value={password}
                      onChange={e => { setPassword(e.target.value); setErrorMsg(null) }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(v => !v)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest ml-2 text-white/70">Confirm Password</Label>
                  <div className="relative group">
                    <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 group-focus-within:text-primary transition-colors" />
                    <Input
                      required
                      type={showPw ? 'text' : 'password'}
                      placeholder="Repeat password"
                      className="h-14 rounded-2xl bg-white/5 border-white/10 text-white pl-12 font-bold placeholder:text-white/20 focus:ring-primary shadow-inner"
                      value={confirm}
                      onChange={e => { setConfirm(e.target.value); setErrorMsg(null) }}
                    />
                  </div>
                </div>

                {errorMsg && (
                  <div className="flex items-start gap-3 rounded-2xl bg-red-500/10 border border-red-500/30 px-4 py-3">
                    <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                    <p className="text-[11px] font-bold text-red-300">{errorMsg}</p>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-14 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-tighter flex items-center justify-center gap-3 transition-all"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Create Account'}
                </Button>
              </form>
            )}

            <div className="flex items-center justify-center gap-2 text-[9px] text-white/30 font-black uppercase tracking-widest pt-4 border-t border-white/10">
              <ShieldCheck className="w-3 h-3" /> HIPAA &amp; BAA Compliant Session
            </div>
          </div>
        </Card>
      </main>
    </div>
  )
}
