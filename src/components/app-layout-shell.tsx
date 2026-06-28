"use client"

import { usePathname, useRouter } from "next/navigation"
import { useIsMobile } from "@/hooks/use-mobile"
import { Button } from "./ui/button"
import { Menu, Users, PauseCircle, Loader2 } from "lucide-react"
import { useAppStore } from "@/lib/store"
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet"
import { CollectionSidebar } from "./collection-sidebar"
import { Logo } from "./logo"
import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import Link from "next/link"
import { SiteNavbar } from "./site-navbar"
import { Skeleton } from "./ui/skeleton"
import { provisionAgency } from "@/app/actions/provision-agency"

const PROTECTED_PREFIXES = [
  '/dashboard', '/settings', '/vault', '/members',
  '/clients', '/ai', '/accounting', '/check-ins', '/ghl',
  '/support', '/privacy', '/extension', '/connect-extension',
]

// Auth and standalone pages that render their own layout — no marketing navbar.
const NO_NAVBAR_PREFIXES = ['/login', '/signup', '/auth', '/account-deleted']

// ── Account-paused overlay ────────────────────────────────────────────────────
function AccountPausedOverlay() {
  return (
    <div className="flex-1 flex items-center justify-center bg-background p-8">
      <div className="max-w-md w-full space-y-6 text-center">
        <div className="w-16 h-16 rounded-3xl bg-amber-500/10 flex items-center justify-center mx-auto">
          <PauseCircle className="w-8 h-8 text-amber-400" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-black uppercase tracking-widest text-white">
            Account Paused
          </h2>
          <p className="text-[11px] font-medium text-slate-400 leading-relaxed">
            Your subscription is currently paused. All data is fully retained
            but broker access is suspended until billing is resumed.
          </p>
        </div>
        <div className="rounded-2xl bg-amber-500/5 border border-amber-500/20 px-5 py-4 text-left space-y-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">
            To resume access
          </p>
          <p className="text-[10px] font-medium text-slate-500">
            Contact{' '}
            <a href="mailto:support@aegissage.com" className="text-amber-400 hover:text-amber-300 font-bold">
              support@aegissage.com
            </a>
            {' '}to reactivate your subscription.
          </p>
        </div>
        <Link
          href="/settings/billing"
          className="inline-block text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-300 transition-colors"
        >
          View Billing Settings →
        </Link>
      </div>
    </div>
  )
}

// ── No-profile setup overlay ──────────────────────────────────────────────────
// Shown when the user is authenticated but has no agency or broker row.
// This happens when provisionAgency failed silently at signup time.
function NoProfileSetup({
  provisioning,
  error,
  onSetup,
}: {
  provisioning: boolean
  error: string | null
  onSetup: () => void
}) {
  return (
    <div className="h-screen w-screen bg-background flex items-center justify-center p-8 antialiased">
      <div className="max-w-sm w-full space-y-6 text-center">
        <Logo iconOnly className="mx-auto scale-125" />
        <div className="space-y-2">
          <h2 className="text-xl font-black uppercase tracking-tight text-white">
            Complete Account Setup
          </h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Your account was created but the initial setup didn&apos;t fully complete.
            Click below to finish setting up your workspace.
          </p>
        </div>

        {error && (
          <div className="rounded-2xl bg-red-500/10 border border-red-500/30 px-4 py-3 text-left">
            <p className="text-[11px] font-bold text-red-300">{error}</p>
            <p className="text-[10px] text-red-400/60 mt-1">
              If this keeps failing, contact{' '}
              <a href="mailto:support@aegissage.com" className="underline">support@aegissage.com</a>
            </p>
          </div>
        )}

        <Button
          onClick={onSetup}
          disabled={provisioning}
          className="w-full h-14 rounded-2xl bg-primary hover:bg-primary/90 font-black uppercase tracking-widest text-sm"
        >
          {provisioning ? (
            <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Setting Up…</>
          ) : (
            'Set Up My Account'
          )}
        </Button>
      </div>
    </div>
  )
}

