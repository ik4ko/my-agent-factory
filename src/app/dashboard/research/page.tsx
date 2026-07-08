import { redirect } from 'next/navigation';

/** Route moved — research now lives under the consolidated rooms path. */
export default function ResearchRedirect() {
  redirect('/dashboard/rooms/research');
}
