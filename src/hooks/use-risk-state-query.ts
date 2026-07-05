'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { subscribeWithReconnect } from '@/lib/supabase/realtime';
import { useConnectionStore } from '@/lib/realtime/connection-store';
import type { RiskStateRow } from '@/lib/types/database.types';

export const RISK_STATE_KEY = ['risk-state'] as const;
const CHANNEL = 'risk-state-changes';

/** The single-row risk_state singleton — live status chips (regime, feed
 *  health, armed, halted, kill switch) read from here. */
export function useRiskStateQuery() {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  useEffect(() => {
    const { setChannelStatus, clearChannel } = useConnectionStore.getState();

    const dispose = subscribeWithReconnect({
      client: supabase,
      name: CHANNEL,
      onStatusChange: (s) => setChannelStatus(CHANNEL, s),
      build: (channel) =>
        channel.on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'risk_state' },
          (payload) => {
            queryClient.setQueryData<RiskStateRow>(RISK_STATE_KEY, () => payload.new as RiskStateRow);
          }
        ),
    });

    return () => {
      dispose();
      clearChannel(CHANNEL);
    };
  }, [queryClient, supabase]);

  return useQuery<RiskStateRow | null>({
    queryKey: RISK_STATE_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from('risk_state').select('*').eq('id', 1).maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 10_000,
  });
}
