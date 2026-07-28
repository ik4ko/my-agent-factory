import { NextRequest, NextResponse } from 'next/server';
import { YoutubeDataError, fetchVideoComments, isYoutubeDataConfigured, newLedger } from '@/lib/content/youtube-data';

/**
 * GET /api/content/videos/:videoId/comments
 *
 * LAZY BY DESIGN — 1 unit per video, and never called during a refresh.
 * Fetching comments for every video in a sync would cost one unit per video
 * (3 channels x 20 videos = 60 units a sync) for comments nobody asked to
 * read. This endpoint fires only when the operator clicks into a video.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;
  if (!isYoutubeDataConfigured()) {
    return NextResponse.json({ error: 'needs YOUTUBE_DATA_API_KEY' }, { status: 503 });
  }

  const ledger = newLedger();
  try {
    const comments = await fetchVideoComments(videoId, ledger);
    return NextResponse.json({ comments, quota: ledger });
  } catch (err) {
    const kind = err instanceof YoutubeDataError ? err.kind : 'api-error';
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Comment fetch failed', kind, quota: ledger },
      { status: kind === 'quota-exceeded' ? 429 : 502 },
    );
  }
}
