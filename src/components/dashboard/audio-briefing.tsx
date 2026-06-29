'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Volume2, VolumeX } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useTTS } from '@/hooks/use-tts';
import { cn } from '@/lib/utils';
import type { Task } from '@/lib/types/database.types';

const AGENT_CALLSIGN: Record<string, string> = {
  coder:      'Codex',
  researcher: 'Scout',
  browser:    'Phantom',
  planner:    'Architect',
  generic:    'Hermes',
};

function buildBriefing(task: Task): string {
  const result = task.result as Record<string, unknown> | null;
  const agentType = (result?.agentType as string) ?? 'generic';
  const callsign = AGENT_CALLSIGN[agentType] ?? 'Agent';
  const preview = typeof result?.output === 'string'
    ? result.output.slice(0, 200).replace(/```[\s\S]*?```/g, 'code block').trim()
    : 'Task complete.';

  return `${callsign} reporting. Mission complete. ${preview}`;
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
  // Track tasks we've already briefed to avoid duplicates on reconnect
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

  // Auto-clear briefing banner after 8 s
  useEffect(() => {
    if (!lastBriefing) return;
    const t = setTimeout(() => setLastBriefing(null), 8000);
    return () => clearTimeout(t);
  }, [lastBriefing]);

  if (!isSupported) return null;

  return (
    <div className="flex items-center gap-2">
      {/* Toggle button */}
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

      {/* Briefing banner */}
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
