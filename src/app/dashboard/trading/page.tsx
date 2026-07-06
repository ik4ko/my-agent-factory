import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';
import { QuotesPanel } from '@/components/dashboard/quotes-panel';

export default function TradingWorkspace() {
  return (
    <WorkspaceScaffold
      title="Stock Trading"
      icon="linechart"
      accent="text-neon-green"
      blurb="Market analysis and staged orders. Agents produce research and quantitative angles; any actual order is STAGED for your approval before anything executes — never auto-traded. Ask Claude here to have Codex analyze a symbol or Hermes scout the news."
    >
      <QuotesPanel />
    </WorkspaceScaffold>
  );
}