export function AppShell({ children, sidebar }: { children: React.ReactNode; sidebar?: React.ReactNode }) {
  const pathname  = usePathname() ?? ''
  const router    = useRouter()
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [accountStatus,  setAccountStatus]  = useState<string | null>(null)
  // Tracks authenticated users who have no agency/broker profile yet
  const [noProfile,      setNoProfile]      = useState(false)
  const [authUserId,     setAuthUserId]     = useState<string | null>(null)
  const [authUserMeta,   setAuthUserMeta]   = useState<Record<string, any>>({})
  const [provisioning,   setProvisioning]   = useState(false)
  const [provisionError, setProvisionError] = useState<string | null>(null)

  const isProtectedRoute = PROTECTED_PREFIXES.some(p => pathname.startsWith(p))
  const isExcluded = !isProtectedRoute

  const isMobile = useIsMobile()
  const { isSidebarOpen, toggleSidebar, isRosterOpen, toggleRoster, updateAgencyProfile } = useAppStore()

  useEffect(() => {
    if (isExcluded) {
      setIsCheckingAuth(false)
      return
    }

    const supabase = createClient()
    let mounted = true

    const loadUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()

        if (!mounted) return

        if (!user) {
          router.push('/login')
          setIsCheckingAuth(false)
          return
        }

        // ── Owner path: full agency row for Zustand store ───────────────────
        const { data: agency } = await supabase
          .from('agencies')
          .select('*')
          .eq('owner_id', user.id)
          .maybeSingle()

        let resolvedStatus: string | null = agency?.subscription_status ?? null
        let hasBrokerProfile = false

        if (agency && mounted) {
          updateAgencyProfile(agency as Parameters<typeof updateAgencyProfile>[0])
        }

        // ── Broker path: resolve parent agency status for non-owners ────────
        if (!agency) {
          const { data: brokerRow } = await supabase
            .from('brokers')
            .select('agency_id')
            .eq('user_id', user.id)
            .maybeSingle()

          if (brokerRow?.agency_id) {
            hasBrokerProfile = true
            const { data: parentAgency } = await supabase
              .from('agencies')
              .select('subscription_status')
              .eq('id', brokerRow.agency_id)
              .maybeSingle()
            resolvedStatus = parentAgency?.subscription_status ?? null
          }
        }

        if (!mounted) return

        // ── No profile detected ─────────────────────────────────────────────
        // User is authenticated but has no agency or broker row. This happens
        // when provisionAgency failed silently at signup time. Surface a setup
        // prompt so the user can re-run provisioning without contacting support.
        if (!agency && !hasBrokerProfile) {
          setAuthUserId(user.id)
          setAuthUserMeta((user.user_metadata as Record<string, any>) ?? {})
          setNoProfile(true)
          setIsCheckingAuth(false)
          return
        }

        // ── MFA gate ────────────────────────────────────────────────────────
        // HIPAA §164.312(d): require multi-factor authentication before any
        // PHI-bearing dashboard route is accessible. Skip check on the MFA
        // setup page itself to avoid an infinite redirect loop.
        if (!pathname.startsWith('/auth/mfa-setup')) {
          const { data: mfaData } = await supabase.auth.mfa.listFactors()
          const enrolled = (mfaData?.totp ?? []).some(f => f.status === 'verified')
          if (!enrolled) {
            router.replace('/auth/mfa-setup')
            return
          }
        }

        // ── Lifecycle gate ──────────────────────────────────────────────────
        if (resolvedStatus === 'deleted') {
          router.replace('/account-deleted')
          return
        }

        setAccountStatus(resolvedStatus)
        setIsCheckingAuth(false)
      } catch (err) {
        console.error('[AppShell] auth check failed:', err)
        if (mounted) {
          // Never leave the user on a blank screen due to an unexpected error.
          // Render the shell with null account status as a safe fallback.
          setAccountStatus(null)
          setIsCheckingAuth(false)
        }
      }
    }

    loadUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        router.push('/login')
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [isExcluded, router, updateAgencyProfile])

  // ── Provision handler ─────────────────────────────────────────────────────
  // Called from NoProfileSetup when the user clicks "Set Up My Account".
  const handleProvision = async () => {
    if (!authUserId) return
    setProvisioning(true)
    setProvisionError(null)
    try {
      const fullName = ((authUserMeta.full_name as string | undefined) ?? '').trim()
      const parts = fullName.split(/\s+/).filter(Boolean)
      const firstName = parts[0] ?? 'User'
      const lastName  = parts.slice(1).join(' ') || firstName
      const accountType = (authUserMeta.account_type as string | undefined) ?? 'broker'
      const role = accountType === 'agency' ? 'agency_owner' : 'solo_broker'
      console.log('[AppShell] re-provision: accountType=', accountType, 'role=', role, 'userId=', authUserId)

      await provisionAgency({
        userId:          authUserId,
        firstName,
        lastName,
        agencyName:      null,
        phone:           '',
        role,
        tpmoCertifiedAt: new Date().toISOString(),
        billingPlan:     accountType === 'agency' ? 'agency' : 'broker-individual',
      })

      // Reload to re-run the auth check and pick up the new profile rows.
      window.location.reload()
    } catch (err: any) {
      console.error('[AppShell] provisioning failed:', err)
      setProvisionError(err?.message ?? 'Setup failed. Contact support@aegissage.com.')
      setProvisioning(false)
    }
  }

  if (isExcluded) {
    const showNavbar = pathname !== '/' && !NO_NAVBAR_PREFIXES.some(p => pathname.startsWith(p))
    return (
      <div className="h-screen w-screen overflow-y-auto bg-background antialiased">
        {showNavbar && <SiteNavbar />}
        {children}
      </div>
    )
  }

  if (isCheckingAuth) {
    return (
      <div className="h-screen w-screen bg-background p-6 antialiased">
        <div className="mx-auto flex h-full max-w-6xl flex-col justify-center gap-8">
          <div className="flex items-center gap-3">
            <Logo iconOnly />
            <div className="space-y-2">
              <Skeleton className="h-3 w-44 bg-white/10" />
              <Skeleton className="h-2 w-28 bg-white/5" />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-32 rounded-xl bg-white/10" />
            <Skeleton className="h-32 rounded-xl bg-white/10" />
            <Skeleton className="h-32 rounded-xl bg-white/10" />
          </div>
          <Skeleton className="h-72 rounded-xl bg-white/5" />
        </div>
      </div>
    )
  }

  // Show setup prompt for authenticated users with no profile rows
  if (noProfile) {
    return (
      <NoProfileSetup
        provisioning={provisioning}
        error={provisionError}
        onSetup={handleProvision}
      />
    )
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background antialiased flex-col md:flex-row">
      {isMobile && (
        <header className="h-14 border-b border-white/[0.07] bg-[hsl(var(--sidebar-background))] flex items-center justify-between px-4 shrink-0 z-50">
          <Logo iconOnly className="scale-75" />
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={toggleRoster}>
              <Users className="w-5 h-5 text-muted-foreground" />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={toggleSidebar}>
              <Menu className="w-5 h-5 text-muted-foreground" />
            </Button>
          </div>
        </header>
      )}

      {!isMobile && sidebar}

      {isMobile && (
        <Sheet open={isSidebarOpen} onOpenChange={toggleSidebar}>
          <SheetContent side="left" className="p-0 w-64 border-r-0">
            <SheetTitle className="sr-only">Main Navigation</SheetTitle>
            {sidebar}
          </SheetContent>
        </Sheet>
      )}

      {isMobile && (
        <Sheet open={isRosterOpen} onOpenChange={toggleRoster}>
          <SheetContent side="left" className="p-0 w-72 border-r-0">
            <SheetTitle className="sr-only">Member Roster</SheetTitle>
            <CollectionSidebar forceMobile />
          </SheetContent>
        </Sheet>
      )}

      <main className="flex-1 flex overflow-hidden relative">
        {accountStatus === 'paused' && pathname.startsWith('/dashboard') ? (
          <AccountPausedOverlay />
        ) : (
          children
        )}
      </main>
    </div>
  )
}
