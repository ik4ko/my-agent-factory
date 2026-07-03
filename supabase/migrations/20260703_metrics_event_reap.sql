-- Applied to sxqdjilabbmjobjpwwst on 2026-07-03 (metrics_event_reap).
-- Add REAP to the telemetry event vocabulary (stale-lock recovery).
alter table public.metrics drop constraint if exists metrics_event_check;
alter table public.metrics add constraint metrics_event_check
  check (event in ('SEAT','UP','DOWN','USAGE','HALT','REAP'));
