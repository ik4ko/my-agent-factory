'use client';

import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import type { StagedOrderRow } from '@/lib/types/database.types';

/** Shared query key for the pending human-approval staged-order queue.
 *  One fetch, many readers (the gate + the Kelly instrument both subscribe;
 *  React Query dedupes by key so there is a single round-trip and a single
 *  cache the realtime channel invalidates). */
export const STAGED_ORDERS_KEY = ['staged-orders', 'pending'] as const;

/** Pending staged orders awaiting a human verdict — the real rows the
 *  execution gate enforces. Read-only fetch; mutations go through
 *  PATCH /api/trading/action-order. */
export function useStagedOrders() {
  const supabase = createClient();
  return useQuery<StagedOrderRow[]>({
    queryKey: STAGED_ORDERS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staged_orders')
        .select('*')
        .eq('human_approval_status', 'PENDING')
        .order('created_at', { ascending: false })
        .limit(8);
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
}
