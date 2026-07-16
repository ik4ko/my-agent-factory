import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';
import { CodingRoomClient } from '@/components/dashboard/coding-room-client';

export default function CodingRoom() {
  return (
    <WorkspaceScaffold
      title="Coding Room"
      icon="code2"
      accent="text-neon-cyan"
      blurb=""
    >
      <CodingRoomClient />
    </WorkspaceScaffold>
  );
}
