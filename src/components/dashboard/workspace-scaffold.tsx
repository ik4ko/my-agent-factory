'use client';

import Link from 'next/link';
import {
  MessageSquare,
  Activity,
  BookOpen,
  Code2,
  LineChart,
  PenSquare,
  Radio,
  Repeat,
  Search,
  Settings,
  ShieldCheck,
  User,
  type LucideIcon,
} from 'lucide-react';

/**
 * Shared shell for the dedicated task workspaces (Results, Compose, Comms,
 * Go-Live, App Building, Trading, Loops, Research, Personal, Settings).
 *
 * `icon` is a STRING KEY, not a component reference — a Server Component
 * page passing a raw Lucide component (a function) as a prop into this
 * Client Component crosses the RSC serialization boundary and breaks with
 * "Functions cannot be passed directly to Client Components". Every page.tsx
 * must pass one of the keys in ICON_REGISTRY below, resolved to the actual
 * component here, inside the client boundary.
 */
export const ICON_REGISTRY = {
  activity: Activity,
  bookopen: BookOpen,
  code2: Code2,
  linechart: LineChart,
  pensquare: PenSquare,
  radio: Radio,
  repeat: Repeat,
  search: Search,
  settings: Settings,
  shieldcheck: ShieldCheck,
  user: User,
} satisfies Record<string, LucideIcon>;

export type WorkspaceIconKey = keyof typeof ICON_REGISTRY;

export function WorkspaceScaffold({
  title,
  blurb,
  icon,
  accent = 'text-primary',
  children,
}: {
  title: string;
  blurb: string;
  icon: WorkspaceIconKey;
  accent?: string;
  children?: React.ReactNode;
}) {
  const Icon = ICON_REGISTRY[icon];
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <Icon className={`size-4 ${accent}`} />
          <span className="font-display text-sm font-semibold tracking-wide text-foreground/90">{title}</span>
        </div>
        <Link
          href="/dashboard/chat"
          className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-terminal text-[10px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <MessageSquare className="size-3" /> ASK CLAUDE
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{blurb}</p>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
