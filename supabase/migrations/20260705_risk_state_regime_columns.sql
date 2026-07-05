-- Phase 3 (news/event switching): deterministic Regime Controller state.
-- Tighten-only mutations live here, bounded always by the operator's base
-- caps (env + loop config) — the regime controller can never raise a cap
-- above base and never sets trading_enabled.
-- (Applied to the live project on 2026-07-05 via MCP; kept here for repo parity.)
alter table public.risk_state add column if not exists regime text not null default 'NORMAL' check (regime in ('NORMAL','VOLATILE','CRITICAL_HALT'));
alter table public.risk_state add column if not exists symbol_overrides jsonb not null default '{}';
alter table public.risk_state add column if not exists feed_degraded boolean not null default false;
alter table public.risk_state add column if not exists feed_degraded_reason text;
alter table public.risk_state add column if not exists regime_updated_at timestamptz;
