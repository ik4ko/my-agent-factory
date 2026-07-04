-- Phase 8.2: multi-ticker watchlist for the sweep orchestrator.
-- Zero-policy RLS: service-role (system) access only.
-- (Applied to the live project on 2026-07-04 via MCP; kept here for repo parity.)
create table if not exists public.ticker_watchlist (
  symbol text primary key check (symbol ~ '^[A-Z]{1,6}$'),
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.ticker_watchlist enable row level security;

insert into public.ticker_watchlist (symbol)
values ('SOXS'), ('NVDA'), ('SPY')
on conflict (symbol) do nothing;
