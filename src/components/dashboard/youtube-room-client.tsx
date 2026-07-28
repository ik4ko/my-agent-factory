'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Loader2, Play, CircleDot } from 'lucide-react';
import { TaskFeed } from './task-feed';
import { PanelChrome } from '@/components/deck';
import { WorkspaceGrid, type WorkspacePanelDef } from '@/components/deck/workspace-grid';
import { WidgetErrorBoundary } from './widget-error-boundary';
import { ChannelConnectPanel, ChannelSettingsPanel, ChannelVideosPanel } from './channel-connect-panel';
import { useContentChannels, CONTENT_CHANNELS_KEY } from '@/hooks/use-content-channels-query';
import { cn } from '@/lib/utils';
import type { ContentChannel } from '@/lib/types/database.types';
import type { StageReadiness } from '@/lib/content/integrations';

/**
 * YouTube room — one room, N content-channel pipelines.
 *
 * Faceless / Medicare / Personal are NOT components. They are rows in
 * content_channels rendered by the switcher below, so a fourth vertical is an
 * "+ Add channel" insert and nothing else. Everything downstream (the run
 * trigger, the task feed, the log terminal) is driven by whichever channel is
 * selected — there is deliberately no per-vertical branch anywhere in this file.
 */

const DEFAULT_LAYOUTS = {
  lg: [
    { i: 'channels', x: 0, y: 0, w: 3, h: 16, minW: 2, minH: 8 },
    { i: 'runner', x: 3, y: 0, w: 5, h: 8, minW: 3, minH: 5 },
    { i: 'stages', x: 8, y: 0, w: 4, h: 8, minW: 3, minH: 5 },
    { i: 'connect', x: 3, y: 8, w: 5, h: 9, minW: 3, minH: 5 },
    { i: 'settings', x: 8, y: 8, w: 4, h: 9, minW: 3, minH: 5 },
    { i: 'videos', x: 0, y: 17, w: 7, h: 10, minW: 3, minH: 5 },
    { i: 'runs', x: 7, y: 17, w: 5, h: 10, minW: 3, minH: 4 },
  ],
  md: [
    { i: 'channels', x: 0, y: 0, w: 8, h: 7 },
    { i: 'runner', x: 0, y: 7, w: 8, h: 7 },
    { i: 'stages', x: 0, y: 14, w: 8, h: 7 },
    { i: 'connect', x: 0, y: 21, w: 8, h: 9 },
    { i: 'settings', x: 0, y: 30, w: 8, h: 9 },
    { i: 'videos', x: 0, y: 39, w: 8, h: 10 },
    { i: 'runs', x: 0, y: 49, w: 8, h: 7 },
  ],
  sm: [
    { i: 'channels', x: 0, y: 0, w: 1, h: 7 },
    { i: 'runner', x: 0, y: 7, w: 1, h: 7 },
    { i: 'stages', x: 0, y: 14, w: 1, h: 7 },
    { i: 'connect', x: 0, y: 21, w: 1, h: 9 },
    { i: 'settings', x: 0, y: 30, w: 1, h: 9 },
    { i: 'videos', x: 0, y: 39, w: 1, h: 10 },
    { i: 'runs', x: 0, y: 49, w: 1, h: 7 },
  ],
};

// ── Channel switcher + add form ─────────────────────────────────────────────

function AddChannelForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [niche, setNiche] = useState('');
  const [brandVoice, setBrandVoice] = useState('');
  const [targets, setTargets] = useState('youtube');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/content/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          niche: niche.trim(),
          brand_voice: brandVoice.trim(),
          publish_targets: targets.split(',').map((t) => t.trim()).filter(Boolean),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to create channel');
      // Realtime will also fire; invalidating makes the originating tab instant.
      await queryClient.invalidateQueries({ queryKey: CONTENT_CHANNELS_KEY });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create channel');
    } finally {
      setBusy(false);
    }
  }

  const field = 'w-full rounded border border-line bg-surface-2 px-2 py-1 font-mono text-[10px] text-ink-high outline-none focus:border-primary';

  return (
    <form onSubmit={submit} className="space-y-1.5 border-t border-line p-2">
      <input className={field} placeholder="Label (e.g. Cooking)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
      <textarea className={cn(field, 'h-10 resize-none')} placeholder="Niche — what this channel covers" value={niche} onChange={(e) => setNiche(e.target.value)} maxLength={2000} />
      <textarea className={cn(field, 'h-12 resize-none')} placeholder="Brand voice — injected into every prompt" value={brandVoice} onChange={(e) => setBrandVoice(e.target.value)} maxLength={4000} />
      <input className={field} placeholder="Publish targets, comma separated" value={targets} onChange={(e) => setTargets(e.target.value)} />
      {error && <p className="font-mono text-[9px] text-neon-red">{error}</p>}
      <div className="flex gap-1.5">
        <button type="submit" disabled={!label.trim() || busy} className="flex-1 rounded bg-primary/20 px-2 py-1 font-mono text-[9.5px] uppercase tracking-wide text-primary disabled:opacity-40">
          {busy ? 'Creating…' : 'Create'}
        </button>
        <button type="button" onClick={onDone} className="rounded border border-line px-2 py-1 font-mono text-[9.5px] uppercase tracking-wide text-ink-low">
          Cancel
        </button>
      </div>
    </form>
  );
}

