'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link2, Loader2, RefreshCw, Unlink, MessageSquare, Check, X } from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useChannelLinks, useChannelLinkBundle, CHANNEL_LINKS_KEY, channelLinkKey } from '@/hooks/use-channel-link-query';
import { CONTENT_CHANNELS_KEY } from '@/hooks/use-content-channels-query';
import type { ContentChannel, ContentChannelVideo } from '@/lib/types/database.types';

/**
 * Channel Connect & Stats — reads REAL public YouTube data for whichever
 * content channel is selected. Channel-agnostic by construction: every panel
 * here takes the selected channel as a prop, so no vertical gets its own
 * component.
 */

const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString());
const field =
  'w-full rounded border border-line bg-surface-2 px-2 py-1 font-mono text-[10px] text-ink-high outline-none focus:border-primary';
const btn = 'rounded px-2 py-1 font-mono text-[9.5px] uppercase tracking-wide disabled:opacity-40';

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86_400)}d ago`;
}

// ── Connect flow: resolve → confirm → save ──────────────────────────────────

interface Resolved {
  externalId: string;
  title: string;
  handle: string | null;
  thumbnailUrl: string | null;
  subscriberCount: number | null;
  videoCount: number | null;
}

function ConnectForm({ channel }: { channel: ContentChannel }) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);

  async function resolve() {
    if (!input.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/content/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: input.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not resolve that channel');
      setResolved(json.resolved as Resolved);
      setAmbiguous(Boolean(json.ambiguous));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resolve that channel');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!resolved || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/content/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: channel.id,
          externalId: resolved.externalId,
          handle: resolved.handle,
          syncNow: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to save link');
      await queryClient.invalidateQueries({ queryKey: CHANNEL_LINKS_KEY });
      setResolved(null);
      setInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save link');
    } finally {
      setBusy(false);
    }
  }

  // Confirmation step — linking the wrong channel off an ambiguous handle is
  // the failure mode this exists to kill.
  if (resolved) {
    return (
      <div className="space-y-2 p-2">
        <p className="font-mono text-[9px] uppercase tracking-wide text-ink-low">Confirm this is the right channel</p>
        <div className="flex items-center gap-2 rounded border border-line bg-surface-2 p-2">
          {resolved.thumbnailUrl && (
            <Image src={resolved.thumbnailUrl} alt="" width={40} height={40} className="rounded-full" unoptimized />
          )}
          <div className="min-w-0">
            <p className="truncate font-mono text-[11px] text-ink-high">{resolved.title}</p>
            <p className="truncate font-mono text-[8.5px] text-ink-low">
              {resolved.handle ? `@${resolved.handle} · ` : ''}
              {num(resolved.subscriberCount)} subs · {num(resolved.videoCount)} videos
            </p>
          </div>
        </div>
        {ambiguous && (
          <p className="font-mono text-[8.5px] leading-tight text-neon-orange">
            Resolved from a /c/ custom URL via best-match search — double-check this is right.
          </p>
        )}
        {error && <p className="font-mono text-[9px] text-neon-red">{error}</p>}
        <div className="flex gap-1.5">
          <button onClick={confirm} disabled={busy} className={cn(btn, 'flex-1 bg-primary/20 text-primary')}>
            {busy ? 'Linking…' : 'Connect'}
          </button>
          <button onClick={() => setResolved(null)} className={cn(btn, 'border border-line text-ink-low')}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2">
      <input
        className={field}
        placeholder="@handle or youtube.com/channel/UC…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && resolve()}
      />
      <button onClick={resolve} disabled={!input.trim() || busy} className={cn(btn, 'flex w-full items-center justify-center gap-1.5 bg-primary/20 text-primary')}>
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
        {busy ? 'Resolving…' : 'Look up channel'}
      </button>
      {error && <p className="font-mono text-[9px] text-neon-red">{error}</p>}
      <p className="font-mono text-[8.5px] leading-tight text-ink-low">
        A @handle or /channel/ URL resolves exactly. A /c/ custom URL falls back to a best-match search — it works,
        but confirm the result carefully.
      </p>
    </div>
  );
}

// ── Stats panel ────────────────────────────────────────────────────────────

export function ChannelConnectPanel({ channel }: { channel: ContentChannel | null }) {
  const queryClient = useQueryClient();
  const { data: links = [] } = useChannelLinks(channel?.id ?? null);
  const link = links.find((l) => l.platform === 'youtube') ?? null;
  const { data: bundle } = useChannelLinkBundle(link?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [quotaNote, setQuotaNote] = useState<string | null>(null);

  if (!channel) return <p className="p-2 font-mono text-[9.5px] text-ink-low">Select a channel.</p>;
  if (!link) return <ConnectForm channel={channel} />;

  async function refresh() {
    if (!link || busy) return;
    setBusy(true);
    setQuotaNote(null);
    try {
      const res = await fetch(`/api/content/links/${link.id}`, { method: 'POST' });
      const json = await res.json();
      setQuotaNote(
        json.ok
          ? `Synced · ${json.quota?.units ?? 0} quota units used`
          : `Refresh failed: ${json.error ?? 'unknown error'}`,
      );
      await queryClient.invalidateQueries({ queryKey: channelLinkKey(link.id) });
      await queryClient.invalidateQueries({ queryKey: CHANNEL_LINKS_KEY });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!link || busy) return;
    setBusy(true);
    try {
      await fetch(`/api/content/links/${link.id}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: CHANNEL_LINKS_KEY });
    } finally {
      setBusy(false);
    }
  }

  const latest = bundle?.latest ?? null;
  const delta = bundle?.delta ?? null;

  return (
    <div className="space-y-2 p-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[11px] text-ink-high">
            {link.handle ? `@${link.handle}` : link.external_id}
          </p>
          <p className="font-mono text-[8.5px] text-ink-low">last synced {relativeTime(link.last_synced_at)}</p>
        </div>
        <button onClick={refresh} disabled={busy} title="Refresh" className={cn(btn, 'border border-line text-ink-low')}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </button>
        <button onClick={disconnect} disabled={busy} title="Disconnect" className={cn(btn, 'border border-line text-neon-red')}>
          <Unlink className="h-3 w-3" />
        </button>
      </div>

      {/* A failed sync surfaces beside the stale timestamp, never silently. */}
      {link.last_error && (
        <p className="rounded border border-neon-red/40 bg-neon-red/10 px-2 py-1 font-mono text-[8.5px] leading-tight text-neon-red">
          refresh failed: {link.last_error}
        </p>
      )}

      <div className="grid grid-cols-3 gap-1.5">
        {[
          { label: 'subscribers', value: latest?.subscriber_count, d: delta?.subscribers },
          { label: 'views', value: latest?.view_count, d: delta?.views },
          { label: 'videos', value: latest?.video_count, d: null },
        ].map((s) => (
          <div key={s.label} className="rounded border border-line bg-surface-2 px-1.5 py-1">
            <p className="font-mono text-[8px] uppercase text-ink-low">{s.label}</p>
            <p className="font-mono text-[12px] text-ink-high">{num(s.value)}</p>
            {typeof s.d === 'number' && s.d !== 0 && (
              <p className={cn('font-mono text-[8px]', s.d > 0 ? 'text-primary' : 'text-neon-red')}>
                {s.d > 0 ? '+' : ''}
                {s.d.toLocaleString()}
              </p>
            )}
          </div>
        ))}
      </div>
      {/* Degrades silently to no-trend-yet until a second snapshot exists. */}
      {delta && <p className="font-mono text-[8.5px] text-ink-low">since {relativeTime(delta.since)}</p>}
      {quotaNote && <p className="font-mono text-[8.5px] text-ink-low">{quotaNote}</p>}
    </div>
  );
}

