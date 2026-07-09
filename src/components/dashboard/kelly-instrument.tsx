'use client';

import { useStagedOrders } from '@/hooks/use-staged-orders-query';
import { PanelChrome } from '@/components/deck';
import type { StagedOrderRow } from '@/lib/types/database.types';

/**
 * Kelly Sizing instrument (Trading Room · Trading Room.dc.html §KELLY SIZING).
 *
 * Every figure is bound to the REAL top-of-queue staged order — the same row
 * the execution gate enforces — never a hardcoded mock:
 *   WIN PROB   ← win_rate
 *   PAYOFF     ← r_multiple
 *   FULL KELLY ← computed live from the row: ƒ* = W − (1−W)/R
 *   APPLIED    ← kelly_fraction (the stored, already-capped fraction)
 *   CAP        ← the staged_orders check-constraint ceiling (2% of book)
 *   POSITION   ← calculated_position_size_usd (→ shares via limit_price)
 *   EXPECTANCY ← expectancy (R)
 *
 * When the queue is empty the instrument idles — nothing to size.
 */
const BOOK_CAP = 0.02; // staged_orders CHECK: kelly_fraction ≤ 0.02

/** win_rate may be stored as a 0–1 fraction or an already-scaled percent. */
function toProbability(w: number): number {
  return w > 1 ? w / 100 : w;
}

function fullKelly(winRate: number, r: number): number | null {
  if (!(r > 0)) return null;
  const w = toProbability(winRate);
  return w - (1 - w) / r;
}

export function KellyInstrument() {
  const { data: pending = [], isLoading } = useStagedOrders();
  const order: StagedOrderRow | undefined = pending[0];

  return (
    <PanelChrome
      title="KELLY SIZING"
      headerRight={
        order ? (
          <span className="font-mono text-[8.5px] text-ink-mid">
            {order.underlying} {order.option_type.toLowerCase()} · staged
          </span>
        ) : (
          <span className="font-mono text-[8.5px] text-ink-low">idle</span>
        )
      }
      bodyClassName="p-3"
    >
      {isLoading ? (
        <div className="h-40 animate-pulse rounded-md bg-surface-2/40" />
      ) : !order ? (
        <div className="flex h-full min-h-[8rem] flex-col items-center justify-center gap-2 text-center">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-low">
            No staged position
          </span>
          <span className="max-w-[16rem] text-[11px] leading-relaxed text-ink-mid">
            The Kelly instrument sizes the next proposal the pipeline stages for your approval.
          </span>
        </div>
      ) : (
        <KellyReadout order={order} />
      )}
    </PanelChrome>
  );
}

function KellyReadout({ order }: { order: StagedOrderRow }) {
  const w = toProbability(order.win_rate);
  const r = order.r_multiple;
  const full = fullKelly(order.win_rate, r);
  const applied = order.kelly_fraction; // fraction of book, already capped
  const capBinds = applied >= BOOK_CAP - 1e-6;
  const gaugePct = Math.max(0, Math.min(1, applied / BOOK_CAP)) * 100;
  const shares = order.limit_price > 0 ? Math.round(order.calculated_position_size_usd / order.limit_price) : null;

  return (
    <div className="flex flex-col gap-3 font-mono">
      {/* Edge inputs */}
      <div className="grid grid-cols-2 gap-2">
        <Stat label="WIN PROB · EDGE" value={`${Math.round(w * 100)}`} unit="%" />
        <Stat label="PAYOFF RATIO" value={r.toFixed(1)} unit=":1" />
      </div>

      {/* Kelly derivation */}
      <div className="flex flex-col gap-2 rounded-[5px] border border-primary/[0.16] bg-primary/[0.03] p-[11px]">
        <Row label="FULL KELLY  ƒ* = W − (1−W)/R" value={full != null ? full.toFixed(2) : '—'} valueClass="text-primary-bright" />
        <Row label="APPLIED  ½ KELLY (capped)" value={applied.toFixed(4)} valueClass="text-ink-hi" />

        {/* fraction gauge vs book-risk cap */}
        <div className="mt-1 flex flex-col gap-1">
          <div className="relative h-2 overflow-visible rounded-full bg-ink-low/20">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary/40 to-primary"
              style={{ width: `${gaugePct}%` }}
            />
            {/* cap marker fixed at the 2% ceiling (right edge) */}
            <div className="absolute -top-[3px] -bottom-[3px] right-0 w-px bg-gate-soft" />
            <span className="absolute -top-[15px] right-0 translate-x-1/2 font-mono text-[7px] text-gate-soft">
              CAP {(BOOK_CAP * 100).toFixed(1)}%
            </span>
          </div>
          <span className="text-[8px] text-ink-low">
            {capBinds
              ? `book-risk cap binds → sized to ${(applied * 100).toFixed(1)}% of book`
              : `${(applied * 100).toFixed(1)}% of book · within ${(BOOK_CAP * 100).toFixed(1)}% cap`}
          </span>
        </div>
      </div>

      {/* Recommended position — the real staged size */}
      <div className="flex flex-col gap-[6px] rounded-[5px] border border-neon-green/25 bg-neon-green/[0.04] p-3">
        <span className="text-[8px] tracking-[0.16em] text-ink-low">RECOMMENDED POSITION</span>
        <div className="flex items-baseline gap-2">
          <span className="text-[20px] font-bold text-neon-green">
            {shares != null ? `${shares} ${order.underlying}` : order.underlying}
          </span>
          <span className="tabular text-[11px] text-ink-mid">
            ≈ ${Math.round(order.calculated_position_size_usd).toLocaleString()}
          </span>
        </div>
        <div className="flex flex-wrap gap-[5px] text-[8px]">
          <span className="rounded-[3px] border border-ink-low/25 px-[7px] py-[2px] text-ink-mid">
            {(applied * 100).toFixed(1)}% of book
          </span>
          <span className="rounded-[3px] border border-ink-low/25 px-[7px] py-[2px] text-ink-mid">
            expectancy {order.expectancy.toFixed(2)}R
          </span>
          <span className="rounded-[3px] border border-ink-low/25 px-[7px] py-[2px] text-ink-mid">
            {order.option_type} {order.strike} @ {order.limit_price.toFixed(2)}
          </span>
        </div>
        <span className="text-[8px] text-ink-low">→ staged as the order awaiting your approval</span>
      </div>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex flex-col gap-[3px] rounded-[5px] border border-ink-low/[0.16] bg-white/[0.012] px-[11px] py-[9px]">
      <span className="text-[8px] tracking-[0.12em] text-ink-low">{label}</span>
      <span className="tabular text-[18px] font-bold text-ink-hi">
        {value}
        <span className="text-[10px] text-ink-low">{unit}</span>
      </span>
    </div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[8.5px] tracking-[0.1em] text-ink-mid">{label}</span>
      <span className={`tabular text-[12px] font-bold ${valueClass}`}>{value}</span>
    </div>
  );
}
