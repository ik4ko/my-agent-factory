import { PenSquare } from 'lucide-react';
import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';
import { ComposeClient } from '@/components/dashboard/compose-client';

export default function ComposeWorkspace() {
  return (
    <WorkspaceScaffold
      title="Compose"
      icon={PenSquare}
      accent="text-neon-purple"
      blurb="Author a standing loop from your phone — name, objective, cadence, and event triggers. New loops are created paused; arm here or from Loops/Results when ready."
    >
      <ComposeClient />
    </WorkspaceScaffold>
  );
}
