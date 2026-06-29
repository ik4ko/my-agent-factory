import { Cpu, Wifi, Terminal } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { DashboardClient } from '@/components/dashboard/dashboard-client';
import { LiveClock } from '@/components/dashboard/live-clock';
import { AudioBriefing } from '@/components/dashboard/audio-briefing';
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
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-2">
        <Cpu className="size-3.5 text-primary" />
        <span className="font-display text-sm font-semibold tracking-wide text-foreground/90">
          My Agent Factory
        </span>
        <span className="hidden text-[10px] uppercase tracking-widest text-muted-foreground sm:block">
          — Control Room
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden font-terminal text-[10px] text-muted-foreground/40 sm:flex items-center gap-1">
          <Terminal className="size-2.5" /> ⌘K to command
        </span>
        <AudioBriefing />
        <div className="flex items-center gap-1.5 font-terminal text-[10px] text-neon-green animate-glow-pulse">
          <Wifi className="size-3" />
          <span>LIVE</span>
        </div>
        <LiveClock />
      </div>
    </header>
  );
}

export default async function DashboardPage() {
  const { agents, tasks, logs } = await fetchDashboardData();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar />
      <DashboardClient
        initialAgents={agents}
        initialTasks={tasks}
        initialLogs={logs}
      />
    </div>
  );
}
