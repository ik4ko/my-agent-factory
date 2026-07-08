import { NextResponse } from 'next/server';

const OMNIGENT_SERVER_URL = process.env.OMNIGENT_SERVER_URL ?? 'http://127.0.0.1:6767';

interface OmnigentSessionSummary {
  id: string;
  agent_name: string | null;
  status: string;
  created_at: number;
}

interface OmnigentItem {
  id: string;
  type: string;
  role?: string;
  content?: { type: string; text: string }[];
}

/** GET /api/omnigent/activity — proxies the Omnigent server's session list
 *  plus the most recent session's items, so the dashboard can show live
 *  cross-agent activity without the browser needing to reach Omnigent
 *  directly (same session-gating as every other route here). Never throws:
 *  an unreachable Omnigent server (not installed, WSL2 not running, etc.)
 *  degrades to an empty, clearly-labeled response. */
export async function GET() {
  try {
    const res = await fetch(`${OMNIGENT_SERVER_URL}/v1/sessions?limit=10`, {
      signal: AbortSignal.timeout(4_000),
      cache: 'no-store',
    });
    if (!res.ok) return NextResponse.json({ reachable: false, sessions: [], items: [] });

    const sessionList = (await res.json()) as { data: OmnigentSessionSummary[] };
    const sessions = sessionList.data ?? [];
    const newest = sessions[0];

    let items: OmnigentItem[] = [];
    if (newest) {
      const itemsRes = await fetch(`${OMNIGENT_SERVER_URL}/v1/sessions/${newest.id}/items`, {
        signal: AbortSignal.timeout(4_000),
        cache: 'no-store',
      });
      if (itemsRes.ok) {
        const itemList = (await itemsRes.json()) as { data: OmnigentItem[] };
        items = (itemList.data ?? []).filter((i) => i.type === 'message');
      }
    }

    return NextResponse.json({ reachable: true, sessions, items });
  } catch {
    return NextResponse.json({ reachable: false, sessions: [], items: [] });
  }
}
