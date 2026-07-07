'use client';

import dynamic from 'next/dynamic';
import { useAgentSocket } from '@/hooks/use-agent-socket';
import { SimulationBanner } from './simulation-banner';
import { RiskPanel } from './risk-panel';
import { QuotesPanel } from './quotes-panel';
import { StagedOrders } from './staged-orders';
import { AgentFleet } from './agent-fleet';
import { TaskFeed } from './task-feed';
import { LiveTerminal } from './live-terminal';
import { WidgetErrorBoundary } from './widget-error-boundary';

// lightweight-charts touches window/canvas at import time, so the canvas
// layer must never be server-rendered.
const TradingChart = dynamic(() => import('./trading-chart'), {
  ssr: false,
  loading: () => <div className="h-[440px] animate-pulse rounded-md border border-border bg-surface-2/40" />,
});

/**
 * Trading Room — the full trading chrome extracted from the Control Room:
 * trust banner, risk/PnL panel, live chart, quotes, human-approval order
 * queue, and trading-scoped fleet/task/terminal instances. Mounts the local
 * agent socket itself (the Control Room shell only lives on /dashboard).
 */
export function TradingRoomClient() {
  useAgentSocket();

  return (
    <div className="flex flex-col gap-3">
      <WidgetErrorBoundary name="Simulation">
        <SimulationBanner />
      </WidgetErrorBoundary>

      <WidgetErrorBoundary name="Risk">
        <RiskPanel />
      </WidgetErrorBoundary>

      <WidgetErrorBoundary name="Chart">
        <TradingChart />
      </WidgetErrorBoundary>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="min-w-0">
          <h2 className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Quotes</h2>
          <WidgetErrorBoundary name="Quotes">
            <QuotesPanel />
          </WidgetErrorBoundary>
        </section>

        <section className="min-w-0">
          <h2 className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Staged orders</h2>
          <p className="mb-1.5 font-terminal text-[10px] text-muted-foreground/50">
            Every proposal waits here for a human verdict — nothing auto-executes.
          </p>
          <WidgetErrorBoundary name="Staged Orders">
            <StagedOrders />
          </WidgetErrorBoundary>
        </section>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="h-[340px] min-w-0 rounded-md border border-border p-2.5">
          <WidgetErrorBoundary name="Trading Fleet">
            <AgentFleet scope="trading" />
          </WidgetErrorBoundary>
        </div>
        <div className="h-[340px] min-w-0 rounded-md border border-border p-2.5">
          <WidgetErrorBoundary name="Trading Tasks">
            <TaskFeed scope="trading" />
          </WidgetErrorBoundary>
        </div>
        <div className="h-[340px] min-w-0 rounded-md border border-border p-2.5">
          <WidgetErrorBoundary name="Trading Terminal">
            <LiveTerminal scope="trading" />
          </WidgetErrorBoundary>
        </div>
      </div>
    </div>
  );
}
