-- Phase 5: Robinhood order STAGING area. Rows are immutable proposals —
-- inserts come only from the service role (pipeline/API); approval flips
-- are a future human-gated flow. Nothing executes orders.
-- (Applied to the live project on 2026-07-04 via MCP; kept here for repo parity.)
create table if not exists public.staged_orders (
  id uuid primary key default gen_random_uuid(),
  underlying text not null check (underlying ~ '^[A-Z]{1,6}$'),
  option_type text not null check (option_type in ('CALL', 'PUT')),
  strike numeric not null check (strike > 0),
  expiration date not null,
  execution_type text not null default 'LIMIT' check (execution_type = 'LIMIT'),
  limit_price numeric not null check (limit_price > 0),
  calculated_position_size_usd numeric not null check (calculated_position_size_usd >= 0),
  human_approval_status text not null default 'PENDING'
    check (human_approval_status in ('PENDING', 'APPROVED', 'DENIED')),
  pipeline_id uuid,
  kelly_fraction numeric not null check (kelly_fraction >= 0 and kelly_fraction <= 0.02),
  expectancy numeric not null check (expectancy > 0),
  win_rate numeric not null check (win_rate > 0 and win_rate < 1),
  r_multiple numeric not null check (r_multiple > 0),
  source text not null default 'SANDBOX' check (source in ('SANDBOX', 'LIVE')),
  created_at timestamptz not null default now()
);

create index if not exists staged_orders_pipeline_idx on public.staged_orders (pipeline_id);
create index if not exists staged_orders_status_idx on public.staged_orders (human_approval_status, created_at desc);

alter table public.staged_orders enable row level security;
create policy staged_orders_read on public.staged_orders for select to anon, authenticated using (true);

alter publication supabase_realtime add table public.staged_orders;
