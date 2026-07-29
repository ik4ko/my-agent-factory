import { WorkspaceScaffold } from '@/components/dashboard/workspace-scaffold';
import { MedicareRoomNav } from '@/components/dashboard/medicare/room-nav';

/**
 * Shared shell for the Medicare cockpit.
 *
 * The scaffold and sub-navigation live here rather than in each page so that
 * moving between Today, Leads, Clients and Coverage does not remount the room
 * chrome or flash the header. Each page renders only its own content.
 */
export default function MedicareRoomLayout({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceScaffold
      title="Medicare CRM"
      icon="shieldcheck"
      accent="text-neon-cyan"
      blurb="Daily work queue, website leads, book of business, and coverage review for an independent Medicare practice."
    >
      <MedicareRoomNav />
      {children}
    </WorkspaceScaffold>
  );
}
