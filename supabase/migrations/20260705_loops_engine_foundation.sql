-- Phase 0 (Autonomous Loops): standing objectives, event bus, executed
-- orders, and the global risk/kill switch. All read-only to anon/authenticated
-- (dashboard + loop worker use the service role for writes); anon RLS is
-- select-only so the app's anon key can render the dashboard.
-- (Applied to the live project on 2026-07-05 via MCP; kept here for repo parity.)

create table if not exists public.loops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('trade','research','build','personal','monitor')),
  objective text not null,
  status text not null default 'paused' check (status in ('armed','paused','stopped')),
  cadence_seconds int,
  triggers jsonb not null default '[]',
  config jsonb not null default '{}',
  brain text not null default 'claude',
  last_tick_at timestamptz,
  next_tick_at timestamptz,
  lock_owner text,
  lock_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists loops_status_next_tick_idx on public.loops (status, next_tick_at);

create table if not exists public.loop_runs (
  id uuid primary key default gen_random_uuid(),
  loop_id uuid references public.loops(id) on delete cascade,
  trigger jsonb,
  decision jsonb,
  actions jsonb,
  result jsonb,
  status text not null default 'running' check (status in ('running','completed','failed')),
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists loop_runs_loop_idx on public.loop_runs (loop_id, started_at desc);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('news','price','earnings','manual','phone')),
  symbol text,
  severity text check (severity in ('low','med','high','critical')),
  payload jsonb not null default '{}',
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists events_unconsumed_idx on public.events (consumed, created_at) where not consumed;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  loop_id uuid references public.loops(id) on delete set null,
  symbol text not null,
  side text not null check (side in ('buy','sell')),
  qty numeric,
  notional numeric,
  type text not null default 'market' check (type in ('market','limit')),
  limit_price numeric,
  status text not null default 'intent' check (status in ('intent','risk_blocked','dry_run','submitted','filled','rejected','canceled')),
  broker_id text,
  fill_price numeric,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_loop_idx on public.orders (loop_id, created_at desc);

create table if not exists public.risk_state (
  id int primary key default 1,
  day date not null default current_date,
  realized_pnl numeric not null default 0,
  halted boolean not null default false,
  halt_reason text,
  trading_enabled boolean not null default false,
  kill_switch boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint risk_state_singleton check (id = 1)
);
insert into public.risk_state (id) values (1) on conflict (id) do nothing;

alter table public.loops enable row level security;
alter table public.loop_runs enable row level security;
alter table public.events enable row level security;
alter table public.orders enable row level security;
alter table public.risk_state enable row level security;

drop policy if exists loops_read on public.loops;
create policy loops_read on public.loops for select to anon, authenticated using (true);
drop policy if exists loop_runs_read on public.loop_runs;
create policy loop_runs_read on public.loop_runs for select to anon, authenticated using (true);
drop policy if exists events_read on public.events;
create policy events_read on public.events for select to anon, authenticated using (true);
drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders for select to anon, authenticated using (true);
drop policy if exists risk_state_read on public.risk_state;
create policy risk_state_read on public.risk_state for select to anon, authenticated using (true);

alter publication supabase_realtime add table public.loops;
alter publication supabase_realtime add table public.loop_runs;
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.risk_state;
