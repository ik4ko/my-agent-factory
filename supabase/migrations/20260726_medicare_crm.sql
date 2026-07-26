-- Medicare CRM room data model. All tables are additive and isolated behind
-- the ag_ prefix so the room cannot reshape unrelated dashboard data.
-- The dashboard's operator-session proxy protects API access; these policies
-- also prevent direct client access to sensitive client records. The API is
-- the only intended access path and uses the operator-session gate plus the
-- service-role client.

create table if not exists public.ag_agency_settings (
  id uuid primary key default gen_random_uuid(),
  agency_name text not null default '',
  npn text,
  resident_state text,
  licensed_states text[] not null default '{}',
  ahip_status text not null default 'not_started',
  ahip_expires_at date,
  hipaa_status text not null default 'not_started',
  hipaa_expires_at date,
  compliance_flags jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ag_fmos (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active',
  start_date date,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ag_carriers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  fmo_id uuid references public.ag_fmos(id) on delete set null,
  appointment_status text not null default 'pending',
  lines_of_business text[] not null default '{}',
  active_states text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ag_clients (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  phone text,
  email text,
  date_of_birth date,
  physical_address text,
  city text,
  state text,
  zip text,
  medicare_beneficiary_identifier text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ag_client_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.ag_clients(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now(),
  created_by text
);

create table if not exists public.ag_policies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.ag_clients(id) on delete cascade,
  carrier_id uuid references public.ag_carriers(id) on delete set null,
  fmo_id uuid references public.ag_fmos(id) on delete set null,
  plan_name text not null,
  plan_id text,
  effective_date date,
  monthly_premium numeric(12, 2),
  commission_level text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ag_communications_log (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.ag_clients(id) on delete cascade,
  type text not null,
  content text not null default '',
  direction text not null default 'outbound',
  timestamp timestamptz not null default now(),
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.ag_compliance_documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.ag_clients(id) on delete set null,
  document_type text not null,
  title text not null,
  storage_path text,
  expires_at date,
  uploaded_at timestamptz not null default now(),
  notes text not null default ''
);

create index if not exists ag_carriers_fmo_idx on public.ag_carriers (fmo_id);
create index if not exists ag_carriers_status_idx on public.ag_carriers (appointment_status);
create index if not exists ag_clients_state_idx on public.ag_clients (state);
create index if not exists ag_clients_name_idx on public.ag_clients (last_name, first_name);
create index if not exists ag_notes_client_created_idx on public.ag_client_notes (client_id, created_at desc);
create index if not exists ag_policies_client_status_idx on public.ag_policies (client_id, status);
create index if not exists ag_policies_carrier_idx on public.ag_policies (carrier_id);
create index if not exists ag_policies_fmo_idx on public.ag_policies (fmo_id);
create index if not exists ag_comms_client_timestamp_idx on public.ag_communications_log (client_id, timestamp desc);
create index if not exists ag_documents_expiry_idx on public.ag_compliance_documents (expires_at);
create index if not exists ag_documents_client_idx on public.ag_compliance_documents (client_id);

do $$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array[
    'ag_agency_settings', 'ag_fmos', 'ag_carriers', 'ag_clients',
    'ag_client_notes', 'ag_policies', 'ag_communications_log',
    'ag_compliance_documents'
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
