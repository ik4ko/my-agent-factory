import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';
import { LoopsClient } from '@/components/dashboard/loops-client';

export default function LoopsWorkspace() {
  return (
    <WorkspaceScaffold
      title="Loops"
      icon="repeat"
      accent="text-neon-cyan"
      blurb="Standing objectives the system re-evaluates on a cadence and reacts to events with. Trade-kind loops record paper decisions through the simulation adapter; no live broker path exists."
    >
      <LoopsClient />
    </WorkspaceScaffold>
  );
}
