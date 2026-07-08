'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Activity, Repeat, MessageSquare, Menu, X, Cpu, Code2, LineChart, Search, User, Settings, PenSquare, ShieldCheck, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/dashboard/results', icon: Activity, label: 'Results' },
  { href: '/dashboard/loops', icon: Repeat, label: 'Loops' },
  { href: '/dashboard/chat', icon: MessageSquare, label: 'Chat' },
];

const MORE_ITEMS = [
  { href: '/dashboard/golive', icon: ShieldCheck, label: 'Go-Live' },
  { href: '/dashboard/docs', icon: BookOpen, label: 'Runbook' },
  { href: '/dashboard', icon: Cpu, label: 'Control Room' },
  { href: '/dashboard/compose', icon: PenSquare, label: 'Compose' },
  { href: '/dashboard/rooms/trading', icon: LineChart, label: 'Trading Room' },
  { href: '/dashboard/rooms/coding', icon: Code2, label: 'Coding Room' },
  { href: '/dashboard/rooms/research', icon: Search, label: 'Research Room' },
  { href: '/dashboard/rooms/analytics', icon: Activity, label: 'Analytics Room' },
  { href: '/dashboard/personal', icon: User, label: 'Personal' },
  { href: '/dashboard/settings', icon: Settings, label: 'Settings' },
];

/** Mobile-only bottom tab bar (hidden ≥ md, where the desktop sidebar takes
 *  over). Touch targets are >= 44px per the mobile-PWA requirement. */
export function MobileTabBar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-40 flex items-end bg-background/80 backdrop-blur-sm md:hidden" onClick={() => setMoreOpen(false)}>
          <div
            className="w-full rounded-t-xl border-t border-border bg-surface-1 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 pb-2">
              <span className="font-terminal text-xs uppercase tracking-widest text-muted-foreground">More</span>
              <button onClick={() => setMoreOpen(false)} className="flex size-11 items-center justify-center text-muted-foreground">
                <X className="size-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1 px-2">
              {MORE_ITEMS.map(({ href, icon: Icon, label }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  className="flex min-h-11 flex-col items-center justify-center gap-1 rounded-md p-3 text-center text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                >
                  <Icon className="size-5" />
                  <span className="text-[10px]">{label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden">
        {TABS.map(({ href, icon: Icon, label }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-muted-foreground/60',
                active && 'text-primary'
              )}
            >
              <Icon className="size-5" />
              <span className="text-[10px]">{label}</span>
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          className="flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-muted-foreground/60"
        >
          <Menu className="size-5" />
          <span className="text-[10px]">More</span>
        </button>
      </nav>
    </>
  );
}
