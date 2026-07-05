import { Radio } from 'lucide-react';
import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';
import { CommsSimulatorClient } from '@/components/dashboard/comms-simulator-client';

export default function CommsWorkspace() {
  return (
    <WorkspaceScaffold
      title="Comms"
      icon={Radio}
      accent="text-neon-cyan"
      blurb="A phone-style console that drives the real command core (status/pnl/positions/loops/arm/disarm/kill/halt/resume/new/pause) with no Twilio account needed. Every notification the system sends streams into the feed on the right, live."
    >
      <CommsSimulatorClient />
    </WorkspaceScaffold>
  );
}
