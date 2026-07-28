-- Allow the 'content_sync' loop kind.
--
-- The hourly YouTube channel refresh runs on the EXISTING loops engine rather
-- than a new scheduler: one row in `loops` plus a tick handler that calls the
-- already-tested refreshLink. The only schema change needed is widening the
-- kind CHECK — the tables the sync writes (content_channel_links / _stats_
-- snapshots / _videos) were shaped for this in 20260726_content_channel_links.
--
-- Additive: every existing kind stays valid, so no row is invalidated.
alter table public.loops drop constraint if exists loops_kind_check;
alter table public.loops add constraint loops_kind_check
  check (kind = any (array['trade','research','build','personal','monitor','content_sync']));
