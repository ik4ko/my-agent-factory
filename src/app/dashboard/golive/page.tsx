import type { Metadata } from 'next';
import { GoLiveClient } from '@/components/dashboard/golive-client';

export const metadata: Metadata = { title: 'Go-Live' };

/** /dashboard/golive — minimal go-live cockpit (preflight · selftest ·
 *  PIN-gated arm/kill), restored after ea91b56 under the four-rooms
 *  dashboard layout. Session-authed by middleware like every dashboard
 *  route; the privileged actions are additionally PIN-gated server-side. */
export default function GoLivePage() {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <GoLiveClient />
    </main>
  );
}
