'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Repeat, Menu, X, Cpu, Code2, LineChart, User, Settings, Video } from 'lucide-react';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/dashboard', icon: Cpu, label: 'Main' },
  { href: '/dashboard/rooms/trading', icon: LineChart, label: 'Trading' },
  { href: '/dashboard/rooms/coding', icon: Code2, label: 'Coding' },
  { href: '/dashboard/personal', icon: User, label: 'Personal' },
  { href: '/dashboard/rooms/youtube', icon: Video, label: 'YouTube' },
];

const MORE_ITEMS = [
  { href: '/dashboard/loops', icon: Repeat, label: 'Loops' },
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
