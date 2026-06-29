'use client';

import { cn } from '@/lib/utils';
import type { AgentStatus } from '@/lib/types/database.types';

const STATUS_CONFIG: Record<
  AgentStatus,
  { color: string; ping: string; label: string }
> = {
  idle:    { color: 'bg-neon-green',  ping: 'bg-neon-green',  label: 'Idle' },
  busy:    { color: 'bg-neon-cyan',   ping: 'bg-neon-cyan',   label: 'Busy' },
  error:   { color: 'bg-neon-red',    ping: 'bg-neon-red',    label: 'Error' },
  offline: { color: 'bg-muted-foreground/40', ping: '', label: 'Offline' },
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
      <span className={cn('relative inline-flex rounded-full', dotSize, cfg.color)} />
    </span>
  );
}
