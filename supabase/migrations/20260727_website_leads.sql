-- Website lead intake for the Medicare CRM room.
--
-- Unqualified enquiries from aegissage.com land here — NOT in ag_clients.
-- ag_clients carries date_of_birth and medicare_beneficiary_identifier and
-- represents a qualified book of business; a public web form submission is a
-- stranger who may never become a client. A human promotes a lead to a client
-- after qualification, which is a decision rather than an insert.
--
-- Access follows the same model as the rest of the ag_ tables: RLS enabled,
-- service-role policy only, no browser client reads these directly. The
-- website writes through a narrow ingest route, never through the
-- operator-session CRM API.

create table if not exists public.ag_website_leads (
  id uuid primary key default gen_random_uuid(),

  -- Dedupe key supplied by the website. Unique, so a retried delivery
  -- resolves to the existing row instead of creating a second lead.
  source_lead_id text not null unique,
  website_submission_id uuid not null,
  contract_version text not null default '1.0.0',

  first_name text not null default '',
  last_name text not null default '',
  phone text,
  email text,
  zip text,

  preferred_contact text not null default 'phone',
  topic text,
  message text not null default '',

  source_page text not null default '',
  attribution jsonb not null default '{}'::jsonb,

  -- Consent snapshot as captured on the website. Three independent
  -- permissions. consent_sms is NEVER inferred from preferred_contact or from
  -- the presence of a phone number.
  consent_reply boolean not null default false,
  consent_reply_at timestamptz,
  consent_reply_version text,
  consent_sms boolean not null default false,
  consent_sms_at timestamptz,
  consent_sms_version text,
  consent_marketing boolean not null default false,
  consent_marketing_at timestamptz,
  consent_marketing_version text,

  -- Operational workflow.
  status text not null default 'new',
  assigned_to text,
  first_response_at timestamptz,
  last_contact_at timestamptz,
  next_action_at timestamptz,
  do_not_contact boolean not null default false,

  -- Set when a human converts this lead into a real CRM client.
  converted_client_id uuid references public.ag_clients(id) on delete set null,
  converted_at timestamptz,

  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ag_website_leads_status_valid check (
    status in (
      'new', 'notification_failed', 'unassigned', 'assigned', 'contact_attempted',
      'waiting_for_response', 'appointment_scheduled', 'enrolled', 'closed',
      'do_not_contact', 'needs_manual_review'
    )
  ),
  constraint ag_website_leads_preferred_contact_valid check (
    preferred_contact in ('phone', 'text', 'email')
  )
);

comment on table public.ag_website_leads is
  'Unqualified web enquiries from aegissage.com. Promoted to ag_clients by a human after qualification. Never write public form data straight into ag_clients.';
comment on column public.ag_website_leads.source_lead_id is
  'Idempotency key from the website. A repeat delivery must return the existing row, not create a second lead.';
comment on column public.ag_website_leads.consent_sms is
  'Explicit standalone SMS permission. Never inferred from preferred_contact = text or from a phone number being present.';

-- Append-only audit of every ingest attempt, including rejected ones. A lead
-- that failed signature verification is exactly the thing worth being able to
-- see after the fact.
create table if not exists public.ag_website_lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.ag_website_leads(id) on delete cascade,
  source_lead_id text,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.ag_website_lead_events is
  'Append-only audit trail for website lead ingest and status transitions.';

create index if not exists ag_website_leads_status_idx on public.ag_website_leads (status, submitted_at desc);
create index if not exists ag_website_leads_assigned_idx on public.ag_website_leads (assigned_to, status);
create index if not exists ag_website_leads_next_action_idx on public.ag_website_leads (next_action_at)
  where status not in ('closed', 'enrolled', 'do_not_contact');
create index if not exists ag_website_leads_needs_response_idx on public.ag_website_leads (submitted_at desc)
  where first_response_at is null and status not in ('closed', 'enrolled', 'do_not_contact');
create index if not exists ag_website_lead_events_lead_idx on public.ag_website_lead_events (lead_id, created_at desc);

do $$
declare
  table_name text;
  policy_name text;
begin
  foreach table_name in array array['ag_website_leads', 'ag_website_lead_events'] loop
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
