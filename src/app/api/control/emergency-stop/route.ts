import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';

// Global kill-switch. Invokes the scoped agent_emergency_stop() RPC, which
// only touches active agents/tasks — rows, not OS processes. The sprint
// engine on the persistent Render host cannot be reached from here directly,
// so this route ALSO raises a control.estop flag on system_bus; the engine
// polls it every few seconds and performs the actual SIGTERM→SIGKILL
// process-group kill plus the sprint_loops → ABORTED transition on its side.
export async function POST() {
  try {
    const db = getAdminClient();
    const { data, error } = await db.rpc('agent_emergency_stop');
    if (error) throw error;

    // Raise the sprint-engine flag. Failure here must be VISIBLE, not fatal:
    // the RPC half already succeeded, so report both halves explicitly.
    const { error: flagError } = await db.from('system_bus').insert({
      topic: 'control.estop',
      agent: 'emergency-stop-route',
      pipeline_id: null,
      task_id: null,
      payload: { source: 'emergency-stop-route', at: new Date().toISOString() },
      status: 'pending',
      consumed_at: null,
    });

    await db.from('logs').insert({
      level: 'error',
      message: `[KILL-SWITCH] Emergency stop executed — ${data?.tasks_halted ?? 0} tasks, ${data?.agents_halted ?? 0} agents halted; sprint-engine flag ${flagError ? `FAILED: ${flagError.message}` : 'raised'}`,
    });

    return NextResponse.json({
      ...data,
      sprint_engine_flag: flagError ? `failed: ${flagError.message}` : 'raised',
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Emergency stop failed' },
      { status: 500 }
    );
  }
}
