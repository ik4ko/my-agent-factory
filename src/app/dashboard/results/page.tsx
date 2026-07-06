import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';
import { ResultsClient } from '@/components/dashboard/results-client';

export default function ResultsWorkspace() {
  return (
    <WorkspaceScaffold
      title="Results"
      icon="activity"
      accent="text-neon-green"
      blurb="Live P&L, positions, today's orders, and streaming loop runs — the primary mobile view. Nothing here is cached; the kill switch and arm/disarm toggle are PIN-gated and always visible."
    >
      <ResultsClient />
    </WorkspaceScaffold>
  );
}
