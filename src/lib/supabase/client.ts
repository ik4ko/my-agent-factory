import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/types/database.types';

// Placeholder used only during SSR/prerender when env vars haven't been inlined yet.
// Effects and subscriptions never execute server-side, so this stub is never used for real calls.
const SSR_PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const SSR_PLACEHOLDER_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.AAAAAAAAAAAAAAAAAAAAAA';

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    if (typeof window === 'undefined') {
      // Server-side render / static prerender: NEXT_PUBLIC_ vars are inlined at build time,
      // so this path means the Vercel project env vars are not yet configured.
      // Return a no-op stub — React effects/subscriptions do not fire server-side.
      console.warn(
        '[supabase/client] NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing ' +
          'during SSR. Configure them in Vercel project environment variables.'
      );
      return createBrowserClient<Database>(SSR_PLACEHOLDER_URL, SSR_PLACEHOLDER_KEY);
    }
    // Browser context: this is a genuine misconfiguration — fail loudly.
    throw new Error(
      'Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Set them in .env.local and restart the dev server.'
    );
  }

  return createBrowserClient<Database>(url, key);
}
