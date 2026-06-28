import { createClient } from '@supabase/supabase-js'

// HARD SERVER-ONLY GUARD: the service-role key bypasses RLS. If this module is
// ever imported into a client bundle, fail loudly at module-eval time rather
// than shipping a broken/credential-bearing client. (No 'server-only' dep
// available, so we assert the runtime instead.)
if (typeof window !== 'undefined') {
  throw new Error('lib/supabase/service.ts imported in a browser context — service-role client is server-only')
}

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set — refusing to create an unprivileged service client')
  return createClient(url!, key)
}
