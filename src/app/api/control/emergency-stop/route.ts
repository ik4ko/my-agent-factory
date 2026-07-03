import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';

// Global kill-switch. Invokes the scoped agent_emergency_stop() RPC, which
// only touches active agents/tasks. Guarded in the UI by an explicit confirm.
export async function POST() {
  try {
    const db = getAdminClient();
    const { data, error } = await db.rpc('agent_emergency_stop');
    if (error) throw error;

    await db.from('logs').insert({
      level: 'error',
      message: `[KILL-SWITCH] Emergency stop executed — ${data?.tasks_halted ?? 0} tasks, ${data?.agents_halted ?? 0} agents halted`,
    });

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Emergency stop failed' },
      { status: 500 }
    );
  }
}
