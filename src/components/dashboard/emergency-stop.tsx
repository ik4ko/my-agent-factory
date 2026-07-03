'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, Loader2, X } from 'lucide-react';
import { useControlStore } from '@/lib/control/control-store';
import { emergencyStop } from '@/lib/control/actions';
import { cn } from '@/lib/utils';

export function EmergencyStop() {
  const open = useControlStore((s) => s.emergencyOpen);
  const openModal = useControlStore((s) => s.openEmergency);
  const closeModal = useControlStore((s) => s.closeEmergency);
  const qc = useQueryClient();

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await emergencyStop();
      // Pull fresh state so HALTED treatment appears immediately.
      await qc.invalidateQueries();
      closeModal();
      console.warn('[EmergencyStop]', res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Emergency stop failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        onClick={openModal}
        title="Emergency Stop — halt all active agents & tasks"
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-2 py-1 font-terminal text-[10px] font-bold uppercase tracking-wider',
          'border-neon-red/40 bg-neon-red/10 text-neon-red transition-colors',
          'hover:bg-neon-red/20 hover:border-neon-red/60'
        )}
      >
        <AlertOctagon className="size-3" />
        <span className="hidden sm:inline">E-Stop</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-neon-red/40 bg-surface-1 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neon-red/20 px-4 py-3">
              <div className="flex items-center gap-2 text-neon-red">
                <AlertOctagon className="size-4" />
                <span className="font-terminal text-xs font-bold uppercase tracking-[0.2em]">Emergency Stop</span>
              </div>
              <button onClick={closeModal} className="text-muted-foreground/40 hover:text-muted-foreground" disabled={pending}>
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-3 px-4 py-4">
              <p className="text-xs leading-relaxed text-foreground/80">
                This halts <span className="text-neon-red font-semibold">all active agents and running/pending tasks</span>:
                tasks are cancelled, agents are taken offline, and each is stamped <code className="font-terminal text-neon-red">halted_at</code>.
              </p>
              <p className="font-terminal text-[10px] text-muted-foreground/50">
                Scoped to the agent-orchestration tables only. This cannot be auto-undone.
              </p>
              {error && (
                <p className="rounded border border-neon-red/30 bg-neon-red/10 px-2 py-1.5 font-terminal text-[10px] text-neon-red">
                  {error}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
              <button
                onClick={closeModal}
                disabled={pending}
                className="rounded-md border border-border px-3 py-1.5 font-terminal text-[10px] text-muted-foreground transition-colors hover:border-muted-foreground/40"
              >
                Cancel
              </button>
              <button
                onClick={confirm}
                disabled={pending}
                className="flex items-center gap-1.5 rounded-md border border-neon-red/50 bg-neon-red/15 px-3 py-1.5 font-terminal text-[10px] font-bold uppercase tracking-wider text-neon-red transition-colors hover:bg-neon-red/25 disabled:opacity-50"
              >
                {pending ? <Loader2 className="size-3 animate-spin" /> : <AlertOctagon className="size-3" />}
                Confirm Halt
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
