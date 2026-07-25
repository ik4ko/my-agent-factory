-- Content channels — identity/config for the YouTube room's per-channel
-- pipelines (Faceless, Medicare, Personal, and any vertical added later).
--
-- This is the ONLY new table for the content room. Channels are DATA, not
-- code: adding a fourth or fifth vertical is an INSERT from the room's
-- "+ Add channel" form, never a deploy. Individual pipeline runs are NOT
-- stored here — a run is an ordinary `tasks` row carrying result.pipeline
-- (see src/lib/pipeline/engine.ts), tagged with assigned_lane = the
-- channel slug so runs stay filterable per channel.
create table if not exists public.content_channels (
  id uuid primary key default gen_random_uuid(),
  -- Stable machine key. Written verbatim into tasks.assigned_lane, which is
  -- what src/lib/rooms/scope.ts scopes the room by — so it must stay
  -- URL/identifier-safe and immutable once runs exist against it.
  slug text not null unique,
  label text not null,
  niche text not null default '',
  -- Injected as runtime context into the content playbook's prompts, so one
  -- shared strategist agent serves every channel (no brain-matrix entry per
  -- vertical).
  brand_voice text not null default '',
  -- e.g. ["youtube","instagram"] — which publish targets the final stage
  -- should fan out to. Free-form so a new platform needs no migration.
  publish_targets jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.content_channels enable row level security;

create policy "content_channels_read" on public.content_channels for select using (true);

create index if not exists content_channels_active_idx
  on public.content_channels (active, created_at desc);

-- The room's channel switcher is a live list like every other list in this
-- dashboard, so the table joins the realtime publication.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'content_channels'
  ) then
    alter publication supabase_realtime add table public.content_channels;
  end if;
end $$;

-- Seed the three starting verticals. Identity/config only — no pipeline runs
-- are triggered by this migration.
insert into public.content_channels (slug, label, niche, brand_voice, publish_targets)
values
  (
    'faceless',
    'Faceless',
    'High-retention faceless short-form: explainers, listicles, and hooks over stock footage.',
    'Punchy and declarative. Cold-open with the payoff, no throat-clearing, no "in this video". Short sentences. Second person.',
    '["youtube","instagram"]'::jsonb
  ),
  (
    'medicare',
    'Medicare',
    'Medicare education for US seniors and their adult children — plan types, enrollment windows, common mistakes.',
    'Plain, calm, and precise. Never promise coverage or quote a premium. Define every acronym on first use. Compliance-safe: educational framing only, never a solicitation.',
    '["youtube"]'::jsonb
  ),
  (
    'personal',
    'Personal',
    'Build-in-public notes on agents, automation, and shipping software solo.',
    'First person and specific. Concrete numbers over adjectives. Show the actual thing rather than describing it.',
    '["youtube","instagram"]'::jsonb
  )
on conflict (slug) do nothing;
