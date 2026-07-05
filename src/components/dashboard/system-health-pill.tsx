'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useBusThoughts, readProvenance } from './agent-activity';

/**
 * System health pill — federation status at a glance.
 *  green  FEDERATED — recent thoughts all ran via OpenRouter
 *  yellow DEGRADED  — at least one recent brain fell back to Anthropic
 *  muted  IDLE      — no thoughts observed yet this session
 */

const RECENT_WINDOW = 5;

export function SystemHealthPill() {
  // Cache-only consumer: AgentActivity owns the single bus channel; the pill
  // re-renders through the shared query cache. One socket, two observers.
  const thoughts = useBusThoughts(null);

  const health = useMemo(() => {
    const recent = thoughts.slice(0, RECENT_WINDOW).map(readProvenance);
    if (recent.length === 0) {
      return { label: 'BRAINS · IDLE', cls: 'border-border text-muted-foreground/50', dot: 'bg-muted-foreground/30', title: 'No agent thoughts observed yet' };
    }
    const fallback = recent.find((p) => p.provider === 'anthropic');
    if (fallback) {
      return {
        label: 'BRAINS · DEGRADED',
        cls: 'border-neon-orange/50 text-neon-orange',
        dot: 'bg-neon-orange animate-glow-pulse',
        title: `Provider fallback active — last fallback ran ${fallback.model} via Anthropic SDK`,
      };
    }
    return {
      label: 'BRAINS · FEDERATED',
      cls: 'border-neon-green/40 text-neon-green/90',
      dot: 'bg-neon-green',
      title: `Last ${recent.length} thought(s) routed via OpenRouter`,
    };
  }, [thoughts]);

  return (
    <span
      title={health.title}
      className={cn(
        'flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-terminal text-[9px] tracking-widest',
        health.cls,
      )}
    >
      <span className={cn('size-1.5 rounded-full', health.dot)} />
      {health.label}
    </span>
  );
}
