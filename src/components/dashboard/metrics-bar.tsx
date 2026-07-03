'use client';

import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Coins, DollarSign, Gauge } from 'lucide-react';
import { useMetricsQuery } from '@/hooks/use-metrics-query';
import { FABLE_SHARE_CAP } from '@/lib/agents/model-router';
import { summarizeSpend, shortModel } from '@/lib/telemetry/pricing';
import { cn } from '@/lib/utils';

function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

/**
 * Fable-5 allocation meter vs the 20% network-share cap.
 * < 75% of cap → emerald · 75–95% → amber glow · ≥ 95% → red flash.
 */
const FableMeter = memo(function FableMeter({ share }: { share: number }) {
  const pctOfCap = share / FABLE_SHARE_CAP; // 1.0 == at the cap
  const level = pctOfCap >= 0.95 ? 'critical' : pctOfCap >= 0.75 ? 'warning' : 'ok';

  return (
    <div className="flex items-center gap-2 min-w-0">
      <Gauge
        className={cn(
          'size-3 shrink-0',
          level === 'ok' && 'text-neon-green',
          level === 'warning' && 'text-neon-orange animate-glow-pulse',
          level === 'critical' && 'text-neon-red animate-glow-pulse'
        )}
      />
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 hidden md:block">
        Fable&nbsp;24h
      </span>
      <div className="relative h-1.5 w-24 sm:w-32 overflow-hidden rounded-full bg-surface-3">
        {/* cap marker at 100% of the bar (bar spans 0 → cap) */}
        <motion.div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full',
            level === 'ok' && 'bg-neon-green/80',
            level === 'warning' && 'bg-neon-orange shadow-neon-sm animate-glow-pulse',
            level === 'critical' && 'bg-neon-red shadow-neon-red animate-glow-pulse'
          )}
          initial={false}
          animate={{ width: `${Math.min(pctOfCap, 1) * 100}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </div>
      <span
        className={cn(
          'font-terminal text-xs tabular font-semibold',
          level === 'ok' && 'text-neon-green',
          level === 'warning' && 'text-neon-orange',
          level === 'critical' && 'text-neon-red animate-glow-pulse'
        )}
      >
        {(share * 100).toFixed(1)}%
      </span>
      <span className="text-[10px] text-muted-foreground/40 font-terminal">/ {FABLE_SHARE_CAP * 100}%</span>
    </div>
  );
});

export function MetricsBar() {
  const { data: metrics = [], isLoading } = useMetricsQuery();
  const spend = useMemo(() => summarizeSpend(metrics), [metrics]);

  const perModel = Object.entries(spend.byModel)
    .filter(([, v]) => v.tokens > 0)
    .sort((a, b) => b[1].tokens - a[1].tokens);

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-1/60 px-3 py-1.5 overflow-x-auto">
      <div className="flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-1.5">
          <Coins className="size-3 text-neon-cyan" />
          <span className="font-terminal text-xs tabular font-semibold text-neon-cyan">
            {isLoading ? '…' : fmtTokens(spend.totalTokens)}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 hidden sm:block">
            tok&nbsp;24h
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <DollarSign className="size-3 text-neon-green" />
          <span className="font-terminal text-xs tabular font-semibold text-neon-green">
            {isLoading ? '…' : spend.totalCostUsd.toFixed(spend.totalCostUsd >= 10 ? 2 : 3)}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60 hidden sm:block">
            est&nbsp;cost
          </span>
        </div>

        {/* per-model breakdown chips */}
        <div className="hidden lg:flex items-center gap-1.5">
          {perModel.map(([model, v]) => (
            <span
              key={model}
              className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-terminal text-[10px] text-muted-foreground/70"
            >
              {shortModel(model)}&nbsp;{fmtTokens(v.tokens)}
            </span>
          ))}
        </div>
      </div>

      <FableMeter share={spend.fableShare} />
    </div>
  );
}
