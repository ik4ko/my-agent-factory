-- Durable idempotency primitives for real orders and consequential actions.
alter table public.orders add column if not exists client_order_id uuid;
create unique index if not exists orders_client_order_id_uidx
  on public.orders (client_order_id) where client_order_id is not null;

create table if not exists public.action_claims (
  scope text not null,
  idempotency_key text not null,
  request_hash text not null,
  status text not null default 'claimed' check (status in ('claimed','completed','failed')),
  response jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (scope, idempotency_key)
);
alter table public.action_claims enable row level security;
-- Service-role only: no browser policies. Claims are security boundaries and
-- must never be forgeable through the public Supabase client.
grant select, insert, update on public.action_claims to service_role;
revoke all on public.action_claims from anon, authenticated;

create table if not exists public.task_intervention_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  decision text not null check (decision in ('approve','deny')),
  feedback text,
  created_at timestamptz not null default now()
);
create index if not exists task_intervention_events_task_idx
  on public.task_intervention_events (task_id, created_at desc);
alter table public.task_intervention_events enable row level security;
grant select, insert on public.task_intervention_events to service_role;
revoke all on public.task_intervention_events from anon, authenticated;

create or replace function public.decide_task_intervention(
  p_task_id uuid, p_decision text, p_feedback text default null
) returns boolean
language plpgsql security invoker set search_path = public
as $$
declare accepted boolean := false;
begin
  if p_decision not in ('approve', 'deny') then raise exception 'invalid intervention decision'; end if;
  update public.tasks
  set intervention_state = case when p_decision = 'approve' then 'approved' else 'denied' end,
      intervention_feedback = p_feedback,
      status = case when p_decision = 'deny' then 'cancelled' when status = 'running' then 'running' else 'pending' end,
      updated_at = now()
  where id = p_task_id and intervention_state = 'pending_approval';
  accepted := found;
  if accepted then
    insert into public.task_intervention_events (task_id, decision, feedback)
    values (p_task_id, p_decision, p_feedback);
  end if;
  return accepted;
end;
$$;
revoke all on function public.decide_task_intervention(uuid, text, text) from public, anon, authenticated;
grant execute on function public.decide_task_intervention(uuid, text, text) to service_role;
