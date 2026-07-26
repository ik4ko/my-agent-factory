import { NextRequest, NextResponse } from 'next/server';
import { deleteLink, getLink, listSnapshots, listVideos, refreshLink, snapshotDelta } from '@/lib/content/channel-links';
import { isYoutubeDataConfigured } from '@/lib/content/youtube-data';

/**
 *   GET    /api/content/links/:id  → link + newest snapshot + delta + videos
 *   POST   /api/content/links/:id  → manual refresh (the only quota spender)
 *   DELETE /api/content/links/:id  → disconnect (snapshots/videos cascade)
 */

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    const link = await getLink(id);
    if (!link) return NextResponse.json({ error: 'Link not found' }, { status: 404 });
    const [snapshots, videos] = await Promise.all([listSnapshots(id, 2), listVideos(id)]);
    return NextResponse.json({
      link,
      latest: snapshots[0] ?? null,
      delta: snapshotDelta(snapshots),
      videos,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}

export async function POST(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  if (!isYoutubeDataConfigured()) {
    return NextResponse.json({ error: 'needs YOUTUBE_DATA_API_KEY' }, { status: 503 });
  }
  // refreshLink never throws on an API failure — it records last_error and
  // reports it, so a quota wall surfaces in the room rather than 500-ing.
  const result = await refreshLink(id);
  return NextResponse.json(result, { status: result.ok ? 200 : 200 });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  try {
    await deleteLink(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}