function ChannelSwitcher({
  channels,
  selectedId,
  onSelect,
  isLoading,
}: {
  channels: ContentChannel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {isLoading && <p className="p-2 font-mono text-[9.5px] text-ink-low">Loading channels…</p>}
        {!isLoading && channels.length === 0 && (
          <p className="p-2 font-mono text-[9.5px] text-ink-low">No channels yet — add one below.</p>
        )}
        {channels.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={cn(
              'block w-full border-b border-line/60 px-2 py-1.5 text-left transition-colors',
              c.id === selectedId ? 'bg-primary/10' : 'hover:bg-surface-2',
            )}
          >
            <div className="flex items-center gap-1.5">
              <CircleDot className={cn('h-2.5 w-2.5 shrink-0', c.id === selectedId ? 'text-primary' : 'text-ink-low')} />
              <span className={cn('font-mono text-[10.5px]', c.id === selectedId ? 'text-primary' : 'text-ink-high')}>{c.label}</span>
              <span className="ml-auto font-mono text-[8.5px] text-ink-low">{c.slug}</span>
            </div>
            {c.niche && <p className="mt-0.5 line-clamp-2 pl-4 font-mono text-[8.5px] leading-tight text-ink-low">{c.niche}</p>}
          </button>
        ))}
      </div>
      {adding ? (
        <AddChannelForm onDone={() => setAdding(false)} />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center justify-center gap-1 border-t border-line px-2 py-1.5 font-mono text-[9.5px] uppercase tracking-wide text-ink-low hover:text-primary"
        >
          <Plus className="h-3 w-3" /> Add channel
        </button>
      )}
    </div>
  );
}

// ── Run trigger ─────────────────────────────────────────────────────────────

function PipelineRunner({ channel }: { channel: ContentChannel | null }) {
  const [objective, setObjective] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!channel || !objective.trim() || busy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch('/api/content/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: channel.id, objective: objective.trim(), simulate: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to start run');
      setNote(`Run ${String(json.pipelineId).slice(0, 8)} started — 5 stages, simulate. Watch Runs and Logs.`);
      setObjective('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start run');
    } finally {
      setBusy(false);
    }
  }

  if (!channel) return <p className="p-2 font-mono text-[9.5px] text-ink-low">Select a channel to start a run.</p>;

  return (
    <div className="space-y-2 p-2">
      <div className="font-mono text-[9px] uppercase tracking-wide text-ink-low">
        Channel · <span className="text-primary">{channel.label}</span>
        {channel.publish_targets?.length ? ` · targets: ${channel.publish_targets.join(', ')}` : ' · no targets'}
      </div>
      <textarea
        className="h-16 w-full resize-none rounded border border-line bg-surface-2 px-2 py-1 font-mono text-[10px] text-ink-high outline-none focus:border-primary"
        placeholder={`Video topic for ${channel.label}…`}
        value={objective}
        onChange={(e) => setObjective(e.target.value)}
        maxLength={1000}
      />
      <button
        onClick={run}
        disabled={!objective.trim() || busy}
        className="flex w-full items-center justify-center gap-1.5 rounded bg-primary/20 px-2 py-1.5 font-mono text-[10px] uppercase tracking-wide text-primary disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
        {busy ? 'Starting…' : 'Run pipeline (simulate)'}
      </button>
      {note && <p className="font-mono text-[9px] text-primary">{note}</p>}
      {error && <p className="font-mono text-[9px] text-neon-red">{error}</p>}
      <p className="font-mono text-[8.5px] leading-tight text-ink-low">
        Simulate mode: real tasks, agents, and logs are written so the run streams live — but no external API is
        called and nothing is published.
      </p>
    </div>
  );
}

// ── Integration readiness ───────────────────────────────────────────────────

