-- Medicare operations cockpit: coverage review, operator work queue, audit.
--
-- The organising rule of this migration is that NOTHING here writes to
-- ag_clients or ag_policies. Imported, scraped, and verified data lands in
-- ag_coverage_snapshots (immutable observations) and surfaces as
-- ag_coverage_diffs (proposals). A human accepts a diff, and only that accept
-- action mutates the book of business. An observation is not a decision.
--
-- This is deliberately the opposite of the existing /api/medicare-crm import,
-- which upserts spreadsheet rows straight onto live records. That path is
-- being retired in favour of this one.
--
-- Access follows the established ag_ model: RLS enabled, service-role policy
-- only, no browser client touches these directly. The operator-session API is
-- the sole read path for humans; the extension lane (Phase 4) gets its own
-- bearer-token route and writes snapshots, never client records.

-- ── Client / policy review fields ───────────────────────────────────────────
-- Additive nullable columns only. Nothing existing is reshaped or backfilled.

alter table public.ag_clients
  add column if not exists last_verified_at timestamptz,
  add column if not exists next_review_at timestamptz;

comment on column public.ag_clients.last_verified_at is
  'When this client''s coverage was last confirmed against an external source. Null means never verified, which is a work-queue condition rather than an error.';
comment on column public.ag_clients.next_review_at is
  'When this client is next due for a coverage review. Drives the Today queue.';

alter table public.ag_policies
  add column if not exists contract_pbp text,
  add column if not exists last_verified_at timestamptz;

-- CMS identifies a Medicare Advantage plan by contract + PBP (e.g. H1234-001).
-- ag_policies.plan_id already exists but is a free-text carrier-supplied value
-- with no agreed shape, so it cannot be compared reliably. contract_pbp is the
-- normalised comparison key the MARx verification path needs, stored separately
-- rather than overloading plan_id and breaking whatever already writes it.
comment on column public.ag_policies.contract_pbp is
  'Normalised CMS contract-PBP (uppercase, delimiters stripped, e.g. H1234001). The comparison key for coverage verification. Distinct from plan_id, which is free-text carrier data.';

-- ── Coverage snapshots ──────────────────────────────────────────────────────
-- One immutable observation of a member's coverage from one source at one
-- time. Rows are never updated; a later observation is a new row. This is the
-- provenance record that lets an operator answer "where did this come from and
-- when did we see it?" months later.

create table if not exists public.ag_coverage_snapshots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.ag_clients(id) on delete cascade,
  policy_id uuid references public.ag_policies(id) on delete set null,

  -- Where the observation came from. 'marx' is the CMS portal via the browser
  -- extension; 'carrier_portal' is a carrier roster sync; 'import' is an
  -- operator-uploaded file; 'manual' is Eric typing what a carrier told him.
  source text not null,
  source_detail text not null default '',

  observed_at timestamptz not null,

  -- Observed coverage. All nullable: a "member not found" result is a real
  -- observation that carries no plan data, and forcing empty strings here
  -- would make it indistinguishable from a plan with a blank name.
  contract_pbp text,
  plan_name text,
  carrier_name text,
  effective_date date,
  end_date date,
  plan_status text,

  -- The classification the source assigned. Mirrors the states the existing
  -- browser extension already produces in classifyMarxResult(), plus the
  -- failure categories a job can end in, so a verification attempt that could
  -- not complete is recorded rather than silently dropped.
  verification_status text not null,

  -- Untouched source payload, for auditing a parse that later looks wrong.
  raw jsonb not null default '{}'::jsonb,
  evidence_ref text,

  -- Same source + member + verification period must not create a second
  -- snapshot. Re-running a batch is therefore free, which is what makes the
  -- retry path safe to press repeatedly.
  idempotency_key text not null unique,

  created_at timestamptz not null default now(),

  constraint ag_coverage_snapshots_source_valid check (
    source in ('marx', 'carrier_portal', 'import', 'manual')
  ),
  constraint ag_coverage_snapshots_status_valid check (
    verification_status in (
      'active_same', 'active_changed', 'pending_switch', 'no_ma_plan', 'not_found',
      'source_unavailable', 'login_required', 'mfa_required', 'captcha_encountered',
      'rate_limited', 'ambiguous_match', 'needs_review', 'completed_with_warnings', 'failed'
    )
  )
);

comment on table public.ag_coverage_snapshots is
  'Immutable coverage observations. Never updated in place. Writing here does not change ag_clients or ag_policies — that requires an accepted ag_coverage_diffs row.';
comment on column public.ag_coverage_snapshots.idempotency_key is
  'source:client:period. Re-importing an unchanged result is a no-op rather than a duplicate, which is what stops the same finding from re-alerting every run.';

-- ── Coverage diffs ──────────────────────────────────────────────────────────
-- A proposed change to one field of the book of business, awaiting a human.
-- Accepting one is the ONLY automated path that writes ag_clients/ag_policies,
-- and it runs as an explicit operator action with an audit record.

