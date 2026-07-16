-- Add honest storage for staged options intents.
--
-- These columns do not enable broker execution. They let the research/signal
-- lane persist a fully-auditable option order intent without overloading the
-- older staged_orders fields or silently dropping defined-risk metadata.

alter table public.staged_orders
  add column if not exists intent_kind text not null default 'legacy',
  add column if not exists action text,
  add column if not exists contracts integer,
  add column if not exists price_effect text,
  add column if not exists max_premium_usd numeric,
  add column if not exists max_loss_usd numeric,
  add column if not exists strategy_label text,
  add column if not exists source_signal_id uuid;

alter table public.staged_orders
  alter column kelly_fraction drop not null,
  alter column expectancy drop not null,
  alter column win_rate drop not null,
  alter column r_multiple drop not null;

alter table public.staged_orders
  drop constraint if exists staged_orders_intent_kind_check,
  drop constraint if exists staged_orders_action_check,
  drop constraint if exists staged_orders_contracts_check,
  drop constraint if exists staged_orders_price_effect_check,
  drop constraint if exists staged_orders_max_premium_check,
  drop constraint if exists staged_orders_max_loss_check,
  drop constraint if exists staged_orders_strategy_label_check,
  drop constraint if exists staged_orders_source_signal_fk,
  drop constraint if exists staged_orders_option_intent_required;

alter table public.staged_orders
  add constraint staged_orders_intent_kind_check
    check (intent_kind in ('legacy', 'option_intent')),
  add constraint staged_orders_action_check
    check (action is null or action in ('buy_to_open', 'sell_to_close', 'sell_to_open', 'buy_to_close')),
  add constraint staged_orders_contracts_check
    check (contracts is null or contracts > 0),
  add constraint staged_orders_price_effect_check
    check (price_effect is null or price_effect in ('debit', 'credit')),
  add constraint staged_orders_max_premium_check
    check (max_premium_usd is null or max_premium_usd > 0),
  add constraint staged_orders_max_loss_check
    check (max_loss_usd is null or max_loss_usd > 0),
  add constraint staged_orders_strategy_label_check
    check (
      strategy_label is null
      or length(btrim(strategy_label)) between 1 and 120
    ),
  add constraint staged_orders_source_signal_fk
    foreign key (source_signal_id) references public.events(id) on delete set null,
  add constraint staged_orders_option_intent_required
    check (
      intent_kind <> 'option_intent'
      or (
        action is not null
        and action <> 'sell_to_open'
        and contracts is not null
        and price_effect is not null
        and max_premium_usd is not null
        and max_loss_usd is not null
        and strategy_label is not null
        and source_signal_id is not null
        and source = 'SANDBOX'
        and max_loss_usd <= max_premium_usd
        and (
          price_effect <> 'debit'
          or (contracts::numeric * limit_price * 100) <= max_premium_usd
        )
      )
    );

create index if not exists staged_orders_source_signal_idx
  on public.staged_orders (source_signal_id)
  where source_signal_id is not null;

comment on column public.staged_orders.intent_kind is
  'legacy = original staged order proposal; option_intent = parsed options intent with defined-risk metadata.';
comment on column public.staged_orders.action is
  'Options intent action. Staged/audit-only; does not imply live broker execution.';
comment on column public.staged_orders.contracts is
  'Number of option contracts requested by the staged intent.';
comment on column public.staged_orders.price_effect is
  'Whether the options intent is a debit or credit order.';
comment on column public.staged_orders.max_premium_usd is
  'Operator/strategy maximum premium cap for the staged intent.';
comment on column public.staged_orders.max_loss_usd is
  'Maximum modeled loss for the staged intent.';
comment on column public.staged_orders.strategy_label is
  'Human-readable strategy or thesis label attached to the staged intent.';
comment on column public.staged_orders.source_signal_id is
  'Signal/event reference. Nullable for legacy rows; required when intent_kind is option_intent.';
