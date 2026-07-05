import { Search } from 'lucide-react';
import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';

export default function ResearchWorkspace() {
  return (
    <WorkspaceScaffold
      title="Research"
      icon={Search}
      accent="text-neon-purple"
      blurb="Deep research and reconnaissance, led by Hermes. Note: the agents currently reason from trained knowledge, not live web — wiring a real web-search tool is the next upgrade here. Ask Claude in Chat to send a research task to Hermes."
    />
  );
}
