-- Repair migration for the trading watchlist table.
-- The live project lost public.ticker_watchlist even though the original seed
-- migration exists in repo history, so this restores the table idempotently.
create table if not exists public.ticker_watchlist (
  symbol text primary key check (symbol ~ '^[A-Z]{1,6}$'),
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.ticker_watchlist enable row level security;

insert into public.ticker_watchlist (symbol)
values ('SOXS'), ('NVDA'), ('SPY')
on conflict (symbol) do nothing;
