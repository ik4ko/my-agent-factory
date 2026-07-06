import { readFile } from 'fs/promises';
import { join } from 'path';
import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';

async function readRunbook(): Promise<string> {
  try {
    return await readFile(join(process.cwd(), 'RUNBOOK.md'), 'utf8');
  } catch (err) {
    return `RUNBOOK.md not readable: ${String(err).slice(0, 200)}`;
  }
}

export default async function DocsWorkspace() {
  const runbook = await readRunbook();
  return (
    <WorkspaceScaffold
      title="Runbook"
      icon="bookopen"
      accent="text-neon-purple"
      blurb="Start order, arm/disarm/kill, alert meanings, incident response, and the go-live checklist — the same RUNBOOK.md at the repo root, also served raw at /api/runbook."
    >
      <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-surface-2 p-4 font-terminal text-xs leading-relaxed text-foreground/90">
        {runbook}
      </pre>
    </WorkspaceScaffold>
  );
}
