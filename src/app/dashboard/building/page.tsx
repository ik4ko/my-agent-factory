import { Code2 } from 'lucide-react';
import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';

export default function BuildingWorkspace() {
  return (
    <WorkspaceScaffold
      title="App Building"
      icon={Code2}
      accent="text-neon-cyan"
      blurb="Your engineering workspace — spec features, generate and review code, and run the sandboxed tool-runner. Codex is the brain here. Ask Claude in Chat to hand a build task to Codex, or dispatch one with /run in the Control Room."
    />
  );
}
