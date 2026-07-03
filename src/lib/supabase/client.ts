import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/types/database.types';

// Browser Supabase client — strictly public env only. NEXT_PUBLIC_* vars are
// inlined at BUILD time, so if the Vercel project is missing them the browser
// bundle compiles them to `undefined` and supabase-js throws
// "Invalid supabaseUrl: Must be a valid HTTP or HTTPS URL". We never reference
// the service-role key here (that would leak it into the client bundle).
//
// During SSR/prerender of client components, effects/subscriptions don't run,
// so we hand back a syntactically-valid placeholder client rather than crash
// the render; a genuinely missing/malformed var in the browser fails loudly.
const SSR_PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const SSR_PLACEHOLDER_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.AAAAAAAAAAAAAAAAAAAAAA';

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serverSide = typeof window === 'undefined';

  // Treat missing OR malformed URL the same way — a blank/garbage value would
  // otherwise reach supabase-js and produce the opaque "Invalid supabaseUrl".
  if (!url || !key || !isValidHttpUrl(url)) {
    if (serverSide) {
      console.warn(
        '[supabase/client] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY ' +
          'missing or invalid during SSR. Set them in the Vercel project environment ' +
          '(they are inlined at build time, so a redeploy is required after adding them).'
      );
      return createBrowserClient<Database>(SSR_PLACEHOLDER_URL, SSR_PLACEHOLDER_KEY);
    }
    throw new Error(
      'Missing or invalid Supabase env vars: NEXT_PUBLIC_SUPABASE_URL must be a valid ' +
        'http(s) URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set. In production these ' +
        'are inlined at build time — add them in Vercel and redeploy.'
    );
  }

  return createBrowserClient<Database>(url, key);
}
