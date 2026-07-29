'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, CalendarCheck, Inbox, Search, SplitSquareHorizontal, Upload, Users, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Medicare room sub-navigation and global search.
 *
 * The room is a cockpit rather than one long page, so each concern gets a
 * route: a queue you work through, an inbox, the book of business, the
 * approval queue, and the pipeline's health. Only tabs that are actually built
 * appear here — a nav item leading to an empty shell teaches an operator to
 * distrust the nav.
 */

type Tab = { href: string; label: string; icon: LucideIcon; exact?: boolean };

const TABS: readonly Tab[] = [
  // `exact` only on Today: without it, the room root would light up on every
  // sub-route because they all start with its path.
  { href: '/dashboard/rooms/medicare', label: 'Today', icon: CalendarCheck, exact: true },
  { href: '/dashboard/rooms/medicare/leads', label: 'Website Leads', icon: Inbox },
  { href: '/dashboard/rooms/medicare/clients', label: 'Clients', icon: Users },
  { href: '/dashboard/rooms/medicare/coverage', label: 'Coverage Reviews', icon: SplitSquareHorizontal },
  { href: '/dashboard/rooms/medicare/imports', label: 'Imports', icon: Upload },
  { href: '/dashboard/rooms/medicare/bridge', label: 'Bridge Health', icon: Activity },
];

type SearchHit = {
  type: 'client' | 'lead';
  id: string;
  title: string;
  subtitle: string;
  detail: string;
  href: string;
};

export function MedicareRoomNav() {
  const pathname = usePathname();

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-2">
      <nav className="flex flex-wrap gap-1" aria-label="Medicare room sections">
        {TABS.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs transition',
                active
                  ? 'border-primary/60 bg-primary/10 text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
              )}
            >
              <Icon className="size-3.5" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <GlobalSearch />
    </div>
  );
}

function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const run = useCallback(async (value: string) => {
    if (value.trim().length < 2) {
      setHits([]);
      setNote(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/medicare-crm/search?q=${encodeURIComponent(value)}`, {
        cache: 'no-store',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'Search failed');
      setHits(body.hits ?? []);
      setNote(body.note ?? null);
    } catch {
      setHits([]);
      setNote('Search is unavailable.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced: an operator typing a surname would otherwise fire a query per
  // keystroke against tables holding client records.
  useEffect(() => {
    const timer = setTimeout(() => void run(query), 250);
    return () => clearTimeout(timer);
  }, [query, run]);

  // Close on outside click so results never linger over another view.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  return (
    <div ref={containerRef} className="relative min-w-56">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          className="h-8 w-full rounded border border-border bg-surface-2 pl-7 pr-7 text-xs text-foreground outline-none focus:border-primary/60"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}
          placeholder="Search name, phone, email, ID…"
          aria-label="Search clients and leads"
          autoComplete="off"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setHits([]);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="size-3.5" />
          </button>
        )}
      </label>

      {open && query.trim().length >= 2 && (
        <div className="absolute right-0 z-50 mt-1 max-h-80 w-80 overflow-y-auto rounded border border-border bg-surface-1 shadow-lg">
          {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>}
          {!loading && hits.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">{note ?? 'No matches.'}</div>
          )}
          {hits.map((hit) => (
            <Link
              key={`${hit.type}:${hit.id}`}
              href={hit.href}
              onClick={() => setOpen(false)}
              className="block border-b border-border/40 px-3 py-2 last:border-0 hover:bg-surface-2/60"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-foreground">{hit.title}</span>
                <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {hit.subtitle}
                </span>
              </div>
              {hit.detail && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{hit.detail}</div>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
