'use client';

import { useEffect, useState, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Agent } from '@/lib/types/database.types';

export function useRealtimeAgents(initialAgents: Agent[] = []) {
  const [agents, setAgents] = useState<Agent[]>(initialAgents);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    // Fetch on mount if no initial data
    if (initialAgents.length === 0) {
      supabase
        .from('agents')
        .select('*')
        .order('created_at', { ascending: true })
        .then(({ data }) => {
          if (data) setAgents(data);
        });
    }

    const channel = supabase
      .channel('agents-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agents' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setAgents((prev) => [...prev, payload.new as Agent]);
          } else if (payload.eventType === 'UPDATE') {
            setAgents((prev) =>
              prev.map((a) => (a.id === payload.new.id ? (payload.new as Agent) : a))
            );
          } else if (payload.eventType === 'DELETE') {
            setAgents((prev) => prev.filter((a) => a.id !== payload.old.id));
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') {
          console.error('[Realtime:agents-changes] channel error', err);
        } else if (status === 'TIMED_OUT') {
          console.warn('[Realtime:agents-changes] subscription timed out');
        }
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return agents;
}
