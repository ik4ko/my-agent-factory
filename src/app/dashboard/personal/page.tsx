import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';
import { PersonalRoomClient } from '@/components/dashboard/personal-room-client';

export default function PersonalRoom() {
  return (
    <WorkspaceScaffold
      title="Personal Room"
      icon="user"
      accent="text-neon-orange"
      blurb="Administrative control, metrics management, and client tracking — isolated from the orchestration context. Compose audited client email, watch 24h model spend per lane, and reach the utility routes."
    >
      <PersonalRoomClient />
    </WorkspaceScaffold>
  );
}