create table if not exists public.ag_coverage_diffs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.ag_clients(id) on delete cascade,
  policy_id uuid references public.ag_policies(id) on delete set null,
  snapshot_id uuid not null references public.ag_coverage_snapshots(id) on delete cascade,

  -- Which column the proposal targets, e.g. 'ag_policies.contract_pbp'.
  -- Qualified so a diff is unambiguous about what it would rewrite.
  target_table text not null,
  target_field text not null,

  -- Values as text: this is a review artefact for a human to read, not a typed
  -- staging row. The accept path re-reads and casts from the snapshot.
  current_value text,
  incoming_value text,

  source text not null,
  observed_at timestamptz not null,
  confidence text not null default 'medium',

  status text not null default 'pending',
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text not null default '',

  -- Same proposal must not queue twice. An unchanged plan re-observed next
  -- month collides here and is discarded instead of nagging Eric again.
  idempotency_key text not null unique,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ag_coverage_diffs_status_valid check (
    status in ('pending', 'accepted', 'rejected', 'follow_up', 'superseded')
  ),
  constraint ag_coverage_diffs_confidence_valid check (
    confidence in ('low', 'medium', 'high')
  ),
  constraint ag_coverage_diffs_target_valid check (
    target_table in ('ag_clients', 'ag_policies')
  )
);

comment on table public.ag_coverage_diffs is
  'Proposed changes to client/policy records awaiting explicit operator approval. Accepting a diff is the only automated write path into ag_clients/ag_policies.';

-- ── Operator tasks ──────────────────────────────────────────────────────────
-- The non-lead half of the Today queue. Created only for conditions that
-- genuinely need Eric, and deduped so a recurring unchanged observation does
-- not manufacture a new task every run.

create table if not exists public.ag_operator_tasks (
  id uuid primary key default gen_random_uuid(),

  kind text not null,
  title text not null,
  detail text not null default '',

  -- Optional anchors. A task may hang off a client, a website lead, or a
  -- pending diff; a failed-import task hangs off none of them.
  client_id uuid references public.ag_clients(id) on delete cascade,
  lead_id uuid references public.ag_website_leads(id) on delete cascade,
  diff_id uuid references public.ag_coverage_diffs(id) on delete cascade,

  priority text not null default 'normal',
  due_at timestamptz,

  status text not null default 'open',
  snoozed_until timestamptz,

  source text not null default 'system',
  assigned_to text,

  -- kind:anchor:period. The idempotency rule that keeps the queue honest.
  dedupe_key text not null unique,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by text,

  constraint ag_operator_tasks_priority_valid check (
    priority in ('urgent', 'high', 'normal', 'low')
  ),
  constraint ag_operator_tasks_status_valid check (
    status in ('open', 'snoozed', 'done', 'dismissed')
  )
);

comment on table public.ag_operator_tasks is
  'Operator work queue. dedupe_key prevents an unchanged recurring condition from creating a fresh task on every verification run.';

-- ── Audit events ────────────────────────────────────────────────────────────
-- Append-only. Every operator decision that changes client or policy data
-- writes one, with before/after, so a coverage change can be reconstructed.

create table if not exists public.ag_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor text not null default 'operator',
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb not null default '{}'::jsonb,
  after jsonb not null default '{}'::jsonb,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.ag_audit_events is
  'Append-only audit of operator decisions affecting CRM data. Never updated or deleted.';

-- ── Indexes ─────────────────────────────────────────────────────────────────

create index if not exists ag_coverage_snapshots_client_idx
  on public.ag_coverage_snapshots (client_id, observed_at desc);
create index if not exists ag_coverage_snapshots_status_idx
  on public.ag_coverage_snapshots (verification_status, observed_at desc);

-- Partial: the review queue only ever reads pending rows, and it reads them
-- oldest-first so the longest-waiting decision surfaces rather than rots.
create index if not exists ag_coverage_diffs_pending_idx
  on public.ag_coverage_diffs (observed_at)
  where status = 'pending';
create index if not exists ag_coverage_diffs_client_idx
  on public.ag_coverage_diffs (client_id, created_at desc);

create index if not exists ag_operator_tasks_queue_idx
  on public.ag_operator_tasks (priority, due_at)
  where status = 'open';
create index if not exists ag_operator_tasks_client_idx
  on public.ag_operator_tasks (client_id, status);
create index if not exists ag_operator_tasks_snoozed_idx
  on public.ag_operator_tasks (snoozed_until)
  where status = 'snoozed';

create index if not exists ag_audit_events_entity_idx
  on public.ag_audit_events (entity_type, entity_id, created_at desc);
create index if not exists ag_audit_events_created_idx
  on public.ag_audit_events (created_at desc);

-- Review-due lookup for the Today queue.
create index if not exists ag_clients_next_review_idx
  on public.ag_clients (next_review_at)
  where next_review_at is not null;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Identical shape to 20260726_medicare_crm.sql and 20260727_website_leads.sql:
-- RLS on, one service-role policy, nothing for anon or authenticated. The
-- browser cannot reach these tables; only the server's service-role client can.

do $$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array[
    'ag_coverage_snapshots', 'ag_coverage_diffs',
    'ag_operator_tasks', 'ag_audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    policy_name := table_name || '_service_role';
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = table_name and policyname = policy_name
    ) then
      execute format(
        'create policy %I on public.%I for all to service_role using (true) with check (true)',
        policy_name, table_name
      );
    end if;
  end loop;
end $$;
