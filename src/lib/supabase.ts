import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase admin client — bypasses RLS via the service role key.
 * Use ONLY in Server Actions and API routes. Never import into client components.
 *
 * Lazy singleton pattern: the client is created on first call, not at module
 * load time. This prevents `next build` from throwing during static page-data
 * collection when env vars are legitimately absent from the local build
 * environment (they are always set on Vercel at runtime).
 */

let _adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (_adminClient) return _adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');

  _adminClient = createClient(url, key);
  return _adminClient;
}

/**
 * @deprecated Use `getSupabaseAdmin()` instead.
 * This named export is kept for backwards compatibility while callers are
 * migrated. It resolves lazily via the same singleton getter.
 *
 * Direct property access (`supabaseAdmin.from(...)`) continues to work
 * because the Proxy forwards all property lookups to the underlying client.
 */
export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabaseAdmin() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
