'use client';

import { memo, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Brain, RefreshCw, Copy, Check, Maximize2, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Memory } from '@/lib/types/database.types';
import { formatDistanceToNow } from 'date-fns';

// ---------------------------------------------------------------------------
// Inspector — modal drawer with pretty-printed JSON, one-click copy, and a
// line search across keys AND values (matching lines highlighted, count shown).
// ---------------------------------------------------------------------------

function MemoryInspector({ mem, onClose }: { mem: Memory; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [lineQuery, setLineQuery] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);

  const pretty = useMemo(() => JSON.stringify(mem.value, null, 2) ?? 'null', [mem.value]);
  const jsonLines = useMemo(() => pretty.split('\n'), [pretty]);
  const q = lineQuery.trim().toLowerCase();
  const matchCount = q ? jsonLines.filter((l) => l.toLowerCase().includes(q)).length : 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pretty);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (permissions) — button simply stays inert */
    }
  };

  // Esc closes; focus lands on the close button when opened.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Memory record ${mem.key}`}
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-neon-purple/30 bg-surface-1 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Brain className="size-3.5 shrink-0 text-neon-purple/70" aria-hidden />
          <span className="truncate font-terminal text-xs text-primary">{mem.key}</span>
          {mem.updated_at && (
            <span className="shrink-0 font-terminal text-[10px] text-muted-foreground/40">
              {formatDistanceToNow(new Date(mem.updated_at), { addSuffix: true })}
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              onClick={copy}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-terminal text-[10px] text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:text-foreground"
              aria-label="Copy JSON to clipboard"
            >
              {copied ? <Check className="size-3 text-neon-green" /> : <Copy className="size-3" />}
              {copied ? 'copied' : 'copy'}
            </button>
            <button
              ref={closeRef}
              onClick={onClose}
              aria-label="Close inspector"
              className="rounded p-1 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2">
          <Search className="size-3 shrink-0 text-muted-foreground/30" aria-hidden />
          <input
            value={lineQuery}
            onChange={(e) => setLineQuery(e.target.value)}
            placeholder="Search keys / values in this record…"
            aria-label="Search keys and values in this record"
            className="flex-1 bg-transparent font-terminal text-[10px] text-foreground placeholder:text-muted-foreground/25 outline-none"
          />
          {q && (
            <span className={cn('shrink-0 font-terminal text-[10px]', matchCount > 0 ? 'text-neon-green' : 'text-neon-red/70')}>
              {matchCount} line{matchCount === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <pre className="flex-1 overflow-auto px-4 py-3 font-terminal text-[10px] leading-relaxed">
          {jsonLines.map((line, i) => {
            const hit = q !== '' && line.toLowerCase().includes(q);
            return (
              <div
                key={i}
                className={cn(
                  'whitespace-pre-wrap break-all',
                  hit ? 'bg-neon-purple/15 text-foreground' : q ? 'text-foreground/30' : 'text-foreground/70'
                )}
              >
                {line}
              </div>
            );
          })}
        </pre>

        <div className="flex items-center gap-3 border-t border-border px-4 py-2 font-terminal text-[9px] text-muted-foreground/40">
          <span>id {mem.id.slice(0, 8)}…</span>
          {mem.source && <span>source {mem.source}</span>}
          {Array.isArray(mem.tags) && mem.tags.length > 0 && <span>tags {mem.tags.join(', ')}</span>}
        </div>
      </div>
    </div>
  );
}

const MemoryRow = memo(function MemoryRow({ mem, onInspect }: { mem: Memory; onInspect: (m: Memory) => void }) {
  const preview = JSON.stringify(mem.value).slice(0, 80);
  const ts = mem.updated_at
    ? formatDistanceToNow(new Date(mem.updated_at), { addSuffix: true })
    : '—';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -6 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <button
        onClick={() => onInspect(mem)}
        aria-label={`Inspect memory record ${mem.key}`}
        title="Open in inspector — pretty JSON, copy, key/value search"
        className="group w-full rounded-md border border-transparent px-3 py-2 text-left transition-colors hover:border-border hover:bg-surface-1"
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <span className="block truncate font-terminal text-[10px] text-primary">{mem.key}</span>
            <p className="truncate font-terminal text-[10px] text-muted-foreground/50">{preview}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="mt-0.5 font-terminal text-[9px] text-muted-foreground/25">{ts}</span>
            <Maximize2 className="size-2.5 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/50" aria-hidden />
          </div>
        </div>
      </button>
    </motion.div>
  );
});

export function MemoryViewer() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [inspecting, setInspecting] = useState<Memory | null>(null);
  const supabase = createClient();

  // Fetch a window of recent records; searching filters CLIENT-side across
  // both keys and stringified values, so "kelly" finds records whose key
  // never mentions it.
  const fetchMemory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: dbError } = await supabase
        .from('memory')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(100);
      if (dbError) throw dbError;
      setMemories((data ?? []) as Memory[]);
    } catch (e) {
      setMemories([]);
      setError(e instanceof Error ? e.message : 'Memory fetch failed');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    // Data fetch on mount. The loader is async and sets state around an await;
    // this is React's documented pattern for loading data in a client component,
    // not derived state feeding a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchMemory();
  }, [fetchMemory]);

  useEffect(() => {
    const channel = supabase
      .channel('memory-viewer')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'memory' }, () => {
        void fetchMemory();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, fetchMemory]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return memories;
    return memories.filter(
      (m) => m.key.toLowerCase().includes(q) || JSON.stringify(m.value).toLowerCase().includes(q)
    );
  }, [memories, q]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2 shrink-0">
        <Brain className="size-3.5 text-neon-purple/70 shrink-0" />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Memory</span>
        {!loading && (
          <span className="font-terminal text-[10px] text-muted-foreground/40">
            ({q ? `${filtered.length}/${memories.length}` : memories.length})
          </span>
        )}
        <button
          onClick={() => void fetchMemory()}
          suppressHydrationWarning={true}
          aria-label="Refresh memory records"
          className="ml-auto text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
        >
          <RefreshCw className="size-3" />
        </button>
      </div>

      <div className={cn(
        'flex items-center gap-2 rounded-md border border-border bg-surface-1 px-2 py-1.5 shrink-0',
      )}>
        <Search className="size-3 text-muted-foreground/30 shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          suppressHydrationWarning={true}
          placeholder="Search keys and values…"
          aria-label="Search memory keys and values"
          className="flex-1 bg-transparent font-terminal text-[10px] text-foreground placeholder:text-muted-foreground/20 outline-none"
        />
      </div>

      <div className="flex-1 overflow-y-auto space-y-0.5 -mx-1 px-1">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-3 py-2 space-y-1.5">
              <Skeleton className="h-2 w-2/3" />
              <Skeleton className="h-2 w-full" />
            </div>
          ))
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <span className="font-terminal text-xs text-neon-red/70" title={error}>Memory fetch failed</span>
            <button
              onClick={() => void fetchMemory()}
              className="rounded border border-border px-2 py-1 font-terminal text-[10px] text-muted-foreground hover:text-foreground"
            >
              retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <span className="font-terminal text-xs text-muted-foreground/30">
              {q ? `No records match "${query.trim()}" in keys or values` : 'Memory bank empty'}
            </span>
          </div>
        ) : (
          <AnimatePresence mode="popLayout" initial={false}>
            {filtered.map((mem) => (
              <MemoryRow key={mem.id} mem={mem} onInspect={setInspecting} />
            ))}
          </AnimatePresence>
        )}
      </div>

      {inspecting && <MemoryInspector mem={inspecting} onClose={() => setInspecting(null)} />}
    </div>
  );
}
