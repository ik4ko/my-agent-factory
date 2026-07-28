import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';
import { MedicareRoomClient } from '@/components/dashboard/medicare-room-client';

export default function MedicareRoom() {
  return (
    <WorkspaceScaffold
      title="Medicare CRM"
      icon="shieldcheck"
      accent="text-neon-cyan"
      blurb="Book of business, carrier relationships, imports, and compliance readiness for an independent Medicare practice."
    >
      <MedicareRoomClient />
    </WorkspaceScaffold>
  );
}
