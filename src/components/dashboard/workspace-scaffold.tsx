'use client';

import {
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
 * Shared shell for the dedicated room/utility workspaces. Applies the
 * command-desk visual system once (glass surface, hairline border, strict
 * overflow containment) so every room reads as one system: the container is
 * overflow-hidden and the body owns the single internal scroll region — zero
 * page-level scrollbars.
 *
 * `icon` is a STRING KEY, not a component reference — a Server Component page
 * passing a raw Lucide component across the RSC boundary breaks with
 * "Functions cannot be passed directly to Client Components".
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
    <div className="flex h-full flex-col overflow-hidden">
      <header className="hairline-b flex h-11 shrink-0 items-center gap-2 px-4 surface-glass">
        <Icon className={`size-4 ${accent}`} aria-hidden />
        <span className="font-display text-sm font-semibold tracking-wide text-foreground/90">{title}</span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {blurb.trim() && <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground/80">{blurb}</p>}
        <div className={blurb.trim() ? 'mt-4' : ''}>{children}</div>
      </div>
    </div>
  );
}
