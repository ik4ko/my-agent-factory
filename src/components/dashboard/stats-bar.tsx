'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { Activity, CheckCircle2, Clock, Zap } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { AGENTS_KEY } from '@/hooks/use-agents-query';
import { TASKS_KEY } from '@/hooks/use-tasks-query';
import { LOGS_KEY } from '@/hooks/use-logs-query';
import type { Agent, Task, Log } from '@/lib/types/database.types';
import { cn } from '@/lib/utils';

function AnimatedNumber({ value }: { value: number }) {
  const mv = useMotionValue(value);
  const spring = useSpring(mv, { stiffness: 250, damping: 22 });
  const display = useTransform(spring, (v) => Math.round(v).toString());

  useEffect(() => { mv.set(value); }, [value, mv]);

  return <motion.span>{display}</motion.span>;
}

interface StatItemProps {
  icon: React.ElementType;
  label: string;
  value: number;
  color: string;
  highlight?: boolean;
}

function StatItem({ icon: Icon, label, value, color, highlight }: StatItemProps) {
  return (
    <motion.div
      layout
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-md',
        'transition-colors duration-200',
        highlight && value > 0 ? 'bg-surface-2' : 'bg-transparent'
      )}
    >
      <Icon className={cn('size-3 shrink-0', color)} />
      <span className={cn('font-terminal text-xs tabular font-semibold', color)}>
        <AnimatedNumber value={value} />
      </span>
      <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider hidden sm:block">
        {label}
      </span>
    </motion.div>
  );
}

function LogRate({ logs }: { logs: Log[] }) {
  const [rate, setRate] = useState(0);
  const windowRef = useRef<Log[]>([]);

  useEffect(() => {
    const cutoff = Date.now() - 60_000;
    windowRef.current = logs.filter((l) => new Date(l.timestamp).getTime() > cutoff);
    setRate(windowRef.current.length);
  }, [logs]);

  return (
    <div className="flex items-center gap-1.5 font-terminal text-[10px]">
      <div
        className={cn(
          'size-1.5 rounded-full',
          rate > 0 ? 'bg-neon-green animate-agent-ping' : 'bg-muted-foreground/30'
        )}
      />
      <span className="text-muted-foreground/50 tabular">
        <AnimatedNumber value={rate} />/min
      </span>
    </div>
  );
}

export function StatsBar() {
  const qc = useQueryClient();
  const agents = qc.getQueryData<Agent[]>(AGENTS_KEY) ?? [];
  const tasks  = qc.getQueryData<Task[]>(TASKS_KEY)   ?? [];
  const logs   = qc.getQueryData<Log[]>(LOGS_KEY)     ?? [];

  const [, forceRender] = useState(0);
  useEffect(() => {
    const unsubs = [AGENTS_KEY, TASKS_KEY, LOGS_KEY].map((key) =>
      qc.getQueryCache().subscribe((event) => {
        if (event.query.queryKey[0] === key[0]) forceRender((n) => n + 1);
      })
    );
    return () => unsubs.forEach((u) => u());
  }, [qc]);

  const idle    = agents.filter((a) => a.status === 'idle').length;
  const busy    = agents.filter((a) => a.status === 'busy').length;
  const errored = agents.filter((a) => a.status === 'error').length;

  const pending   = tasks.filter((t) => t.status === 'pending').length;
  const running   = tasks.filter((t) => t.status === 'running').length;
  const completed = tasks.filter((t) => t.status === 'completed').length;

  return (
    <motion.div
      layout
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border px-3 overflow-x-auto"
    >
      <StatItem icon={Activity}      label="idle"      value={idle}      color="text-neon-green"  highlight />
      <StatItem icon={Zap}           label="busy"      value={busy}      color="text-neon-cyan"   highlight />
      {errored > 0 && (
        <StatItem icon={Activity}    label="error"     value={errored}   color="text-neon-red"    highlight />
      )}

      <div className="mx-2 h-4 w-px bg-border/50 shrink-0" />

      <StatItem icon={Clock}         label="pending"   value={pending}   color="text-warning"     highlight />
      <StatItem icon={Zap}           label="running"   value={running}   color="text-neon-cyan"   highlight />
      <StatItem icon={CheckCircle2}  label="done"      value={completed} color="text-neon-green/60" />

      <div className="ml-auto shrink-0">
        <LogRate logs={logs} />
      </div>
    </motion.div>
  );
}
