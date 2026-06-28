"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/client'
import { Logo } from '@/components/logo'
import Link from 'next/link'
import { ArrowLeft, Mail, ShieldCheck, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setErrorMsg(null)

    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin}/auth/update-password`,
    })

    setLoading(false)
    if (error) {
      setErrorMsg(error.message)
    } else {
      setSent(true)
    }
  }

  return (
    <div className="relative flex flex-col min-h-screen bg-slate-950 text-foreground overflow-hidden">
      <header className="relative h-20 px-8 flex items-center justify-between z-10">
        <Link href="/"><Logo /></Link>
        <Button variant="ghost" size="sm" asChild className="rounded-xl font-black uppercase text-[10px] tracking-widest text-white hover:bg-white/10">
          <Link href="/login"><ArrowLeft className="w-4 h-4 mr-2" /> Back to Login</Link>
        </Button>
      </header>

      <main className="flex-1 flex items-center justify-center p-8 z-10">
        <Card className="max-w-md w-full rounded-[3.5rem] shadow-2xl p-10 border border-white/10 bg-white/5 backdrop-blur-2xl animate-in zoom-in-95 duration-500">
          <div className="space-y-8">
            <div className="text-center space-y-2">
              <div className="flex justify-center mb-4">
                <Logo iconOnly className="scale-125" />
              </div>
              <h2 className="text-3xl font-black uppercase tracking-tighter text-white">Reset Password</h2>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/60">
                We'll send a reset link to your email
              </p>
            </div>

            {sent ? (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                </div>
                <div className="text-center">
                  <p className="text-white font-bold text-sm">Check your email</p>
                  <p className="text-white/50 text-[11px] font-medium mt-1">
                    A reset link was sent to <span className="text-white/80 font-bold">{email}</span>.
                    It expires in 1 hour.
                  </p>
                </div>
                <Link href="/login">
                  <Button variant="ghost" className="text-white/60 hover:text-white font-black uppercase text-[10px] tracking-widest">
                    Back to Login
                  </Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest ml-2 text-white/70">Email Address</Label>
                  <div className="relative group">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 group-focus-within:text-primary transition-colors" />
                    <Input
                      required
                      type="email"
                      placeholder="name@agency.com"
                      className="h-14 rounded-2xl bg-white/5 border-white/10 text-white pl-12 font-bold placeholder:text-white/20 focus:ring-primary shadow-inner"
                      value={email}
                      onChange={e => { setEmail(e.target.value); setErrorMsg(null) }}
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
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Send Reset Link'}
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
