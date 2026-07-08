import { redirect } from 'next/navigation';

/** Route moved — trading now lives under the consolidated rooms path. */
export default function TradingRedirect() {
  redirect('/dashboard/rooms/trading');
}
