-- Channel Connect & Stats — reading real public YouTube data.
--
-- Distinct concern from the content-generation pipeline: this is READ-ONLY
-- and needs only a plain YouTube Data API key (YOUTUBE_DATA_API_KEY), not the
-- OAuth refresh token the publish stage will need.
--
-- content_channels keeps its existing shape (identity/config only). A LINK is
-- "this channel's actual presence on a platform" and lives in its own table so
-- a channel can hold a YouTube link and an Instagram link later without a
-- reshape — the same reasoning that made publish's `publications` an array.

-- 1. The link: one row per (channel, platform).
create table if not exists public.content_channel_links (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.content_channels(id) on delete cascade,
  platform text not null default 'youtube',
  -- What the operator pasted/confirmed (e.g. '@handle'), kept for display.
  handle text,
  -- The platform's stable id (YouTube 'UC...'). Resolved ONCE at connect time
  -- and cached forever, so an expensive resolution (a /c/ custom URL costing a
  -- Search-bucket call) is never paid again on refresh.
  external_id text not null,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  -- Surfaced in the room ("refresh failed: quota exceeded") instead of a
  -- silent failure. Cleared on the next successful sync.
  last_error text,
  unique (channel_id, platform)
);

-- 2. Stats snapshots: INSERT-ONLY, never upserted. Same principle as the tasks
--    table — an immutable audit artifact. The moment a second row exists, a
--    growth curve is derivable for free. No chart is built yet; the point is
--    that building one later needs no reshape.
create table if not exists public.content_channel_stats_snapshots (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.content_channel_links(id) on delete cascade,
  fetched_at timestamptz not null default now(),
  subscriber_count bigint,
  view_count bigint,
  video_count bigint,
  -- Full API payload, so a future metric needs no backfill migration.
  raw jsonb not null default '{}'::jsonb
);

-- 3. Videos: UPSERTED per video. Current state is the useful state here, so
--    this one deliberately keeps no history.
create table if not exists public.content_channel_videos (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.content_channel_links(id) on delete cascade,
  external_video_id text not null,
  title text not null default '',
  thumbnail_url text,
  published_at timestamptz,
  view_count bigint,
  like_count bigint,
  comment_count bigint,
  last_synced_at timestamptz not null default now(),
  unique (link_id, external_video_id)
);

alter table public.content_channel_links enable row level security;
alter table public.content_channel_stats_snapshots enable row level security;
alter table public.content_channel_videos enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='content_channel_links' and policyname='content_channel_links_read') then
    create policy "content_channel_links_read" on public.content_channel_links for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='content_channel_stats_snapshots' and policyname='content_channel_stats_snapshots_read') then
    create policy "content_channel_stats_snapshots_read" on public.content_channel_stats_snapshots for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='content_channel_videos' and policyname='content_channel_videos_read') then
    create policy "content_channel_videos_read" on public.content_channel_videos for select using (true);
  end if;
end $$;

create index if not exists content_channel_links_channel_idx
  on public.content_channel_links (channel_id);
-- Snapshot lookups are always "newest N for this link" — the delta readout and
-- any future growth chart both read exactly this order.
create index if not exists content_channel_stats_link_fetched_idx
  on public.content_channel_stats_snapshots (link_id, fetched_at desc);
create index if not exists content_channel_videos_link_published_idx
  on public.content_channel_videos (link_id, published_at desc);

-- Realtime, so the stats panel and video grid update live like every other
-- list in this dashboard.
do $$
declare t text;
begin
  foreach t in array array['content_channel_links','content_channel_stats_snapshots','content_channel_videos'] loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
