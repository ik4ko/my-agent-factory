import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';
import { LoopsClient } from '@/components/dashboard/loops-client';

export default function LoopsWorkspace() {
  return (
    <WorkspaceScaffold
      title="Loops"
      icon="repeat"
      accent="text-neon-cyan"
      blurb="Standing objectives the system re-evaluates on a cadence and reacts to events with. Trade-kind loops record a decision only — no execution adapter is wired yet, so nothing here places a real order until Phase 2 lands."
    >
      <LoopsClient />
    </WorkspaceScaffold>
  );
}
