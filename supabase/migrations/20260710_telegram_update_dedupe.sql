-- Telegram operator command dedupe (event-loop step 2).
--
-- Telegram's getUpdates is at-least-once: an update whose offset was never
-- acked (watcher crash mid-handling) is redelivered on restart. The staged-
-- order approval route is already once-only via its
-- `human_approval_status = 'PENDING'` CAS predicate, but we additionally
-- CLAIM each update_id in system_bus *before* the action fires, so a
-- redelivered command can never re-enter the action path at all.
--
-- The marker is born 'consumed': the engine pump only reads
-- topic = 'pipeline.step.completed' AND status = 'pending', so this row can
-- never be mistaken for hand-off work.

-- 1. Allow the operator-command topic.
alter table public.system_bus drop constraint if exists system_bus_topic_check;
alter table public.system_bus add constraint system_bus_topic_check
  check (topic in (
    'pipeline.step.completed',
    'pipeline.completed',
    'agent.thought',
    'operator.telegram.update'
  ));

-- 2. The dedupe key itself: one row per Telegram update_id, enforced by the
--    database. The insert either wins (first delivery) or raises 23505
--    (redelivery) — an atomic claim with no read-then-write race.
create unique index if not exists system_bus_telegram_update_uniq
  on public.system_bus ((payload ->> 'update_id'))
  where topic = 'operator.telegram.update';