function StageStatus() {
  const [stages, setStages] = useState<StageReadiness[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/content/integrations')
      .then((r) => r.json())
      .then((j) => { if (alive) setStages(j.stages ?? []); })
      .catch(() => { if (alive) setStages([]); });
    return () => { alive = false; };
  }, []);

  if (!stages) return <p className="p-2 font-mono text-[9.5px] text-ink-low">Loading…</p>;

  return (
    <div className="divide-y divide-line/60">
      {stages.map((s) => (
        <div key={s.stage} className="px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            {/* Three states, not two: credentials alone are not capability. */}
            <span
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                s.configured ? 'bg-primary' : s.credentialsPresent ? 'bg-neon-cyan' : 'bg-neon-orange',
              )}
            />
            <span className="font-mono text-[10px] uppercase text-ink-high">{s.stage}</span>
            <span
              className={cn(
                'ml-auto font-mono text-[8.5px]',
                s.configured ? 'text-primary' : s.credentialsPresent ? 'text-neon-cyan' : 'text-neon-orange',
              )}
            >
              {s.configured ? 'LIVE' : s.credentialsPresent ? 'KEYED · PENDING' : 'STUBBED'}
            </span>
          </div>
          <p className="pl-3 font-mono text-[8.5px] leading-tight text-ink-low">{s.service}</p>
          {!s.credentialsPresent && (
            <p className="pl-3 font-mono text-[8.5px] leading-tight text-ink-low">needs {s.missing.join(', ')}</p>
          )}
          {s.credentialsPresent && !s.configured && (
            <p className="pl-3 font-mono text-[8.5px] leading-tight text-ink-low">
              credentials present · provider call not yet implemented
            </p>
          )}
          {s.configured && s.availableUpgrades.length > 0 && (
            <p className="pl-3 font-mono text-[8.5px] leading-tight text-ink-low">
              optional: {s.availableUpgrades.join(', ')}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Room ────────────────────────────────────────────────────────────────────

export function YoutubeRoomClient() {
  const { data: channels = [], isLoading } = useContentChannels();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Default to the first channel once loaded; keep selection valid if the
  // selected channel disappears (deactivated in another tab).
  useEffect(() => {
    if (!channels.length) return;
    // Intentional synchronisation with an external/prop change. The guard above
    // makes this a no-op unless the value actually changed, so it settles in one
    // extra render rather than cascading.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!selectedId || !channels.some((c) => c.id === selectedId)) setSelectedId(channels[0].id);
  }, [channels, selectedId]);

  const selected = useMemo(
    () => channels.find((c) => c.id === selectedId) ?? null,
    [channels, selectedId],
  );

  const panels: WorkspacePanelDef[] = [
    {
      id: 'channels',
      label: 'channels',
      node: (
        <PanelChrome
          title="CHANNELS"
          headerRight={<span className="font-mono text-[8.5px] text-ink-low">{channels.length} active</span>}
          bodyClassName="p-0"
          className="h-full"
        >
          <WidgetErrorBoundary name="Channels">
            <ChannelSwitcher channels={channels} selectedId={selectedId} onSelect={setSelectedId} isLoading={isLoading} />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
    {
      id: 'runner',
      label: 'runner',
      node: (
        <PanelChrome title="NEW RUN" bodyClassName="p-0 overflow-y-auto" className="h-full">
          <WidgetErrorBoundary name="Pipeline Runner">
            <PipelineRunner channel={selected} />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
    {
      id: 'stages',
      label: 'stages',
      node: (
        <PanelChrome
          title="PIPELINE STAGES"
          headerRight={<span className="font-mono text-[8.5px] text-ink-low">stubbed vs live</span>}
          bodyClassName="p-0 overflow-y-auto"
          className="h-full"
        >
          <WidgetErrorBoundary name="Stage Status">
            <StageStatus />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
    {
      id: 'connect',
      label: 'youtube',
      node: (
        <PanelChrome
          title="YOUTUBE CHANNEL"
          headerRight={<span className="font-mono text-[8.5px] text-ink-low">read-only</span>}
          bodyClassName="p-0 overflow-y-auto"
          className="h-full"
        >
          <WidgetErrorBoundary name="Channel Connect">
            <ChannelConnectPanel channel={selected} />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
    {
      id: 'settings',
      label: 'settings',
      node: (
        <PanelChrome title="CHANNEL SETTINGS" bodyClassName="p-0 overflow-y-auto" className="h-full">
          <WidgetErrorBoundary name="Channel Settings">
            <ChannelSettingsPanel channel={selected} />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
    {
      id: 'videos',
      label: 'videos',
      node: (
        <PanelChrome
          title="VIDEOS"
          headerRight={<span className="font-mono text-[8.5px] text-ink-low">comments load on click</span>}
          bodyClassName="p-0 overflow-y-auto"
          className="h-full"
        >
          <WidgetErrorBoundary name="Channel Videos">
            <ChannelVideosPanel channel={selected} />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
    {
      id: 'runs',
      label: 'runs',
      node: (
        <PanelChrome
          title="RUNS"
          headerRight={<span className="font-mono text-[8.5px] text-ink-low">{selected?.slug ?? 'no channel'}</span>}
          bodyClassName="p-0"
          className="h-full"
        >
          <WidgetErrorBoundary name="Content Runs">
            {/* scope='content' keys off the real assigned_lane column;
                channelSlug narrows it to the selected channel. */}
            <TaskFeed scope="content" channelSlug={selected?.slug} />
          </WidgetErrorBoundary>
        </PanelChrome>
      ),
    },
  ];

  return (
    <div className="h-[calc(100vh-8.5rem)] overflow-y-auto p-2">
      <WorkspaceGrid room="youtube" panels={panels} defaultLayouts={DEFAULT_LAYOUTS} />
    </div>
  );
}
