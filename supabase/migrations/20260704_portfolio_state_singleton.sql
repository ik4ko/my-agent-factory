-- Phase 8: portfolio state — single-row source of truth for liquid cash.
-- RLS enabled with NO policies: only the service role (system) can read or
-- write. The dashboard never sees this table directly.
-- (Applied to the live project on 2026-07-04 via MCP; kept here for repo parity.)
create table if not exists public.portfolio_state (
  id uuid primary key default gen_random_uuid(),
  total_liquid_cash numeric(12, 2) not null default 0.00 check (total_liquid_cash >= 0),
  updated_at timestamptz not null default now()
);

-- Enforce the singleton: at most one row can ever exist.
create unique index if not exists portfolio_state_singleton on public.portfolio_state ((true));

alter table public.portfolio_state enable row level security;

-- Seed the paper-equity baseline (matches DEFAULT_PAPER_EQUITY_USD).
insert into public.portfolio_state (total_liquid_cash)
values (100000.00)
on conflict do nothing;
