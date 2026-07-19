-- Panel-layout persistence (applied live via MCP 2026-07-18).
-- One row per user/room/breakpoint; `layout` is the react-grid-layout array.
-- Single-operator app today — user_key defaults to 'operator' for
-- forward-compat. Writes are service-role only.
create table if not exists public.workspace_layouts (
  id uuid primary key default gen_random_uuid(),
  user_key text not null default 'operator',
  room text not null,
  breakpoint text not null,
  layout jsonb not null,
  updated_at timestamptz not null default now(),
  unique (user_key, room, breakpoint)
);

alter table public.workspace_layouts enable row level security;

create policy "workspace_layouts_read" on public.workspace_layouts for select using (true);
