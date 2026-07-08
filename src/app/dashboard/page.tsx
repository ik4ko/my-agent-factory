// Dashboard uses cookies() for Supabase SSR auth — must never be statically rendered.
export const dynamic = 'force-dynamic';

import { Cpu, Terminal } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { DashboardClient } from '@/components/dashboard/dashboard-client';
import { LiveClock } from '@/components/dashboard/live-clock';
import { ConnectionIndicator } from '@/components/dashboard/connection-indicator';
import { TimelineScrubber } from '@/components/dashboard/timeline-scrubber';
import { SystemHealthPill } from '@/components/dashboard/system-health-pill';
import { WidgetErrorBoundary } from '@/components/dashboard/widget-error-boundary';
import AudioBriefing from '@/components/dashboard/client-audio-briefing';
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
      tasks:  (tasksRes.data  ?? []) as Task[],
      logs:   ((logsRes.data  ?? []) as Log[]).reverse(),
    };
  } catch (err) {
    console.error('[fetchDashboardData]', err);
    return { agents: [] as Agent[], tasks: [] as Task[], logs: [] as Log[] };
  }
}

function TopBar() {
  return (
    // pr-36 reserves the top-right corner for the global controls cluster
    // (E-STOP + ambient chat) rendered by the shared layout.
    <header className="hairline-b flex h-11 shrink-0 items-center justify-between px-4 pr-36 surface-glass">
      <div className="flex items-center gap-2">
        <Cpu className="size-3.5 text-primary" />
        <span className="font-display text-sm font-semibold tracking-wide text-foreground/90">
          My Agent Factory
        </span>
        <span className="hidden text-[10px] uppercase tracking-widest text-muted-foreground sm:block">
          — Main Dashboard
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden font-terminal text-[10px] text-muted-foreground/40 sm:flex items-center gap-1">
          <Terminal className="size-2.5" /> ⌘K · / console
        </span>
        <WidgetErrorBoundary name="Health" compact>
          <SystemHealthPill />
        </WidgetErrorBoundary>
        <TimelineScrubber />
        <AudioBriefing />
        <ConnectionIndicator />
        <LiveClock />
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