// ── Video grid (+ lazy comments) ───────────────────────────────────────────

function CommentDrawer({ video, onClose }: { video: ContentChannelVideo; onClose: () => void }) {
  const [comments, setComments] = useState<Array<{ id: string; author: string; text: string; likeCount: number }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/content/videos/${video.external_video_id}/comments`)
      .then(async (r) => {
        const j = await r.json();
        if (!alive) return;
        if (!r.ok) setError(j.error ?? 'Failed to load comments');
        else setComments(j.comments);
      })
      .catch(() => alive && setError('Failed to load comments'));
    return () => { alive = false; };
  }, [video.external_video_id]);

  return (
    <div className="border-t border-line bg-surface-2 p-2">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="truncate font-mono text-[9.5px] text-ink-high">{video.title}</span>
        <button onClick={onClose} className="ml-auto text-ink-low hover:text-ink-high"><X className="h-3 w-3" /></button>
      </div>
      {error && <p className="font-mono text-[8.5px] text-neon-red">{error}</p>}
      {!comments && !error && <p className="font-mono text-[8.5px] text-ink-low">Loading comments…</p>}
      {comments?.length === 0 && <p className="font-mono text-[8.5px] text-ink-low">No comments.</p>}
      {comments?.map((c) => (
        <div key={c.id} className="border-b border-line/50 py-1">
          <p className="font-mono text-[8.5px] text-primary">{c.author} · {c.likeCount} likes</p>
          <p className="font-mono text-[8.5px] leading-tight text-ink-low" dangerouslySetInnerHTML={{ __html: c.text }} />
        </div>
      ))}
    </div>
  );
}

export function ChannelVideosPanel({ channel }: { channel: ContentChannel | null }) {
  const { data: links = [] } = useChannelLinks(channel?.id ?? null);
  const link = links.find((l) => l.platform === 'youtube') ?? null;
  const { data: bundle } = useChannelLinkBundle(link?.id ?? null);
  const [open, setOpen] = useState<ContentChannelVideo | null>(null);

  if (!channel) return <p className="p-2 font-mono text-[9.5px] text-ink-low">Select a channel.</p>;
  if (!link) return <p className="p-2 font-mono text-[9.5px] text-ink-low">Connect a YouTube channel to see its videos.</p>;

  const videos = bundle?.videos ?? [];
  if (videos.length === 0) return <p className="p-2 font-mono text-[9.5px] text-ink-low">No videos synced yet — hit Refresh.</p>;

  return (
    <div>
      <div className="divide-y divide-line/60">
        {videos.map((v) => (
          <div key={v.id} className="flex items-center gap-2 px-2 py-1.5">
            {v.thumbnail_url && (
              <Image src={v.thumbnail_url} alt="" width={64} height={36} className="rounded" unoptimized />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[9.5px] text-ink-high">{v.title}</p>
              <p className="font-mono text-[8px] text-ink-low">
                {num(v.view_count)} views · {num(v.like_count)} likes · {num(v.comment_count)} comments
                {v.published_at ? ` · ${new Date(v.published_at).toLocaleDateString()}` : ''}
              </p>
            </div>
            {/* Comments cost a quota unit each, so they load only on click. */}
            <button
              onClick={() => setOpen(open?.id === v.id ? null : v)}
              title="Load comments (1 quota unit)"
              className="text-ink-low hover:text-primary"
            >
              <MessageSquare className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      {open && <CommentDrawer video={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ── Channel settings ───────────────────────────────────────────────────────

export function ChannelSettingsPanel({ channel }: { channel: ContentChannel | null }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [niche, setNiche] = useState('');
  const [voice, setVoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLabel(channel?.label ?? '');
    setNiche(channel?.niche ?? '');
    setVoice(channel?.brand_voice ?? '');
    setSaved(false);
  }, [channel]);

  if (!channel) return <p className="p-2 font-mono text-[9.5px] text-ink-low">Select a channel.</p>;

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(`/api/content/channels/${channel!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await queryClient.invalidateQueries({ queryKey: CONTENT_CHANNELS_KEY });
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5 p-2">
      <p className="font-mono text-[8.5px] uppercase tracking-wide text-ink-low">
        slug <span className="text-ink-high">{channel.slug}</span> · not editable (runs are tagged with it)
      </p>
      <input className={field} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
      <textarea className={cn(field, 'h-10 resize-none')} value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="Niche" />
      <textarea className={cn(field, 'h-14 resize-none')} value={voice} onChange={(e) => setVoice(e.target.value)} placeholder="Brand voice" />
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => patch({ label, niche, brand_voice: voice })}
          disabled={busy || !label.trim()}
          className={cn(btn, 'flex-1 bg-primary/20 text-primary')}
        >
          {busy ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
        </button>
        {/* First control surface for the `active` column, which has existed
            since the first migration with no UI. */}
        <button
          onClick={() => patch({ active: !channel.active })}
          disabled={busy}
          title={channel.active ? 'Deactivate channel' : 'Reactivate channel'}
          className={cn(btn, 'border border-line', channel.active ? 'text-primary' : 'text-ink-low')}
        >
          {channel.active ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
          <span className="ml-1">{channel.active ? 'active' : 'inactive'}</span>
        </button>
      </div>
    </div>
  );
}
