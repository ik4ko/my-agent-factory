import type { Metadata } from 'next';
import { Cpu, MessageSquare, Code2, LineChart, Search, User, Settings, Zap, Repeat, Activity, PenSquare, Radio } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { MobileTabBar } from '@/components/dashboard/mobile-tab-bar';

export const metadata: Metadata = {
  title: 'Control Room',
};

const NAV_ITEMS = [
  { href: '/dashboard', icon: Cpu, label: 'Control Room', primary: true },
  { href: '/dashboard/results', icon: Activity, label: 'Results' },
  { href: '/dashboard/chat', icon: MessageSquare, label: 'Chat' },
  { href: '/dashboard/compose', icon: PenSquare, label: 'Compose' },
  { href: '/dashboard/comms', icon: Radio, label: 'Comms' },
  { href: '/dashboard/building', icon: Code2, label: 'App Building' },
  { href: '/dashboard/trading', icon: LineChart, label: 'Stock Trading' },
  { href: '/dashboard/loops', icon: Repeat, label: 'Loops' },
  { href: '/dashboard/research', icon: Search, label: 'Research' },
  { href: '/dashboard/personal', icon: User, label: 'Personal' },
];

function Sidebar() {
  return (
    <aside className="hidden h-dvh w-14 flex-col items-center gap-1 border-r border-border bg-sidebar py-3 md:flex">
      {/* Logo orb */}
      <div className="mb-2 flex size-8 items-center justify-center rounded-lg bg-primary/15 border border-primary/25 glow-green">
        <Zap className="size-4 text-primary" />
      </div>

      <div className="flex flex-1 flex-col items-center gap-1 w-full px-2">
        {NAV_ITEMS.map(({ href, icon: Icon, label, primary }) => (
          <Link
            key={href}
            href={href}
            title={label}
            className={cn(
              'flex size-9 items-center justify-center rounded-md transition-all duration-150',
              'text-sidebar-foreground/60 hover:text-foreground hover:bg-surface-2',
              primary && 'text-primary/80 hover:text-primary hover:bg-primary/10'
            )}
          >
            <Icon className="size-4" />
          </Link>
        ))}
      </div>

      <Link
        href="/dashboard/settings"
        title="Settings"
        className="flex size-9 items-center justify-center rounded-md text-sidebar-foreground/40 hover:text-foreground hover:bg-surface-2 transition-all duration-150"
      >
        <Settings className="size-4" />
      </Link>
    </aside>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar />
      <main className="flex flex-1 flex-col overflow-hidden pb-16 md:pb-0">{children}</main>
      <MobileTabBar />
    </div>
  );
}
