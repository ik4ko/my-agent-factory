"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Logo } from "@/components/logo"
import { Trash2 } from "lucide-react"

/**
 * Rendered when subscription_status = 'deleted'.
 * Signs the user out on mount so the Supabase session is cleared and the
 * JWT cannot be reused to reach any other protected route.
 */
export default function AccountDeletedPage() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.signOut().catch(() => {
      // Sign-out best-effort — even if it fails the page still shows.
    })
  }, [])

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-8 antialiased">
      <div className="max-w-md w-full space-y-8 text-center">

        {/* Brand */}
        <div className="flex justify-center">
          <Logo iconOnly className="opacity-40" />
        </div>

        {/* Icon */}
        <div className="w-16 h-16 rounded-3xl bg-red-500/10 flex items-center justify-center mx-auto">
          <Trash2 className="w-7 h-7 text-red-400" />
        </div>

        {/* Copy */}
        <div className="space-y-3">
          <h1 className="text-xl font-black uppercase tracking-widest text-white">
            Account Deleted
          </h1>
          <p className="text-[11px] font-medium text-slate-400 leading-relaxed">
            This workspace has been permanently closed. All broker access has
            been revoked immediately.
          </p>
          <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
            Your data is retained for 10 years per CMS / HIPAA audit requirements.
          </p>
        </div>

        {/* Support */}
        <div className="rounded-2xl bg-slate-900 border border-white/5 px-6 py-5 text-left space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Need to reactivate?
          </p>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Contact{' '}
            <a
              href="mailto:support@aegissage.com"
              className="text-primary hover:text-primary/80 font-bold transition-colors"
            >
              support@aegissage.com
            </a>
            {' '}to discuss account restoration. Reinstatement is subject to
            review and may require re-verification.
          </p>
        </div>

        {/* Sign-in link */}
        <button
          onClick={() => router.push('/login')}
          className="text-[10px] font-black uppercase tracking-widest text-slate-600 hover:text-slate-400 transition-colors"
        >
          Return to Sign In
        </button>

      </div>
    </div>
  )
}
