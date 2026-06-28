'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export interface RiskEvent {
  id: string;
  agency_id: string;
  ghl_contact_id: string;
  event_type: string;
  risk_level: 'HIGH' | 'LOW';
  previous_value: string | null;
  new_value: string | null;
  trigger_reason: string | null;
  days_until_effective: number | null;
  source: string | null;
  created_at: string;
}

interface UseRiskEventsResult {
  events: RiskEvent[];
  loading: boolean;
  error: string | null;
}

export function useRiskEvents(agencyId: string): UseRiskEventsResult {
  const [events, setEvents] = useState<RiskEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!agencyId) {
      setLoading(false);
      return;
    }

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    supabase
      .from('retention_events')
      .select('*')
      .eq('agency_id', agencyId)
      .eq('risk_level', 'HIGH')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data, error: fetchError }) => {
        if (fetchError) {
          console.error('[useRiskEvents] fetch error:', fetchError);
          setError('retention_events unavailable');
        } else {
          setEvents((data ?? []) as RiskEvent[]);
        }
        setLoading(false);
      });

    const channel = supabase
      .channel(`retention_events:${agencyId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'retention_events',
          filter: `agency_id=eq.${agencyId}`,
        },
        (payload) => {
          if (
            payload.eventType === 'INSERT' &&
            (payload.new as RiskEvent).risk_level === 'HIGH'
          ) {
            setEvents((prev) => [payload.new as RiskEvent, ...prev].slice(0, 20));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [agencyId]);

  return { events, loading, error };
}
