-- Prompt-cache accounting for the token ledger.
--
-- Anthropic reports cache traffic in counters SEPARATE from input_tokens
-- (which is the uncached remainder only), so the ledger was blind to it:
-- cache writes are billed at 1.25x the input rate and were never charged
-- against any budget gate, and cache reads (0.1x) were indistinguishable from
-- a prompt cache that was never working at all.
--
-- Additive and defaulted so every existing row and every writer that does not
-- yet supply these columns stays valid.
alter table public.metrics
  add column if not exists cache_write_tokens integer not null default 0,
  add column if not exists cache_read_tokens  integer not null default 0;

comment on column public.metrics.cache_write_tokens is
  'Anthropic cache_creation_input_tokens. Billed at 1.25x the model input rate.';
comment on column public.metrics.cache_read_tokens is
  'Anthropic cache_read_input_tokens. Billed at 0.1x the model input rate.';
