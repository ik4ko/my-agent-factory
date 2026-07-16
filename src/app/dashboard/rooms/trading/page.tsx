import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';
import { TradingRoomClient } from '@/components/dashboard/trading-room-client';

export default function TradingRoom() {
  return (
    <WorkspaceScaffold
      title="Trading Room"
      icon="linechart"
      accent="text-neon-green"
      blurb=""
    >
      <TradingRoomClient />
    </WorkspaceScaffold>
  );
}
