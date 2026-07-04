-- Phase 9.1: open system_bus to dashboard observers (read-only) and stream
-- inserts over realtime. Writes remain service-role only (no insert/update
-- policies). Thought payloads carry previews + provenance, never secrets.
-- (Applied to the live project on 2026-07-04 via MCP; kept here for repo parity.)
create policy system_bus_read on public.system_bus for select to anon, authenticated using (true);
alter publication supabase_realtime add table public.system_bus;
