import { redirect } from 'next/navigation';

/** Route moved — the engineering workspace is /dashboard/rooms/coding. */
export default function BuildingRedirect() {
  redirect('/dashboard/rooms/coding');
}
