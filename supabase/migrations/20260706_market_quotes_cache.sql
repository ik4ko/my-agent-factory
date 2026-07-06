-- Live-quote cache, populated by the loop-worker's Finnhub REST poll cycle
-- (src/lib/market/finnhub-quotes.ts). One row per symbol, upserted on every
-- poll. Read-only to anon/authenticated; only the worker's service-role
-- client writes here.
-- (Applied to the live project on 2026-07-06 via MCP; kept here for repo parity.)
create table if not exists public.quotes (
  symbol text primary key,
  price numeric not null,
  change numeric,
  change_pct numeric,
  high numeric,
  low numeric,
  open numeric,
  prev_close numeric,
  source text not null default 'finnhub',
  updated_at timestamptz not null default now()
);

alter table public.quotes enable row level security;
drop policy if exists quotes_read on public.quotes;
create policy quotes_read on public.quotes for select to anon, authenticated using (true);

alter publication supabase_realtime add table public.quotes;
