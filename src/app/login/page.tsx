"use client"

import React, { useState, useEffect, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Lock, Mail, Key, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import Image from 'next/image';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <LoginPageContent />
    </Suspense>
  )
}

function LoginPageContent() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showResend, setShowResend] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams?.get('redirect') ?? '/dashboard';
  const reason = searchParams?.get('reason');
  const { toast } = useToast();

  const authBg = PlaceHolderImages.find(img => img.id === 'auth-bg');

  useEffect(() => {
    setIsMounted(true);
    const supabase = createClient();

    let settled = false;

    // Hard 3-second timeout: if the session check has not resolved, stop waiting
    // and show the login form. This prevents indefinite hangs caused by stale
    // tokens, network failures, or slow Supabase cold-starts.
    const timer = setTimeout(() => {
      if (!settled) {
        console.error('[login] session check timed out — showing login form');
        settled = true;
        setReady(true);
      }
    }, 3000);

    supabase.auth.getUser()
      .then(({ data: { user } }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (user) {
          // Already authenticated — redirect without additional DB calls.
          // AppShell will load agency/broker data after navigation.
          router.push(redirectTo);
        } else {
          setReady(true);
        }
      })
      .catch((err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.error('[login] session check error:', err);
        setReady(true);
      });

    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setShowResend(false);

    const supabase = createClient();

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        const msg = error.message;
        setErrorMsg(
          msg === 'Invalid login credentials'
            ? 'Invalid email or password.'
            : msg
        );
        if (msg.toLowerCase().includes('email not confirmed') || msg.toLowerCase().includes('not confirmed')) {
          setShowResend(true);
        }
        return;
      }

      if (data.user) {
        // Trust the Supabase response — do not run additional session checks.
        // Hard-navigate so the server re-renders with the new session cookie.
        window.location.href = redirectTo;
      }
    } catch (err: any) {
      console.error('[login] signIn error:', err);
      setErrorMsg(err?.message ?? 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email || resendLoading) return;
    setResendLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    setResendLoading(false);
    if (error) {
      toast({ variant: 'destructive', title: 'Could not resend', description: error.message });
    } else {
      setResendSent(true);
      toast({ title: 'Confirmation email sent', description: 'Check your inbox and confirm your email.' });
    }
  };

  if (!isMounted) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  if (!ready) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950">
        <div className="flex flex-col items-center gap-4 text-white">
          <Logo iconOnly className="animate-pulse scale-125" />
          <p className="text-[10px] font-black uppercase tracking-widest opacity-50">Checking Agency Session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col min-h-screen bg-slate-950 text-foreground selection:bg-primary/10 overflow-hidden">
      <div className="absolute inset-0 z-0">
        <Image
          src={authBg?.imageUrl || "https://picsum.photos/seed/medical-auth/2400/1600"}
          alt="Auth Background"
          fill
          className="object-cover opacity-60"
          priority
          data-ai-hint="medical office"
        />
        <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]" />
      </div>

      <header className="relative h-20 px-8 flex items-center justify-between z-10">
        <Link href="/"><Logo /></Link>
        <Button variant="ghost" size="sm" asChild className="rounded-xl font-black uppercase text-[10px] tracking-widest text-white hover:bg-white/10">
          <Link href="/"><ArrowLeft className="w-4 h-4 mr-2" /> Home</Link>
        </Button>
      </header>

      <main className="relative flex-1 flex items-center justify-center p-8 z-10">
        <Card className="max-w-md w-full rounded-[3.5rem] shadow-2xl p-10 border border-white/10 bg-white/5 dark:bg-slate-900/20 backdrop-blur-2xl animate-in zoom-in-95 duration-500 overflow-hidden">
          <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
            <div className="text-center space-y-2">
              <div className="flex justify-center mb-4">
                <Logo iconOnly className="scale-125" />
              </div>
              <h2 className="text-3xl font-black uppercase tracking-tighter text-white">Agency Access</h2>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/60">AegisSage Retention Intelligence</p>
            </div>

            {/* Reason-based banners (confirmation_expired, confirmed, etc.) */}
            {reason === 'confirmation_expired' && (
              <div className="flex items-start gap-3 rounded-2xl bg-red-500/10 border border-red-500/30 px-4 py-3">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-[11px] font-bold text-red-300">
                  Your confirmation link has expired or was already used. Please sign in below or contact{' '}
                  <a href="mailto:support@aegissage.com" className="underline hover:text-red-200">support@aegissage.com</a>.
                </p>
              </div>
            )}
            {reason === 'confirmed' && (
              <div className="flex items-start gap-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-3">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                <p className="text-[11px] font-bold text-emerald-300">
                  Email confirmed. Please sign in to continue.
                </p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest ml-2 text-white/70">Agent Email</Label>
                <div className="relative group">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 group-focus-within:text-primary transition-colors" />
                  <Input
                    required
                    type="email"
                    placeholder="name@agency.com"
                    className="h-14 rounded-2xl bg-white/5 border-white/10 text-white pl-12 font-bold placeholder:text-white/20 focus:ring-primary shadow-inner"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setErrorMsg(null); }}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest ml-2 text-white/70">Password</Label>
                <div className="relative group">
                  <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 group-focus-within:text-primary transition-colors" />
                  <Input
                    required
                    type="password"
                    placeholder="********"
                    className="h-14 rounded-2xl bg-white/5 border-white/10 text-white pl-12 font-bold placeholder:text-white/20 focus:ring-primary shadow-inner"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setErrorMsg(null); }}
                  />
                </div>
              </div>

              {/* Inline error */}
              {errorMsg && (
                <div className="flex items-start gap-3 rounded-2xl bg-red-500/10 border border-red-500/30 px-4 py-3">
                  <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-[11px] font-bold text-red-300">{errorMsg}</p>
                    {showResend && (
                      <button
                        type="button"
                        disabled={resendLoading || resendSent}
                        onClick={handleResend}
                        className="mt-1.5 text-[10px] font-black uppercase tracking-widest text-red-300 hover:text-white underline underline-offset-2 transition-colors disabled:opacity-50"
                      >
                        {resendSent ? 'Confirmation email sent' : resendLoading ? 'Sending...' : 'Resend confirmation email'}
                      </button>
                    )}
                  </div>
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-16 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black text-lg mt-4 shadow-xl shadow-primary/20 uppercase tracking-tighter flex items-center justify-center gap-3 transition-all"
              >
                {loading ? <Loader2 className="animate-spin" /> : <>Log In <Lock className="w-5 h-5" /></>}
              </Button>
            </form>

            <div className="mt-8 pt-8 border-t border-white/10 flex justify-between items-center text-[10px] font-black text-white/50 uppercase tracking-widest px-2">
              <Link href="/signup" className="hover:text-primary transition-colors">Don&apos;t have an account? Sign Up</Link>
              <Link href="/auth/reset-password" className="hover:text-primary transition-colors">Forgot Password</Link>
            </div>

            <div className="flex items-center justify-center gap-2 text-[9px] text-white/30 font-black uppercase tracking-widest">
              <ShieldCheck className="w-3 h-3" /> HIPAA &amp; BAA Compliant Session
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}
