import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';
import { GoLiveClient } from '@/components/dashboard/golive-client';

export default function GoLiveWorkspace() {
  return (
    <WorkspaceScaffold
      title="Go-Live"
      icon="shieldcheck"
      accent="text-neon-red"
      blurb="The single switch for real money. Arm is disabled until preflight is all-green, and even then requires your PIN plus an explicit confirmation of exactly what will happen. Kill is always available, no matter what preflight says."
    >
      <GoLiveClient />
    </WorkspaceScaffold>
  );
}
