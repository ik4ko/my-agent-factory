'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Brain, RefreshCw } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Memory } from '@/lib/types/database.types';
import { formatDistanceToNow } from 'date-fns';

const IMPORTANCE_COLOR = (n: number) => {
  if (n >= 8) return 'text-neon-red';
  if (n >= 6) return 'text-neon-orange';
  if (n >= 4) return 'text-neon-cyan';
  return 'text-muted-foreground/40';
};

function ImportanceDots({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-0.5" title={`Importance ${value}/10`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'size-1.5 rounded-full',
            i < Math.round(value / 2) ? IMPORTANCE_COLOR(value) : 'bg-surface-3'
          )}
        />
      ))}
    </div>
  );
}

function MemoryRow({ mem }: { mem: Memory }) {
  const [expanded, setExpanded] = useState(false);
  const preview = JSON.stringify(mem.value).slice(0, 80);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -6 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="group rounded-md border border-transparent hover:border-border hover:bg-surface-1 px-3 py-2 cursor-pointer"
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-terminal text-[10px] text-primary truncate">{mem.key}</span>
            {mem.source && (
              <span className="font-terminal text-[9px] text-muted-foreground/30 shrink-0">
                /{mem.source}
              </span>
            )}
          </div>
          <p className="font-terminal text-[10px] text-muted-foreground/50 truncate">{preview}</p>
          {mem.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {mem.tags.map((tag) => (
                <span
                  key={tag}
                  className="font-terminal text-[9px] px-1 py-px rounded bg-surface-2 text-muted-foreground/40"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <ImportanceDots value={mem.importance} />
          <span className="font-terminal text-[9px] text-muted-foreground/25 tabular">
            v{mem.version}
          </span>
        </div>
      </div>

      {/* Expanded value */}
      <AnimatePresence>
        {expanded && (
          <motion.pre
            key="expanded"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="mt-2 overflow-hidden font-terminal text-[9px] text-foreground/40 bg-surface-2 rounded p-2 whitespace-pre-wrap break-all"
          >
            {JSON.stringify(mem.value, null, 2)}
          </motion.pre>
        )}
      </AnimatePresence>

      <div className="mt-1 font-terminal text-[9px] text-muted-foreground/20 text-right">
        {formatDistanceToNow(new Date(mem.updated_at), { addSuffix: true })}
      </div>
    </motion.div>
  );
}

export function MemoryViewer() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const supabase = createClient();

  const fetchMemory = useCallback(async (q: string) => {
    setLoading(true);
    const builder = supabase
      .from('memory')
      .select('*')
      .order('importance', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(40);

    const { data } = q.trim()
      ? await builder.ilike('key', `%${q.trim()}%`)
      : await builder;

    setMemories((data ?? []) as Memory[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void fetchMemory('');
  }, [fetchMemory]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => void fetchMemory(query), 300);
    return () => clearTimeout(t);
  }, [query, fetchMemory]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('memory-viewer')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'memory' }, () => {
        void fetchMemory(query);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase, query, fetchMemory]);

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2 shrink-0">
        <Brain className="size-3.5 text-neon-purple/70 shrink-0" />
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Memory</span>
        {!loading && (
          <span className="font-terminal text-[10px] text-muted-foreground/40">
            ({memories.length})
          </span>
        )}
        <button
          onClick={() => void fetchMemory(query)}
          className="ml-auto text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"
        >
          <RefreshCw className="size-3" />
        </button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface-1 px-2 py-1.5 shrink-0">
        <Search className="size-3 text-muted-foreground/30 shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memory keys…"
          className="flex-1 bg-transparent font-terminal text-[10px] text-foreground placeholder:text-muted-foreground/20 outline-none"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto space-y-0.5 -mx-1 px-1">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-3 py-2 space-y-1.5">
              <Skeleton className="h-2 w-2/3" />
              <Skeleton className="h-2 w-full" />
            </div>
          ))
        ) : memories.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <span className="font-terminal text-xs text-muted-foreground/30">
              {query ? 'No matching memories' : 'Memory bank empty'}
            </span>
          </div>
        ) : (
          <AnimatePresence mode="popLayout" initial={false}>
            {memories.map((mem) => (
              <MemoryRow key={mem.id} mem={mem} />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
