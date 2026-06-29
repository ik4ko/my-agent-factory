'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Volume2, VolumeX } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useTTS } from '@/hooks/use-tts';
import { cn } from '@/lib/utils';
import type { Task } from '@/lib/types/database.types';

function buildBriefing(task: Task): string {
  const desc = task.description
    ? task.description.slice(0, 120).replace(/```[\s\S]*?```/g, 'code').trim()
    : 'Task complete.';

  if (task.status === 'failed') {
    return `Mission failed. Task: ${desc}`;
  }
  return `Mission complete. Task: ${desc}`;
}

interface BriefingEntry {
  id: string;
  text: string;
  timestamp: number;
}

export function AudioBriefing() {
  const { speak, stop, isSupported } = useTTS();
  const [enabled, setEnabled] = useState(false);
  const [lastBriefing, setLastBriefing] = useState<BriefingEntry | null>(null);
  const supabase = createClient();
  const briefedRef = useRef<Set<string>>(new Set());

  const deliverBriefing = useCallback(
    (task: Task) => {
      if (!enabled || briefedRef.current.has(task.id)) return;
      briefedRef.current.add(task.id);
      const text = buildBriefing(task);
      speak(text, { rate: 0.95, pitch: 0.75 });
      setLastBriefing({ id: task.id, text, timestamp: Date.now() });
    },
    [enabled, speak]
  );

  useEffect(() => {
    const channel = supabase
      .channel('audio-briefing')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tasks' },
        (payload) => {
          const task = payload.new as Task;
          if (task.status === 'completed' || task.status === 'failed') {
            deliverBriefing(task);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase, deliverBriefing]);

  useEffect(() => {
    if (!lastBriefing) return;
    const t = setTimeout(() => setLastBriefing(null), 8000);
    return () => clearTimeout(t);
  }, [lastBriefing]);

  if (!isSupported) return null;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => {
          if (enabled) stop();
          setEnabled((v) => !v);
        }}
        title={enabled ? 'Disable audio briefings' : 'Enable audio briefings'}
        className={cn(
          'flex items-center gap-1 font-terminal text-[10px] transition-colors duration-150',
          enabled
            ? 'text-neon-cyan animate-glow-pulse'
            : 'text-muted-foreground/30 hover:text-muted-foreground/60'
        )}
      >
        {enabled ? <Volume2 className="size-3" /> : <VolumeX className="size-3" />}
        <span className="hidden sm:inline">{enabled ? 'AUDIO ON' : 'AUDIO'}</span>
      </button>

      <AnimatePresence>
        {lastBriefing && enabled && (
          <motion.span
            key={lastBriefing.id}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="font-terminal text-[10px] text-neon-cyan/60 truncate max-w-[200px] hidden md:block"
          >
            ▶ {lastBriefing.text.slice(0, 60)}…
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
