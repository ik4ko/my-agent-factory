'use client';

import { cn } from '@/lib/utils';
import type { AgentStatus } from '@/lib/types/database.types';

/**
 * State coding (terminal spec):
 *   idle → cyan #06b6d4 with faint pulse
 *   busy → purple #a855f7, steady
 *   error → red · offline → muted
 */
const STATUS_CONFIG: Record<
  AgentStatus,
  { color: string; ping: string; pulse: boolean; label: string }
> = {
  idle:    { color: 'bg-neon-cyan',   ping: 'bg-neon-cyan',   pulse: true,  label: 'Idle' },
  busy:    { color: 'bg-neon-purple', ping: '',               pulse: false, label: 'Busy' },
  error:   { color: 'bg-neon-red',    ping: 'bg-neon-red',    pulse: false, label: 'Error' },
  offline: { color: 'bg-muted-foreground/40', ping: '', pulse: false, label: 'Offline' },
};

interface StatusDotProps {
  status: AgentStatus;
  size?: 'sm' | 'md';
  className?: string;
}

export function StatusDot({ status, size = 'md', className }: StatusDotProps) {
  const cfg = STATUS_CONFIG[status];
  const dotSize = size === 'sm' ? 'size-1.5' : 'size-2';

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
      <span
        className={cn(
          'relative inline-flex rounded-full',
          dotSize,
          cfg.color,
          cfg.pulse && 'animate-glow-pulse'
        )}
      />
    </span>
  );
}
