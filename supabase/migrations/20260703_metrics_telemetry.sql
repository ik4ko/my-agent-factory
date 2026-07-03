-- Applied to sxqdjilabbmjobjpwwst on 2026-07-03 (metrics_telemetry_and_task_model).
-- Orchestration telemetry: per-event model/token ledger.
create table if not exists public.metrics (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete set null,
  agent_id uuid references public.agents(id) on delete set null,
  model text not null,
  event text not null check (event in ('SEAT','UP','DOWN','USAGE','HALT')),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists metrics_created_at_idx on public.metrics (created_at desc);
create index if not exists metrics_model_created_idx on public.metrics (model, created_at desc);

alter table public.metrics enable row level security;

-- Dashboard subscribes with the anon key; writes only ever come from service role.
drop policy if exists metrics_read_all on public.metrics;
create policy metrics_read_all on public.metrics for select using (true);

-- Live replication for the telemetry stream.
alter publication supabase_realtime add table public.metrics;

-- Which model executed the task (nullable, additive).
alter table public.tasks add column if not exists model text;
