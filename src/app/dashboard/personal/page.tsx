import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';
import { PersonalRoomClient } from '@/components/dashboard/personal-room-client';

export default function PersonalRoom() {
  return (
    <WorkspaceScaffold
      title="Personal Room"
      icon="user"
      accent="text-neon-orange"
      blurb=""
    >
      <PersonalRoomClient />
    </WorkspaceScaffold>
  );
}
