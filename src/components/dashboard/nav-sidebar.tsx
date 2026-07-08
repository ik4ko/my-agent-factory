'use client';

import { Cpu, Code2, LineChart, User, Settings, Zap, Repeat } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

// The four fixed rooms. Global ambient chat + E-STOP live in the shared
// layout, not the rail.
const NAV_ITEMS = [
  { href: '/dashboard', icon: Cpu, label: 'Main Dashboard', primary: true },
  { href: '/dashboard/rooms/trading', icon: LineChart, label: 'Trading Room' },
  { href: '/dashboard/rooms/coding', icon: Code2, label: 'Coding Room' },
  { href: '/dashboard/personal', icon: User, label: 'Personal Room' },
];

// Utility routes — retained but demoted below a divider (not rooms).
const UTILITY_ITEMS = [
  { href: '/dashboard/loops', icon: Repeat, label: 'Loops' },
  { href: '/dashboard/settings', icon: Settings, label: 'Settings' },
];

/**
 * Icon-only sidebar nav. Every item carries an aria-label + tooltip, and
 * exactly ONE item shows the active-state indicator (left edge bar +
 * aria-current), driven by the pathname — never by hover styling alone.
 */
export function NavSidebar() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="hidden h-full w-14 flex-col items-center gap-1 border-r border-border bg-sidebar py-3 md:flex">
      {/* Logo mark — pure decoration. Deliberately NOT styled like an active
          nav item (no glow, muted color): the ONLY "active" treatment in this
          rail is the aria-current item's edge bar below. */}
      <div className="mb-2 flex size-8 items-center justify-center rounded-lg border border-border bg-surface-2" aria-hidden>
        <Zap className="size-4 text-muted-foreground/50" />
      </div>

      <nav aria-label="Workspaces" className="flex flex-1 flex-col items-center gap-1 w-full px-2">
        {NAV_ITEMS.map(({ href, icon: Icon, label, primary }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex size-9 items-center justify-center rounded-md transition-all duration-150',
                'text-sidebar-foreground/60 hover:text-foreground hover:bg-surface-2',
                // Single source of truth for the active treatment: ONLY the
                // aria-current route lights up. `primary` used to apply an
                // always-on primary tint, which made Control Room read as
                // active on every subpage alongside the real active item.
                active && !primary && 'bg-surface-2 text-foreground',
                active && primary && 'bg-primary/10 text-primary'
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary"
                />
              )}
              <Icon className="size-4" aria-hidden />
            </Link>
          );
        })}
      </nav>

      {/* utility routes — demoted below a hairline divider */}
      <div className="my-1 h-px w-6 bg-border/60" aria-hidden />
      <div className="flex flex-col items-center gap-1 px-2 pb-1">
        {UTILITY_ITEMS.map(({ href, icon: Icon, label }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex size-9 items-center justify-center rounded-md text-sidebar-foreground/40 transition-all duration-150 hover:text-foreground hover:bg-surface-2',
                active && 'bg-surface-2 text-foreground'
              )}
            >
              {active && <span aria-hidden className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" />}
              <Icon className="size-4" aria-hidden />
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
