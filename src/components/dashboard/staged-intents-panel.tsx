'use client';

import { FileText, Loader2, ShieldCheck } from 'lucide-react';
import { useStagedOrders } from '@/hooks/use-staged-orders-query';
import type { StagedOrderRow } from '@/lib/types/database.types';
import { cn } from '@/lib/utils';

/**
 * Read-only Trading Room marker for validated, SANDBOX-staged option intents.
 *
 * This is a pure viewer over the existing pending staged-order query — no
 * mutation, no endpoint of its own, no broker path. It exists so a staged
 * OptionOrderIntent produced by the deterministic parser/validator is visible
 * and trustworthy in the room, not just buried in the dashboard brain scene.
 * Every row is decision-only: nothing here submits anything.
 */

function relativeTime(value: string | null | undefined): string {
  if (!value) return 'just now';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'just now';
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusClass(status: StagedOrderRow['human_approval_status']): string {
  if (status === 'DENIED') return 'border-neon-red/40 text-neon-red/80';
  if (status === 'APPROVED') return 'border-neon-green/40 text-neon-green/80';
  return 'border-warning/40 text-warning';
}

export function StagedIntentsPanel() {
  const { data: staged = [], isLoading, error } = useStagedOrders();
  const intents = staged.filter((order) => order.intent_kind === 'option_intent');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <FileText className="size-3.5 text-primary" aria-hidden />
        <span className="font-terminal text-[10px] uppercase tracking-widest text-muted-foreground">Staged intents</span>
        <span className="ml-auto flex items-center gap-1 rounded border border-neon-green/35 px-1.5 py-px font-terminal text-[8.5px] uppercase tracking-wider text-neon-green/80">
          <ShieldCheck className="size-2.5" aria-hidden /> sandbox · not live
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <p className="flex items-center gap-2 py-4 font-terminal text-[10px] text-muted-foreground/45">
            <Loader2 className="size-3 animate-spin" aria-hidden /> loading staged intents...
          </p>
        ) : error ? (
          <p className="rounded border border-neon-red/30 bg-neon-red/[0.05] p-2 font-terminal text-[10px] text-neon-red/80">
            {error instanceof Error ? error.message : 'staged intents unavailable'}
          </p>
        ) : intents.length === 0 ? (
          <p className="py-4 text-center font-terminal text-[10px] text-muted-foreground/40">
            No staged option intents awaiting a verdict.
          </p>
        ) : (
          <div className="space-y-1.5">
            {intents.map((intent) => {
              const premium = intent.max_premium_usd ?? 0;
              const loss = intent.max_loss_usd ?? 0;
              return (
                <div key={intent.id} className="row-hover rounded-md border border-border/[0.08] bg-surface-1/50 px-2.5 py-2">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 font-terminal text-[9px] uppercase tracking-wider">
                    <span className="text-primary">{intent.action ?? 'action?'}</span>
                    <span className="text-foreground">
                      {intent.contracts ?? '?'}x {intent.underlying} {intent.strike ?? '?'} {intent.option_type}
                    </span>
                    <span className="text-muted-foreground/50">{intent.expiration ?? 'exp?'}</span>
                    <span className={cn('rounded border px-1 py-px', statusClass(intent.human_approval_status))}>
                      {intent.human_approval_status}
                    </span>
                    <span className="ml-auto shrink-0 text-muted-foreground/35">{relativeTime(intent.created_at)}</span>
                  </div>
                  <p className="text-[10px] leading-relaxed text-foreground/80">
                    @ {Number(intent.limit_price ?? 0).toFixed(2)} {intent.price_effect ?? ''} · max premium ${Math.round(premium).toLocaleString()} · max loss ${Math.round(loss).toLocaleString()}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 font-terminal text-[9px]">
                    {intent.strategy_label && (
                      <span className="rounded border border-primary/35 px-1.5 py-px text-primary/80">{intent.strategy_label}</span>
                    )}
                    {intent.source_signal_id && (
                      <span className="rounded border border-border/70 px-1.5 py-px text-muted-foreground/55">
                        signal {String(intent.source_signal_id).slice(0, 8)}
                      </span>
                    )}
                    <span className="rounded border border-neon-green/30 px-1.5 py-px text-neon-green/70">decision only</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
