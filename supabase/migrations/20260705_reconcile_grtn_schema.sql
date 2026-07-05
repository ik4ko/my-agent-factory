-- Applied to grtnjhwekvkyawacunde (My Agent Factory) on 2026-07-05.
-- Brings the original minimal schema up to parity with the app codebase.
-- Fully additive (ADD COLUMN IF NOT EXISTS / CREATE IF NOT EXISTS) — no data loss.
create extension if not exists vector with schema extensions;

alter table public.agents add column if not exists type text;
alter table public.agents add column if not exists current_task_id uuid;
alter table public.agents add column if not exists last_heartbeat timestamptz;
alter table public.agents add column if not exists metadata jsonb;
alter table public.agents add column if not exists paused boolean not null default false;
alter table public.agents add column if not exists halted_at timestamptz;
update public.agents set type = case
  when name ilike '%coder%'    or name ilike 'codex'     then 'coder'
  when name ilike '%research%' or name ilike 'scout'     then 'researcher'
  when name ilike '%browser%'  or name ilike 'phantom'   then 'browser'
  when name ilike '%planner%'  or name ilike 'architect' then 'planner'
  else 'generic' end
where type is null;

alter table public.tasks add column if not exists priority integer default 5;
alter table public.tasks add column if not exists result jsonb;
alter table public.tasks add column if not exists updated_at timestamptz default now();
alter table public.tasks add column if not exists model text;
alter table public.tasks add column if not exists assigned_lane text;
alter table public.tasks add column if not exists system_prompt text;
alter table public.tasks add column if not exists intervention_state text;
alter table public.tasks add column if not exists intervention_request text;
alter table public.tasks add column if not exists intervention_feedback text;
alter table public.tasks add column if not exists halted_at timestamptz;

alter table public.logs add column if not exists task_id uuid;
alter table public.logs add column if not exists metadata jsonb;

alter table public.memory add column if not exists agent_id uuid;
alter table public.memory add column if not exists version integer default 1;
alter table public.memory add column if not exists tags text[];
alter table public.memory add column if not exists importance integer;
alter table public.memory add column if not exists source text;
alter table public.memory add column if not exists semantic_context_gated boolean not null default false;
alter table public.memory add column if not exists embedding extensions.vector(1024);
create index if not exists memory_embedding_hnsw on public.memory using hnsw (embedding extensions.vector_cosine_ops);

create table if not exists public.metrics (
  id uuid primary key default gen_random_uuid(),
  task_id uuid, agent_id uuid, model text not null, event text not null,
  input_tokens integer not null default 0, output_tokens integer not null default 0,
  detail text, created_at timestamptz not null default now()
);
alter table public.metrics enable row level security;
drop policy if exists metrics_read_all on public.metrics;
create policy metrics_read_all on public.metrics for select using (true);

insert into public.agents (id, name, status, type, created_at)
select gen_random_uuid(), v.name, 'idle', v.type, now()
from (values ('Hermes','generic'), ('Codex','coder'), ('Scout','researcher')) as v(name, type)
where not exists (select 1 from public.agents a where a.name = v.name);
