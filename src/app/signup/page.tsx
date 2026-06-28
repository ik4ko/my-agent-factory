"use client"

import React, { useState, useEffect, Suspense } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2, ArrowLeft, Mail, Key, User, AlertCircle,
  ShieldCheck, Briefcase, Building2,
} from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import Image from 'next/image';
import { PlaceHolderImages } from '@/lib/placeholder-images';
import { createClient } from '@/lib/supabase/client';
import { provisionAgency } from '@/app/actions/provision-agency';

type AccountType = 'broker' | 'agency';

function SignupPageContent() {
  const [isMounted, setIsMounted] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('broker');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [emailPending, setEmailPending] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);

  const { toast } = useToast();
  const authBg = PlaceHolderImages.find(img => img.id === 'auth-bg');

  useEffect(() => { setIsMounted(true); }, []);

  const handleResend = async () => {
    if (!submittedEmail || resendLoading || resendSent) return;
    setResendLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resend({ type: 'signup', email: submittedEmail });
    setResendLoading(false);
    if (error) {
      toast({ variant: 'destructive', title: 'Could not resend', description: error.message });
    } else {
      setResendSent(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    if (!termsAccepted) {
      setErrorMsg('You must agree to the Terms of Service to continue.');
      return;
    }

    setLoading(true);
    const supabase = createClient();

    try {
      const nameParts = fullName.trim().split(/\s+/);
      const firstName = nameParts[0] ?? '';
      const lastName = nameParts.slice(1).join(' ') || firstName;

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName.trim(), account_type: accountType },
        },
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('Signup returned no user object.');

      // ── Provisioning (separate from auth) ─────────────────────────────────
      // If provisioning fails, the auth user already exists. Surface the error
      // clearly so the user knows their account was created but setup failed.
      // AppShell will offer a re-provision button if they reach /dashboard.
      try {
        await provisionAgency({
          userId: authData.user.id,
          firstName,
          lastName,
          agencyName: null,
          phone: '',
          role: accountType === 'agency' ? 'agency_owner' : 'solo_broker',
          tpmoCertifiedAt: new Date().toISOString(),
          billingPlan: accountType === 'agency' ? 'agency' : 'broker-individual',
        });
      } catch (provisionErr: any) {
        console.error('[signup] provisionAgency failed:', {
          message: provisionErr?.message,
          code:    provisionErr?.code,
          userId:  authData.user.id,
        });
        setErrorMsg(
          `Account created, but workspace setup failed: ${provisionErr?.message ?? 'unknown error'}. ` +
          'You can sign in and complete setup from the dashboard, or contact support@aegissage.com.'
        );
        setLoading(false);
        return;
      }

      if (authData.session) {
        // Session live — hard-navigate so the server picks up the session cookie
        window.location.href = '/dashboard';
      } else {
        setSubmittedEmail(email);
        setEmailPending(true);
      }
    } catch (err: any) {
      console.error('[signup] auth error:', err);
      setErrorMsg(err?.message ?? 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (emailPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 px-6">
        <div className="max-w-md w-full text-center space-y-6">
          <div className="text-5xl">✉️</div>
          <h1 className="text-2xl font-black text-white uppercase tracking-tighter">Check Your Email</h1>
          <p className="text-slate-400 text-sm leading-relaxed">
            We sent a confirmation link to{' '}
            <span className="text-white font-semibold">{submittedEmail}</span>.
            Click the link to activate your account.
          </p>
          <p className="text-slate-600 text-xs">
            Didn&apos;t receive it?{' '}
            <button
              onClick={handleResend}
              disabled={resendLoading || resendSent}
              className="text-primary hover:text-primary/80 underline underline-offset-2 transition-colors disabled:opacity-50"
            >
              {resendSent ? 'Email sent' : resendLoading ? 'Sending…' : 'Resend email'}
            </button>
          </p>
          <Link href="/login" className="inline-block mt-4 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-primary transition-colors">
            Back to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col min-h-screen bg-slate-950 text-foreground overflow-hidden">
      <div className="absolute inset-0 z-0">
        {isMounted && (
          <Image
            src={authBg?.imageUrl || 'https://picsum.photos/seed/med1/2400/1600'}
            alt="Background"
            fill
            className="object-cover opacity-60"
            priority
          />
        )}
        <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]" />
      </div>

      <header className="relative h-20 px-8 flex items-center justify-between z-10">
        <Link href="/"><Logo /></Link>
        <Button variant="ghost" size="sm" asChild className="rounded-xl font-black uppercase text-[10px] tracking-widest text-white hover:bg-white/10 hover:text-white">
          <Link href="/"><ArrowLeft className="w-4 h-4 mr-2" /> Back</Link>
        </Button>
      </header>

      <main className="relative flex-1 flex items-center justify-center p-8 z-10 py-12">
        <Card className="max-w-md w-full rounded-[3.5rem] shadow-2xl p-10 border border-white/10 bg-white/5 dark:bg-slate-900/20 backdrop-blur-2xl animate-in zoom-in-95 duration-500">

          <div className="text-center space-y-2 mb-8">
            <div className="flex justify-center mb-4">
              <Logo iconOnly className="scale-125" />
            </div>
            <h2 className="text-3xl font-black uppercase tracking-tighter text-white">Create Account</h2>
            <p className="text-[10px] font-black uppercase tracking-widest text-white/60">AegisSage Retention Intelligence</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Account type selector */}
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest ml-2 text-white/70">Account Type</Label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: 'broker' as AccountType, label: 'I am a Broker', price: '$149/mo', Icon: Briefcase },
                  { value: 'agency' as AccountType, label: 'I am setting up an Agency', price: '$749/mo', Icon: Building2 },
                ]).map(({ value, label, price, Icon }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAccountType(value)}
                    className={`h-20 rounded-2xl border font-black text-[10px] uppercase tracking-widest transition-all flex flex-col items-center justify-center gap-1 px-2 text-center ${
                      accountType === value
                        ? 'border-primary bg-primary/20 text-primary'
                        : 'border-white/10 bg-white/5 text-white/50 hover:border-white/20'
                    }`}
                  >
                    <Icon className="w-4 h-4 mb-0.5" />
                    <span className="leading-tight">{label}</span>
                    <span className={`text-[9px] font-bold normal-case tracking-normal ${accountType === value ? 'text-primary/70' : 'text-white/30'}`}>{price}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Full name */}
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest ml-2 text-white/70">Full Name</Label>
              <div className="relative group">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 group-focus-within:text-primary transition-colors" />
                <Input
                  required
                  type="text"
                  placeholder="Jane Smith"
                  className="h-14 rounded-2xl bg-white/5 border-white/10 text-white pl-12 font-bold placeholder:text-white/20 focus:ring-primary shadow-inner"
                  value={fullName}
                  onChange={(e) => { setFullName(e.target.value); setErrorMsg(null); }}
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest ml-2 text-white/70">Email</Label>
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

            {/* Password */}
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest ml-2 text-white/70">Password</Label>
              <div className="relative group">
                <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 group-focus-within:text-primary transition-colors" />
                <Input
                  required
                  type="password"
                  placeholder="Min. 8 characters"
                  className="h-14 rounded-2xl bg-white/5 border-white/10 text-white pl-12 font-bold placeholder:text-white/20 focus:ring-primary shadow-inner"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setErrorMsg(null); }}
                />
              </div>
            </div>

            {/* Confirm password */}
            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest ml-2 text-white/70">Confirm Password</Label>
              <div className="relative group">
                <Key className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 group-focus-within:text-primary transition-colors" />
                <Input
                  required
                  type="password"
                  placeholder="Repeat your password"
                  className="h-14 rounded-2xl bg-white/5 border-white/10 text-white pl-12 font-bold placeholder:text-white/20 focus:ring-primary shadow-inner"
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setErrorMsg(null); }}
                />
              </div>
            </div>

            {/* Terms */}
            <div className={`rounded-2xl border p-4 transition-colors ${errorMsg?.includes('Terms') ? 'border-red-500/40 bg-red-500/5' : 'border-white/10 bg-white/5'}`}>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="terms"
                  checked={termsAccepted}
                  onCheckedChange={(v) => { setTermsAccepted(!!v); setErrorMsg(null); }}
                  className="mt-0.5 border-white/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary shrink-0"
                />
                <Label htmlFor="terms" className="text-[10px] font-bold text-white/70 leading-relaxed cursor-pointer">
                  I agree to the{' '}
                  <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>
                  {' '}and{' '}
                  <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
                  . All sales are final — no refunds.
                </Label>
              </div>
            </div>

            {/* Inline error */}
            {errorMsg && (
              <div className="flex items-start gap-3 rounded-2xl bg-red-500/10 border border-red-500/30 px-4 py-3">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-[11px] font-bold text-red-300">{errorMsg}</p>
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-16 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black text-lg mt-4 shadow-xl shadow-primary/20 uppercase tracking-tighter flex items-center justify-center gap-3 transition-all"
            >
              {loading ? <Loader2 className="animate-spin" /> : 'Create Account'}
            </Button>
          </form>

          <div className="mt-8 pt-8 border-t border-white/10 text-center">
            <Link href="/login" className="text-[10px] font-black text-white/50 uppercase tracking-widest hover:text-primary transition-colors">
              Already have an account? Sign In
            </Link>
          </div>

          <div className="flex items-center justify-center gap-2 mt-4 text-[9px] text-white/30 font-black uppercase tracking-widest">
            <ShieldCheck className="w-3 h-3" /> HIPAA &amp; BAA Compliant
          </div>
        </Card>
      </main>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-950" />}>
      <SignupPageContent />
    </Suspense>
  );
}
