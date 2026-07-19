-- Work-session indicator v0 (applied live via MCP 2026-07-18).
-- One row per agent work session; the dashboard chip shows the newest
-- active row with a recent heartbeat. Writes are service-role only.
create table if not exists public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  task_summary text not null,
  touched_files jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active','finished')),
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.work_sessions enable row level security;

create policy "work_sessions_read" on public.work_sessions for select using (true);

create index if not exists work_sessions_active_idx
  on public.work_sessions (status, last_heartbeat_at desc);
