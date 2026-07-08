import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';
import { CodingRoomClient } from '@/components/dashboard/coding-room-client';

export default function CodingRoom() {
  return (
    <WorkspaceScaffold
      title="Coding Room"
      icon="code2"
      accent="text-neon-cyan"
      blurb="Your engineering workspace — spec features, generate and review code, and run the sandboxed tool-runner. Codex is the brain here. Ask Claude in Chat to hand a build task to Codex, or dispatch one below."
    >
      <CodingRoomClient />
    </WorkspaceScaffold>
  );
}
