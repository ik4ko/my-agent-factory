import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { listLinks, saveLink, refreshLink } from '@/lib/content/channel-links';
import {
  YoutubeDataError,
  isYoutubeDataConfigured,
  newLedger,
  parseChannelInput,
  resolveChannel,
} from '@/lib/content/youtube-data';

/**
 * Channel links.
 *
 *   GET  ?channelId=   → links for a channel (or all)
 *   POST { input }     → RESOLVE ONLY. Returns the channel for confirmation.
 *                        Spends quota, saves nothing.
 *   POST { channelId, externalId, handle } → SAVE a confirmed resolution.
 *
 * The two-step resolve/save split is deliberate: linking the wrong channel off
 * an ambiguous handle is a real failure mode, and a confirm step kills it for
 * the price of one already-spent lookup.
 */

const ResolveSchema = z.object({ input: z.string().min(1).max(300) });
const SaveSchema = z.object({
  channelId: z.string().uuid(),
  externalId: z.string().min(1).max(120),
  handle: z.string().max(120).nullable().optional(),
  platform: z.string().max(40).optional(),
  /** Kick off the first sync immediately after linking. */
  syncNow: z.boolean().optional().default(true),
});

function notConfigured() {
  return NextResponse.json(
    {
      error: 'needs YOUTUBE_DATA_API_KEY',
      hint: 'Read-only YouTube Data API key — free, no OAuth consent screen. Distinct from the OAuth token publishing will need.',
    },
    { status: 503 },
  );
}

export async function GET(req: NextRequest) {
  const channelId = req.nextUrl.searchParams.get('channelId') ?? undefined;
  try {
    return NextResponse.json({ links: await listLinks(channelId) });
  } catch (err) {
    return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // ── Save path (a confirmed resolution) ──
  const save = SaveSchema.safeParse(body);
  if (save.success) {
    try {
      const link = await saveLink({
        channelId: save.data.channelId,
        platform: save.data.platform,
        handle: save.data.handle ?? null,
        externalId: save.data.externalId,
      });
      // First sync inline so the panel is populated the moment it appears.
      const sync = save.data.syncNow ? await refreshLink(link.id) : null;
      return NextResponse.json({ link, sync }, { status: 201 });
    } catch (err) {
      return NextResponse.json({ error: String(err).slice(0, 200) }, { status: 500 });
    }
  }

  // ── Resolve path (preview, nothing persisted) ──
  const resolve = ResolveSchema.safeParse(body);
  if (!resolve.success) {
    return NextResponse.json({ error: 'Validation failed', details: resolve.error.flatten() }, { status: 400 });
  }
  if (!isYoutubeDataConfigured()) return notConfigured();

  const parsed = parseChannelInput(resolve.data.input);
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          'Not a recognizable YouTube channel. Paste a @handle or a /channel/UC… URL — those resolve exactly.',
      },
      { status: 400 },
    );
  }

  const ledger = newLedger();
  try {
    const channel = await resolveChannel(parsed, ledger);
    return NextResponse.json({
      resolved: channel,
      inputKind: parsed.kind,
      quota: ledger,
      // /c/ goes through a best-match search, so the confirm step matters most here.
      ambiguous: parsed.kind === 'custom',
    });
  } catch (err) {
    const kind = err instanceof YoutubeDataError ? err.kind : 'api-error';
    const status = kind === 'quota-exceeded' ? 429 : kind === 'not-found' ? 404 : 502;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Resolution failed', kind, quota: ledger },
      { status },
    );
  }
}
