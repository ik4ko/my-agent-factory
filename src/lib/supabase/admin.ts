import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/types/database.types';

function makeAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

type AdminClient = ReturnType<typeof makeAdminClient>;
let _admin: AdminClient | null = null;

export function getAdminClient(): AdminClient {
  if (!_admin) _admin = makeAdminClient();
  return _admin;
}
