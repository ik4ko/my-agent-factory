"use client"

import * as React from "react"
import {
  LayoutDashboard, Users, FileCheck, Radar, Megaphone,
  UserPlus, Shield, Settings, LifeBuoy, LogOut, Bell, Database,
} from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Logo } from "./logo"
import { useAppStore } from '@/lib/store'
import { languages } from '@/lib/i18n'

// ── Nav item type ─────────────────────────────────────────────────────────────

type NavItem = { href: string; icon: React.ElementType; label: string; desc: string; badge?: number }

// ── Route definitions ─────────────────────────────────────────────────────────

/**
 * AGENCY OWNER full nav — multi-seat plan ($749/mo)
 * Includes Dashboard overview, VCC Forms, and Campaigns.
 */
const AGENCY_CORE_NAV: NavItem[] = [
  { href: '/dashboard',              icon: LayoutDashboard, label: 'Dashboard',        desc: 'Real-time monitoring' },
  { href: '/dashboard/book',         icon: Users,           label: 'Book of Business', desc: 'All monitored clients' },
  { href: '/dashboard/alerts',       icon: Bell,            label: 'Alerts',           desc: 'Switch & plan change alerts' },
  { href: '/dashboard/churn/upload', icon: Radar,           label: 'Import Data',      desc: 'CSV, Sheets, or GHL import' },
  { href: '/dashboard/vcc',          icon: FileCheck,       label: 'VCC Forms',        desc: 'Doctor-signed carrier forms' },
  { href: '/dashboard/campaigns',    icon: Megaphone,       label: 'Campaigns',        desc: 'Maya AI outreach campaigns' },
]

/**
 * AGENCY OWNER management nav — full control plane.
 * Team management (seat add/remove) is owner-only.
 */
const OWNER_MGMT_NAV: NavItem[] = [
  { href: '/dashboard/team',    icon: UserPlus,  label: 'Team',       desc: 'Manage brokers & seats' },
  { href: '/dashboard/manager', icon: Shield,    label: 'Agency View',desc: 'Revenue & compliance overview' },
  { href: '/dashboard/admin',   icon: Database,  label: 'Directory',  desc: 'Global client search & fax monitor' },
]

/**
 * MANAGER / CSR operational support nav — agency-wide visibility, no seat control.
 * agency_admin and customer_service see Agency View but NOT Team management.
 */
const STAFF_MGMT_NAV: NavItem[] = [
  { href: '/dashboard/manager', icon: Shield, label: 'Agency View', desc: 'Agency-wide oversight' },
]

/**
 * SOLO BROKER nav — stripped to the three features they pay for.
 * No Dashboard overview (no agency-wide stats), no Team management, no Agency View.
 * VCC Forms and Campaigns are available to all authenticated roles.
 */
const BROKER_CORE_NAV: NavItem[] = [
  { href: '/dashboard/book',         icon: Users,      label: 'My Clients',    desc: 'Your monitored book' },
  { href: '/dashboard/alerts',       icon: Bell,       label: 'Active Alerts', desc: 'Switch & plan change alerts' },
  { href: '/dashboard/churn/upload', icon: Radar,      label: 'Import Data',   desc: 'CSV, Sheets, or GHL import' },
  { href: '/dashboard/vcc',          icon: FileCheck,  label: 'VCC Forms',     desc: 'Doctor-signed carrier forms' },
  { href: '/dashboard/campaigns',    icon: Megaphone,  label: 'Campaigns',     desc: 'Maya AI outreach campaigns' },
]

const FOOTER_NAV: NavItem[] = [
  { href: '/settings', icon: Settings, label: 'Settings', desc: 'Workspace settings' },
]

// ── NavLink component ─────────────────────────────────────────────────────────

function NavLink({ item, isActive, isOpen }: { item: NavItem; isActive: boolean; isOpen: boolean }) {
  const showBadge = (item.badge ?? 0) > 0
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={item.href}
          className={cn(
            "flex items-center rounded-xl transition-all duration-150 group relative",
            isOpen ? "px-3 py-2.5 gap-3" : "justify-center py-3",
            isActive
              ? "bg-primary/[0.12] text-primary font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] border border-primary/20"
              : "text-slate-500 hover:bg-[hsl(var(--sidebar-accent))] hover:text-white border border-transparent"
          )}
        >
          <div className="relative shrink-0">
            <item.icon className={cn(
              "w-4.5 h-4.5",
              isActive ? "text-primary" : "text-slate-500 group-hover:text-slate-200"
            )} />
            {showBadge && !isOpen && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-3.5 rounded-full bg-red-500 text-[8px] font-black text-white flex items-center justify-center px-0.5">
                {(item.badge ?? 0) > 99 ? '99+' : item.badge}
              </span>
            )}
          </div>
          {isOpen && (
            <>
              <span className="text-[11px] font-bold uppercase tracking-widest truncate flex-1">{item.label}</span>
              {showBadge && (
                <span className="min-w-[18px] h-4 rounded-full bg-red-500 text-[8px] font-black text-white flex items-center justify-center px-1">
                  {(item.badge ?? 0) > 99 ? '99+' : item.badge}
                </span>
              )}
            </>
          )}
        </a>
      </TooltipTrigger>
      {!isOpen && (
        <TooltipContent side="right">
          <p className="font-bold text-xs uppercase">{item.label}</p>
          <p className="text-[10px] opacity-70">{item.desc}</p>
        </TooltipContent>
      )}
    </Tooltip>
  )
}

