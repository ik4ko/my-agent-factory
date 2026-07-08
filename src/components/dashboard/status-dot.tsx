'use client';

import { cn } from '@/lib/utils';
import type { AgentStatus } from '@/lib/types/database.types';

// One clean micro-neon glow accent per state, mapped consistently everywhere.
const STATUS_CONFIG: Record<
  AgentStatus,
  { color: string; ping: string; glow: string; label: string }
> = {
  idle:    { color: 'bg-neon-green',  ping: 'bg-neon-green',  glow: 'status-active', label: 'Idle' },
  busy:    { color: 'bg-neon-cyan',   ping: 'bg-neon-cyan',   glow: 'status-idle',   label: 'Busy' },
  error:   { color: 'bg-neon-red',    ping: 'bg-neon-red',    glow: 'status-error',  label: 'Error' },
  offline: { color: 'bg-muted-foreground/40', ping: '', glow: '', label: 'Offline' },
};

interface StatusDotProps {
  status: AgentStatus;
  size?: 'sm' | 'md';
  className?: string;
}

export function StatusDot({ status, size = 'md', className }: StatusDotProps) {
  const cfg = STATUS_CONFIG[status];
  const dotSize = size === 'sm' ? 'size-1.5' : 'size-2';
  const pingSize = size === 'sm' ? 'size-1.5' : 'size-2';

  return (
    <span className={cn('relative inline-flex', dotSize, className)}>
      {cfg.ping && (
        <span
          className={cn(
            'absolute inline-flex h-full w-full rounded-full opacity-75',
            cfg.ping,
            'animate-agent-ping'
          )}
        />
      )}
      <span className={cn('relative inline-flex rounded-full', dotSize, cfg.color, cfg.glow)} />
    </span>
  );
}
