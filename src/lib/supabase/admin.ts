import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database.types';

function makeAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      '[admin] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Set both in .env.local (get service role key from supabase.com/dashboard/project/_/settings/api).'
    );
  }
  return createClient<Database>(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type AdminClient = ReturnType<typeof makeAdminClient>;
let _admin: AdminClient | null = null;

export function getAdminClient(): AdminClient {
  if (!_admin) _admin = makeAdminClient();
  return _admin;
}
