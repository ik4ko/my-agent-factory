-- Phase 9: system_bus — the federated room. Agents PUBLISH events here;
-- the engine's pump CONSUMES pending hand-off events to trigger next steps.
-- Zero-policy RLS: service-role (system) access only.
-- (Applied to the live project on 2026-07-04 via MCP; kept here for repo parity.)
create table if not exists public.system_bus (
  id uuid primary key default gen_random_uuid(),
  topic text not null check (topic in ('pipeline.step.completed', 'pipeline.completed', 'agent.thought')),
  agent text,
  pipeline_id uuid,
  task_id uuid,
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'consumed', 'failed')),
  created_at timestamptz not null default now(),
  consumed_at timestamptz
);

create index if not exists system_bus_pending_idx on public.system_bus (status, created_at) where status = 'pending';
create index if not exists system_bus_pipeline_idx on public.system_bus (pipeline_id, created_at);

alter table public.system_bus enable row level security;
