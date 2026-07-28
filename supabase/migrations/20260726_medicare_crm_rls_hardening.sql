-- Harden existing installs of the Medicare CRM migration. The application
-- authenticates through the operator session proxy and reads via service role;
-- no browser Supabase client should read these tables directly.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'ag_agency_settings', 'ag_fmos', 'ag_carriers', 'ag_clients',
    'ag_client_notes', 'ag_policies', 'ag_communications_log',
    'ag_compliance_documents'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_authenticated', table_name);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = table_name and policyname = table_name || '_service_role'
    ) then
      execute format(
        'create policy %I on public.%I for all to service_role using (true) with check (true)',
        table_name || '_service_role', table_name
      );
    end if;
  end loop;
end $$;
