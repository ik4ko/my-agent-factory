'use client';

import dynamic from 'next/dynamic';
import { useAgentSocket } from '@/hooks/use-agent-socket';
import { SimulationBanner } from './simulation-banner';
import { ExecutionSafetyBar } from './execution-safety-bar';
import { RiskPanel } from './risk-panel';
import { QuotesPanel } from './quotes-panel';
import { StagedOrders } from './staged-orders';
import { KellyInstrument } from './kelly-instrument';
import { AgentFleet } from './agent-fleet';
import { LiveTerminal } from './live-terminal';
import { PanelChrome } from '@/components/deck';
import { WidgetErrorBoundary } from './widget-error-boundary';

// lightweight-charts touches window/canvas at import time, so the canvas
// layer must never be server-rendered.
const TradingChart = dynamic(() => import('./trading-chart'), {
  ssr: false,
  loading: () => <div className="h-[440px] animate-pulse rounded-[6px] border border-border/90 bg-surface-2/40" />,
});

/**
 * Trading Room — the Instrument Deck layout (Trading Room.dc.html):
 * Execution Safety bar → SIM quotes ticker → a hairline instrument grid of
 * the rose Staged-Orders gate, the live price chart, and the Kelly-sizing
 * instrument, over a trading-scoped Fleet / Terminal / Risk row.
 *
 * This is a visual reskin: every data binding and safety gate is preserved —
 * the gate still records a real human verdict, the Kelly numbers are bound to
 * the real staged order, and the kill switch opens the real E-Stop flow.
 */
export function TradingRoomClient() {
  useAgentSocket();

  return (
    <div className="flex flex-col gap-2 p-2">
      <WidgetErrorBoundary name="Simulation">
        <SimulationBanner />
      </WidgetErrorBoundary>

      <WidgetErrorBoundary name="Execution Safety">
        <ExecutionSafetyBar />
      </WidgetErrorBoundary>

      <WidgetErrorBoundary name="Quotes">
        <QuotesPanel />
      </WidgetErrorBoundary>

      {/* Row 1 — the gate, the chart, the Kelly instrument */}
      <div className="grid grid-cols-1 gap-2 xl:grid-cols-12">
        <div className="min-h-[24rem] xl:col-span-3 xl:h-[30rem]">
          <WidgetErrorBoundary name="Staged Orders">
            <StagedOrders />
          </WidgetErrorBoundary>
        </div>

        <div className="min-w-0 xl:col-span-5 xl:h-[30rem]">
          <WidgetErrorBoundary name="Chart">
            <TradingChart />
          </WidgetErrorBoundary>
        </div>

        <div className="min-h-[24rem] xl:col-span-4 xl:h-[30rem]">
          <WidgetErrorBoundary name="Kelly Sizing">
            <KellyInstrument />
          </WidgetErrorBoundary>
        </div>
      </div>

      {/* Row 2 — trading-scoped fleet / terminal / risk */}
      <div className="grid grid-cols-1 gap-2 xl:grid-cols-12">
        <div className="h-[21rem] min-w-0 xl:col-span-3">
          <PanelChrome title="FLEET · TRADING" bodyClassName="p-0" className="h-full">
            <WidgetErrorBoundary name="Trading Fleet">
              <AgentFleet scope="trading" />
            </WidgetErrorBoundary>
          </PanelChrome>
        </div>

        <div className="h-[21rem] min-w-0 xl:col-span-6">
          <PanelChrome title="TERMINAL · TRADING" bodyClassName="p-0" className="h-full">
            <WidgetErrorBoundary name="Trading Terminal">
              <LiveTerminal scope="trading" />
            </WidgetErrorBoundary>
          </PanelChrome>
        </div>

        <div className="h-[21rem] min-w-0 overflow-y-auto xl:col-span-3">
          <WidgetErrorBoundary name="Risk">
            <RiskPanel />
          </WidgetErrorBoundary>
        </div>
      </div>
    </div>
  );
}
