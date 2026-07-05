'use client';

import Link from 'next/link';
import { MessageSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Shared shell for the dedicated task workspaces (App Building, Trading,
 * Research, Personal). Each page is a focused surface; for now they share a
 * header + a quick link into the Chat page scoped to that domain. Panels get
 * filled in per-workspace next.
 */
export function WorkspaceScaffold({
  title,
  blurb,
  icon: Icon,
  accent = 'text-primary',
  children,
}: {
  title: string;
  blurb: string;
  icon: LucideIcon;
  accent?: string;
  children?: React.ReactNode;
}) {
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
