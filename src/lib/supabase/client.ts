import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/types/database.types';

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      'Missing Supabase env vars. Ensure NEXT_PUBLIC_SUPABASE_URL and ' +
      'NEXT_PUBLIC_SUPABASE_ANON_KEY are set in .env.local, then restart the dev server.'
    );
  }
  return createBrowserClient<Database>(url, key);
}
