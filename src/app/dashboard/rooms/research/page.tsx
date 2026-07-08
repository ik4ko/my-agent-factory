import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';
import { ResearchRoomClient } from '@/components/dashboard/research-room-client';

export default function ResearchRoom() {
  return (
    <WorkspaceScaffold
      title="Research Room"
      icon="search"
      accent="text-neon-purple"
      blurb="Deep research and reconnaissance, led by Hermes with Scout assisting. Findings are grounded in trained knowledge and cached news events — the badge below tracks exactly what sources are in play."
    >
      <ResearchRoomClient />
    </WorkspaceScaffold>
  );
}
