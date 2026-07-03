-- Applied to sxqdjilabbmjobjpwwst on 2026-07-03 (task_lane_routing).
-- Lane-routing columns (additive): which lane the router assigned and the
-- factory-built system prompt the worker must execute with.
alter table public.tasks add column if not exists assigned_lane text
  check (assigned_lane is null or assigned_lane in ('SEAT','UP','DOWN'));
alter table public.tasks add column if not exists system_prompt text;
