'use client';

import { useState } from 'react';
import { useAgentSocket } from '@/hooks/use-agent-socket';
import { AgentChat } from './agent-chat';
import { ChatHistoryPanel } from './chat-history-panel';
import { OptionsFlowPanel } from './options-flow-panel';
import { StagedIntentsPanel } from './staged-intents-panel';
import { DEFAULT_SYMBOL, TradingChart } from './trading-chart';
import { TradingAutonomyPanel } from './trading-autonomy-panel';
import { WatchlistPanel } from './quotes-panel';
import { PanelChrome } from '@/components/deck';
import { WidgetErrorBoundary } from './widget-error-boundary';

export function TradingRoomClient() {
  useAgentSocket();
  const [selectedSymbol, setSelectedSymbol] = useState(DEFAULT_SYMBOL);
  const handleSelectSymbol = (symbol: string) => setSelectedSymbol(symbol.trim().toUpperCase());

  return (
    <div className="grid h-[calc(100vh-8.5rem)] min-h-[47rem] grid-cols-1 gap-2 p-2 xl:grid-cols-12 xl:grid-rows-[minmax(24rem,1.22fr)_minmax(19rem,0.78fr)]">
      <div className="min-h-0 xl:col-span-8">
        <PanelChrome title="CHART" bodyClassName="p-0" className="h-full">
          <WidgetErrorBoundary name="Trading Chart">
            <TradingChart selectedSymbol={selectedSymbol} onSelectSymbol={handleSelectSymbol} />
          </WidgetErrorBoundary>
        </PanelChrome>
      </div>

      <div className="min-h-0 xl:col-span-4">
        <PanelChrome title="WATCHLIST" bodyClassName="p-0" className="h-full">
          <WidgetErrorBoundary name="Watchlist">
            <WatchlistPanel selectedSymbol={selectedSymbol} onSelectSymbol={handleSelectSymbol} />
          </WidgetErrorBoundary>
        </PanelChrome>
      </div>

      <div className="min-h-0 xl:col-span-8">
        <PanelChrome title="TRADING CHAT" bodyClassName="p-0" className="h-full">
          <WidgetErrorBoundary name="Trading Chat">
            <AgentChat
              variant="full"
              historyScope="trading"
              title="Trading Room"
              lanes={['TRADING', 'CODEX']}
              defaultLane="TRADING"
              emptyText="Ask for market thinking, watchlist analysis, or a plain-English risk read. Nothing here auto-trades."
            />
          </WidgetErrorBoundary>
        </PanelChrome>
      </div>

      <div className="min-h-0 xl:col-span-4">
        <div className="grid h-full min-h-0 grid-rows-[minmax(10rem,0.7fr)_minmax(6.5rem,0.45fr)_minmax(13rem,0.95fr)_minmax(10rem,0.7fr)] gap-2">
          <PanelChrome title="OPTIONS FLOW" bodyClassName="p-0" className="min-h-0">
            <WidgetErrorBoundary name="Options Flow">
              <OptionsFlowPanel selectedSymbol={selectedSymbol} onSelectSymbol={handleSelectSymbol} />
            </WidgetErrorBoundary>
          </PanelChrome>

          <PanelChrome title="STAGED INTENTS" bodyClassName="p-0" className="min-h-0">
            <WidgetErrorBoundary name="Staged Intents">
              <StagedIntentsPanel />
            </WidgetErrorBoundary>
          </PanelChrome>

          <PanelChrome title="AUTONOMY" bodyClassName="p-0" className="min-h-0">
            <WidgetErrorBoundary name="Trading Autonomy">
              <TradingAutonomyPanel />
            </WidgetErrorBoundary>
          </PanelChrome>

          <PanelChrome title="TRADING HISTORY" bodyClassName="p-0" className="min-h-0">
            <WidgetErrorBoundary name="Trading History">
              <ChatHistoryPanel scopes={[{ scope: 'trading', label: 'Trading' }]} maxItems={30} />
            </WidgetErrorBoundary>
          </PanelChrome>
        </div>
      </div>
    </div>
  );
}
