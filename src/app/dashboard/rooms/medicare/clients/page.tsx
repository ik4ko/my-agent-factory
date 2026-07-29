import { MedicareRoomClient } from '@/components/dashboard/medicare-room-client';

/**
 * The book of business. This is the pre-existing room view, preserved:
 * client list, carrier/state matrix, compliance vault, agency readiness.
 *
 * The website lead inbox moved to its own tab, and the direct-commit import
 * panel was retired — see the note in medicare-room-client.tsx.
 */
export default function MedicareClientsPage() {
  return <MedicareRoomClient />;
}
