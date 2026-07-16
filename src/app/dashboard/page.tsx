// Dashboard uses cookies() for Supabase SSR auth — must never be statically rendered.
export const dynamic = 'force-dynamic';

import { Cpu } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { DashboardClient } from '@/components/dashboard/dashboard-client';
import type { Agent, Task, Log } from '@/lib/types/database.types';

async function fetchDashboardData() {
  try {
    const supabase = await createClient();
    const [agentsRes, tasksRes, logsRes] = await Promise.all([
      supabase.from('agents').select('*').order('created_at', { ascending: true }),
      supabase.from('tasks').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('logs').select('*').order('timestamp', { ascending: false }).limit(80),
    ]);
    return {
      agents: (agentsRes.data ?? []) as Agent[],
      tasks: (tasksRes.data ?? []) as Task[],
      logs: ((logsRes.data ?? []) as Log[]).reverse(),
    };
  } catch (err) {
    console.error('[fetchDashboardData]', err);
    return { agents: [] as Agent[], tasks: [] as Task[], logs: [] as Log[] };
  }
}

function TopBar() {
  return (
    <header className="hairline-b flex h-11 shrink-0 items-center gap-4 px-4 surface-glass">
      <div className="flex min-w-0 items-center gap-2">
        <Cpu className="size-3.5 text-primary" />
        <span className="font-display text-sm font-semibold tracking-wide text-foreground/90">
          My Agent Factory
        </span>
      </div>
    </header>
  );
}

export default async function DashboardPage() {
  const { agents, tasks, logs } = await fetchDashboardData();

  return (
    <div className="relative isolate flex h-full flex-col overflow-hidden">
      <TopBar />
      <DashboardClient
        initialAgents={agents}
        initialTasks={tasks}
        initialLogs={logs}
      />
    </div>
  );
}