// ── Section divider ───────────────────────────────────────────────────────────

function SectionDivider({ label, isOpen }: { label: string; isOpen: boolean }) {
  return (
    <div className={cn("pt-4 pb-2", isOpen ? "px-3" : "flex justify-center")}>
      {isOpen
        ? <p className="text-[9px] font-black uppercase tracking-widest text-slate-600">{label}</p>
        : <div className="w-4 h-px bg-white/10" />
      }
    </div>
  )
}

// ── SidebarNav props ──────────────────────────────────────────────────────────

export interface SidebarNavProps {
  /**
   * isOwner = user owns an agency row (owner_id = uid).
   * Controls whether Team management (seat add/remove) is shown.
   */
  isOwner: boolean
  /**
   * isStaff = user is agency_admin or customer_service (non-owner elevated role).
   * Staff see the full operational nav including Agency View, but not Team.
   */
  isStaff?: boolean
  /**
   * isBrokerTier = the agency is on the solo/broker pricing tier.
   * Broker-tier users always see the stripped 3-item nav regardless of role.
   */
  isBrokerTier: boolean
  role: string
  name: string
  email: string
  criticalAlerts?: number
}

export function SidebarNav({
  isOwner,
  isStaff = false,
  isBrokerTier,
  role,
  name,
  email,
  criticalAlerts = 0,
}: SidebarNavProps) {
  const pathname  = usePathname()
  const router    = useRouter()
  const isOpen    = true
  const { language, setLanguage, resetStore } = useAppStore()

  async function handleSignOut() {
    // POST to the logout route first: it writes the SESSION_END audit event
    // and invalidates the Supabase session server-side before we navigate away.
    await fetch('/api/auth/logout', { method: 'POST' })
    // Clear all user-specific in-memory state before navigation so that a
    // second user logging in on the same device never sees the previous
    // user's agency profile, member data, or encryption key.
    resetStore()
    router.push('/login')
  }

  const isActive = (href: string) =>
    href === '/dashboard'
      ? pathname === '/dashboard'
      : (pathname?.startsWith(href) ?? false)

  // ── Three-profile nav fork ────────────────────────────────────────────────
  //
  //  Profile A — AGENCY OWNER (isOwner && !isBrokerTier)
  //    Full core nav + Management section (Team + Agency View)
  //
  //  Profile B — MANAGER / CSR (isStaff && !isBrokerTier)
  //    Full core nav + Agency View only (no Team / seat management)
  //
  //  Profile C — BROKER / BROKER-TIER (everyone else)
  //    Stripped 3-item nav (My Clients, Alerts, Import Data)
  //
  const showFullNav    = !isBrokerTier && (isOwner || isStaff)
  const showOwnerMgmt  = isOwner && !isBrokerTier   // Team + Agency View
  const showStaffMgmt  = isStaff && !isBrokerTier   // Agency View only
  const coreNavBase    = showFullNav ? AGENCY_CORE_NAV : BROKER_CORE_NAV

  // Inject alert badge
  const coreNav = coreNavBase.map(item =>
    item.href === '/dashboard/alerts'
      ? { ...item, badge: criticalAlerts > 0 ? criticalAlerts : undefined }
      : item
  )

  const roleLabel =
    role === 'agency_owner'     ? 'Owner'
    : role === 'agency_admin'   ? 'Manager'
    : role === 'customer_service' ? 'CS'
    : 'Broker'

  const roleBadgeCls =
    role === 'agency_owner'   ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
    : role === 'agency_admin' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
    : 'bg-slate-800 text-slate-400 border-slate-700'

  return (
    <TooltipProvider delayDuration={0}>
      <div className={cn(
        "flex flex-col bg-[hsl(var(--sidebar-background))] border-r border-[hsl(var(--sidebar-border))] h-full shrink-0 z-50 overflow-hidden transition-all duration-300 ease-in-out relative",
        isOpen ? "w-64" : "w-16"
      )}>

        {/* ── Brand + role chip ────────────────────────────────────────────── */}
        <div className={cn(
          "p-4 flex items-center shrink-0 h-16 border-b border-[hsl(var(--sidebar-border))]",
          isOpen ? "justify-between" : "justify-center px-0"
        )}>
          {isOpen
            ? <a href="/dashboard" className="flex items-center gap-2"><Logo className="scale-90" /></a>
            : <Logo iconOnly className="scale-75" />
          }
          {isOpen && (
            <span className={cn(
              "text-[7px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border shrink-0",
              roleBadgeCls
            )}>
              {roleLabel}
            </span>
          )}
        </div>

        {/* ── Main nav ─────────────────────────────────────────────────────── */}
        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto pt-4">

          {/* Core nav items */}
          {coreNav.map(item => (
            <NavLink key={item.href} item={item} isActive={isActive(item.href)} isOpen={isOpen} />
          ))}

          {/* Profile A — Owner: Team + Agency View */}
          {showOwnerMgmt && (
            <>
              <SectionDivider label="Management" isOpen={isOpen} />
              {OWNER_MGMT_NAV.map(item => (
                <NavLink key={item.href} item={item} isActive={isActive(item.href)} isOpen={isOpen} />
              ))}
            </>
          )}

          {/* Profile B — Manager / CSR: Agency View only (no seat management) */}
          {showStaffMgmt && (
            <>
              <SectionDivider label="Support" isOpen={isOpen} />
              {STAFF_MGMT_NAV.map(item => (
                <NavLink key={item.href} item={item} isActive={isActive(item.href)} isOpen={isOpen} />
              ))}
            </>
          )}
        </nav>

        {/* ── CMS disclaimer ───────────────────────────────────────────────── */}
        {isOpen && (
          <div className="px-4 py-3 border-t border-[hsl(var(--sidebar-border))]">
            <p className="text-[8px] font-bold text-slate-600 leading-tight uppercase tracking-wider">
              Not affiliated with or endorsed by the U.S. government or the federal Medicare program.
            </p>
          </div>
        )}

        {/* ── Footer nav ───────────────────────────────────────────────────── */}
        <div className="p-3 border-t border-[hsl(var(--sidebar-border))] space-y-0.5">
          {FOOTER_NAV.map(item => (
            <NavLink key={item.href} item={item} isActive={isActive(item.href)} isOpen={isOpen} />
          ))}
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/support"
                className={cn(
                  "flex items-center rounded-xl transition-all duration-150 group text-slate-400 hover:bg-white/5 hover:text-white",
                  isOpen ? "px-3 py-2.5 gap-3" : "justify-center py-3"
                )}
              >
                <LifeBuoy className="w-5 h-5 shrink-0 text-slate-400 group-hover:text-white" />
                {isOpen && <span className="text-[11px] font-bold uppercase tracking-widest">Support</span>}
              </Link>
            </TooltipTrigger>
            {!isOpen && (
              <TooltipContent side="right">
                <p className="font-bold text-xs uppercase">Support</p>
              </TooltipContent>
            )}
          </Tooltip>
        </div>

        {/* ── User profile dropdown ─────────────────────────────────────────── */}
        <div className="p-3 border-t border-[hsl(var(--sidebar-border))]">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className={cn(
                "w-full flex items-center rounded-xl transition-all duration-150 hover:bg-[hsl(var(--sidebar-accent))] group",
                isOpen ? "px-3 py-2.5 gap-3" : "justify-center py-3"
              )}>
                <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary text-[10px] font-black shrink-0">
                  {name?.charAt(0)?.toUpperCase() ?? 'U'}
                </div>
                {isOpen && (
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-[11px] font-bold text-white truncate">{name}</p>
                    <p className="text-[9px] text-slate-500 truncate">{email}</p>
                  </div>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="right"
              align="end"
              sideOffset={8}
              className="w-60 rounded-2xl p-2 bg-[hsl(var(--surface-3))] border-[hsl(var(--sidebar-border))] shadow-2xl shadow-black/40"
            >
              <DropdownMenuLabel className="px-3 py-2">
                <p className="text-sm font-bold text-white">{name}</p>
                <p className="text-[10px] text-slate-400">{email}</p>
                <span className="mt-1.5 inline-block text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                  {roleLabel}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-slate-800" />
              <div className="px-3 py-2">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-2">Language</p>
                <div className="flex gap-1.5">
                  {languages.map(lang => (
                    <button
                      key={lang.code}
                      onClick={() => setLanguage(lang.code as 'en' | 'es')}
                      className={cn(
                        "flex-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                        language === lang.code
                          ? "bg-primary/20 text-primary"
                          : "text-slate-500 hover:text-slate-300 hover:bg-slate-800"
                      )}
                    >
                      {lang.code.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <DropdownMenuSeparator className="bg-slate-800" />
              <DropdownMenuItem
                onClick={handleSignOut}
                className="mx-1 rounded-xl text-red-400 hover:bg-red-500/10 hover:text-red-300 cursor-pointer gap-2 font-bold text-[11px] uppercase tracking-widest"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  )
}
