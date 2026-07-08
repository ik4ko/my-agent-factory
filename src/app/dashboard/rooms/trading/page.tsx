import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';
import { TradingRoomClient } from '@/components/dashboard/trading-room-client';

/** /dashboard/rooms/trading — the single consolidated surface for every
 *  stock/option/asset metric: ticker matrix, live chart, execution-safety
 *  panel, and Kelly-sized staging approvals. */
export default function TradingRoom() {
  return (
    <WorkspaceScaffold
      title="Trading Room"
      icon="linechart"
      accent="text-neon-green"
      blurb="Market analysis and staged orders. Agents produce research and quantitative angles; any actual order is STAGED for your approval before anything executes — never auto-traded. Ask Claude here to have Codex analyze a symbol or Hermes scout the news."
    >
      <TradingRoomClient />
    </WorkspaceScaffold>
  );
}
