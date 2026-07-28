import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';
import { YoutubeRoomClient } from '@/components/dashboard/youtube-room-client';

export default function YoutubeRoom() {
  return (
    <WorkspaceScaffold
      title="YouTube Room"
      icon="video"
      accent="text-neon-red"
      blurb=""
    >
      <YoutubeRoomClient />
    </WorkspaceScaffold>
  );
}
