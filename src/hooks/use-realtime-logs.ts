'use client';

import { useEffect, useState, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Log } from '@/lib/types/database.types';

export function useRealtimeLogs(initialLogs: Log[] = [], limit = 100) {
  const [logs, setLogs] = useState<Log[]>(initialLogs);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    if (initialLogs.length === 0) {
      supabase
        .from('logs')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit)
        .then(({ data }) => {
          if (data) setLogs(data.reverse());
        });
    }

    const channel = supabase
      .channel('logs-stream')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'logs' },
        (payload) => {
          setLogs((prev) => [...prev, payload.new as Log].slice(-limit));
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return logs;
}
