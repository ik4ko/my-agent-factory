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
import { WorkspaceGrid, type WorkspacePanelDef } from '@/components/deck/workspace-grid';
import { WidgetErrorBoundary } from './widget-error-boundary';

// Default arrangement mirrors the previous fixed grid: chart + watchlist on
// top, chat wide below, utility stack on the right. h is in 40px grid rows.
const DEFAULT_LAYOUTS = {
  lg: [
    { i: 'chart', x: 0, y: 0, w: 8, h: 9, minW: 4, minH: 6 },
    { i: 'watchlist', x: 8, y: 0, w: 4, h: 9, minW: 2, minH: 4 },
    { i: 'chat', x: 0, y: 9, w: 8, h: 10, minW: 4, minH: 6 },
    { i: 'options', x: 8, y: 9, w: 4, h: 4, minW: 2, minH: 3 },
    { i: 'staged', x: 8, y: 13, w: 4, h: 3, minW: 2, minH: 2 },
    { i: 'autonomy', x: 8, y: 16, w: 4, h: 5, minW: 2, minH: 3 },
    { i: 'history', x: 8, y: 21, w: 4, h: 4, minW: 2, minH: 3 },
  ],
  md: [
    { i: 'chart', x: 0, y: 0, w: 8, h: 8 },
    { i: 'watchlist', x: 0, y: 8, w: 4, h: 6 },
    { i: 'options', x: 4, y: 8, w: 4, h: 6 },
    { i: 'chat', x: 0, y: 14, w: 8, h: 9 },
    { i: 'staged', x: 0, y: 23, w: 4, h: 4 },
    { i: 'autonomy', x: 4, y: 23, w: 4, h: 4 },
    { i: 'history', x: 0, y: 27, w: 8, h: 4 },
  ],
  sm: [
    { i: 'chart', x: 0, y: 0, w: 1, h: 8 },
    { i: 'watchlist', x: 0, y: 8, w: 1, h: 6 },
    { i: 'chat', x: 0, y: 14, w: 1, h: 9 },
    { i: 'options', x: 0, y: 23, w: 1, h: 5 },
    { i: 'staged', x: 0, y: 28, w: 1, h: 4 },
    { i: 'autonomy', x: 0, y: 32, w: 1, h: 5 },
    { i: 'history', x: 0, y: 37, w: 1, h: 4 },
  ],
};

export function TradingRoomClient() {
  useAgentSocket();
  const [selectedSymbol, setSelectedSymbol] = useState(DEFAULT_SYMBOL);
  const handleSelectSymbol = (symbol: string) => setSelectedSymbol(symbol.trim().toUpperCase());

  const panels: WorkspacePanelDef[] = [
    {
      id: 'chart',
      label: 'chart',
      node: (
        <PanelChrome title="CHART" glow bodyClassName="p-0" className="h-full">
          <WidgetErrorBoundary name="Trading Chart">
            <TradingChart selectedSymbol={selectedSymbol} onSelectSymbol={handleSelectSymbol} />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
    {
      id: 'watchlist',
      label: 'watchlist',
      node: (
        <PanelChrome title="WATCHLIST" bodyClassName="p-0" className="h-full">
          <WidgetErrorBoundary name="Watchlist">
            <WatchlistPanel selectedSymbol={selectedSymbol} onSelectSymbol={handleSelectSymbol} />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
    {
      id: 'chat',
      label: 'trading chat',
      node: (
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
      ),
    },
    {
      id: 'options',
      label: 'options flow',
      node: (
        <PanelChrome title="OPTIONS FLOW" bodyClassName="p-0" className="h-full">
          <WidgetErrorBoundary name="Options Flow">
            <OptionsFlowPanel selectedSymbol={selectedSymbol} onSelectSymbol={handleSelectSymbol} />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
    {
      id: 'staged',
      label: 'staged intents',
      node: (
        <PanelChrome title="STAGED INTENTS" bodyClassName="p-0" className="h-full">
          <WidgetErrorBoundary name="Staged Intents">
            <StagedIntentsPanel />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
    {
      id: 'autonomy',
      label: 'autonomy',
      node: (
        <PanelChrome title="AUTONOMY" bodyClassName="p-0" className="h-full">
          <WidgetErrorBoundary name="Trading Autonomy">
            <TradingAutonomyPanel />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
    {
      id: 'history',
      label: 'trading history',
      node: (
        <PanelChrome title="TRADING HISTORY" bodyClassName="p-0" className="h-full">
          <WidgetErrorBoundary name="Trading History">
            <ChatHistoryPanel scopes={[{ scope: 'trading', label: 'Trading' }]} maxItems={30} />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
  ];

  return (
    <div className="h-[calc(100vh-8.5rem)] overflow-y-auto p-2">
      <WorkspaceGrid room="trading" panels={panels} defaultLayouts={DEFAULT_LAYOUTS} />
    </div>
  );
}
