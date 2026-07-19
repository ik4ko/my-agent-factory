import type { Metadata } from 'next';
import { GoLiveClient } from '@/components/dashboard/golive-client';

export const metadata: Metadata = { title: 'Simulation Control' };

/** Legacy URL retained for bookmarks; this is the simulation-only cockpit. */
export default function GoLivePage() {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <GoLiveClient />
    </main>
  );
}
