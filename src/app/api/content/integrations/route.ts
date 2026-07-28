import { NextResponse } from 'next/server';
import { contentIntegrationStatus, isPipelineFullyWired } from '@/lib/content/integrations';
import { youtubeDataStatus } from '@/lib/content/youtube-data';

/**
 * GET /api/content/integrations — readiness for the room's status panel.
 * Server-only because it reads process.env; the response carries env var
 * NAMES only, never values.
 *
 * `stages` is the content-generation pipeline. `youtubeData` is the separate
 * read-only Channel Connect feature, which needs only a plain API key and is
 * reported alongside so the room can show it as the lower-friction win.
 */
export async function GET() {
  return NextResponse.json({
    stages: contentIntegrationStatus(),
    fullyWired: isPipelineFullyWired(),
    youtubeData: youtubeDataStatus(),
  });
}
