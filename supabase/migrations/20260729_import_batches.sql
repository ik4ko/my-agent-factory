-- Staged imports: the replacement for the direct upsert retired in
-- 20260728_medicare_cockpit.
--
-- The rule this schema exists to enforce: an uploaded file never writes to
-- ag_clients or ag_policies. A file becomes an import batch, each row becomes
-- an import record with a decided disposition, and committing the batch emits
-- coverage snapshots and coverage diffs — which then go through the same human
-- approval gate every other observation goes through.
--
-- So the path from "spreadsheet on Eric's desktop" to "the book of business
-- changed" runs through two explicit human decisions: confirm the batch, then
-- accept each proposed change. That is deliberate. A carrier export is a claim
-- about the world, not an instruction.

create table if not exists public.ag_import_batches (
  id uuid primary key default gen_random_uuid(),

  -- Provenance. Kept for the life of the batch and never rewritten: months
  -- later "where did this value come from?" must be answerable.
  source_kind text not null,
  source_label text not null default '',
  original_filename text,
  file_size_bytes integer,
  file_sha256 text,
  row_count integer not null default 0,

  -- Which entity the rows describe.
  entity text not null,

  operator text not null default 'operator',

  -- Mapping from file header -> canonical field, as confirmed by the operator.
  field_mapping jsonb not null default '{}'::jsonb,

  status text not null default 'draft',

  -- Tallies, filled at preview and frozen at commit.
  created_count integer not null default 0,
  matched_count integer not null default 0,
  changed_count integer not null default 0,
  rejected_count integer not null default 0,
  duplicate_count integer not null default 0,

  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  committed_at timestamptz,
  rolled_back_at timestamptz,

  constraint ag_import_batches_source_valid check (
    source_kind in ('csv_upload', 'xlsx_upload', 'google_sheet', 'carrier_portal', 'manual')
  ),
  constraint ag_import_batches_entity_valid check (
    entity in ('clients', 'policies', 'coverage')
  ),
  constraint ag_import_batches_status_valid check (
    status in ('draft', 'previewed', 'committed', 'rejected', 'failed', 'rolled_back')
  )
);

comment on table public.ag_import_batches is
  'An uploaded file, staged. Committing a batch emits coverage snapshots and diffs for review — it never writes ag_clients or ag_policies directly.';

-- One row of the source file, with its raw content preserved and the
-- disposition the preview assigned to it.
create table if not exists public.ag_import_records (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.ag_import_batches(id) on delete cascade,

  -- 1-based row number in the source file, so an error message can name the
  -- line the operator sees in their spreadsheet.
  row_number integer not null,

  -- Exactly what the file contained, before normalisation. This is the
  -- provenance record; the normalised view is derived and disposable.
  raw jsonb not null default '{}'::jsonb,
  normalized jsonb not null default '{}'::jsonb,

  -- What the preview decided this row would do.
  disposition text not null default 'pending',

  -- Identity resolution outcome.
  matched_client_id uuid references public.ag_clients(id) on delete set null,
  matched_policy_id uuid references public.ag_policies(id) on delete set null,
  match_confidence text,
  /* Every candidate considered, so an ambiguous match can be explained rather
     than merely reported. */
  match_candidates jsonb not null default '[]'::jsonb,

  -- Validation problems, one entry per failed rule.
  issues jsonb not null default '[]'::jsonb,

  snapshot_id uuid references public.ag_coverage_snapshots(id) on delete set null,

  created_at timestamptz not null default now(),

  constraint ag_import_records_disposition_valid check (
    disposition in ('pending', 'create', 'match', 'change', 'unchanged', 'duplicate', 'ambiguous', 'rejected')
  ),
  constraint ag_import_records_confidence_valid check (
    match_confidence is null or match_confidence in ('low', 'medium', 'high', 'exact')
  ),
  -- A row cannot appear twice in the same batch.
  constraint ag_import_records_batch_row_unique unique (batch_id, row_number)
);

comment on table public.ag_import_records is
  'One source-file row with its raw content preserved. raw is never rewritten — it is the provenance of every value the batch proposes.';

create index if not exists ag_import_batches_status_idx
  on public.ag_import_batches (status, created_at desc);
create index if not exists ag_import_records_batch_idx
  on public.ag_import_records (batch_id, row_number);
create index if not exists ag_import_records_disposition_idx
  on public.ag_import_records (batch_id, disposition);
create index if not exists ag_import_records_client_idx
  on public.ag_import_records (matched_client_id)
  where matched_client_id is not null;

-- Same access model as every other ag_ table: RLS on, service-role policy
-- only, no anon and no authenticated. Import files carry PII, so the browser
-- must not be able to read these rows directly.
do $$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array['ag_import_batches', 'ag_import_records'] loop
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
