'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, Loader2, X } from 'lucide-react';
import { useControlStore } from '@/lib/control/control-store';
import { emergencyStop } from '@/lib/control/actions';
import { playEstopArmTone } from '@/lib/ui/tones';
import { cn } from '@/lib/utils';

/**
 * EmergencyStop — the kill switch, pinned top-right and reachable from every room.
 *
 * DESIGN DECISION — intentional asymmetry, NOT an inconsistency to "fix":
 * E-STOP is gated by a confirm MODAL only, deliberately NOT by the OPERATOR_PIN.
 * Arming paper simulation (the arm flow via pin-action-modal) IS PIN-gated. The
 * asymmetry is by design and correct: enabling risk should carry friction (a
 * PIN), while the safety egress that HALTS everything must be as fast as
 * possible — a PIN prompt on the kill switch would be a safety regression under
 * pressure. The confirm modal keeps it one deliberate step (no accidental
 * trigger) without the latency of a passphrase. Do not add a PIN here.
 */
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
    playEstopArmTone();
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
        suppressHydrationWarning={true}
        title="Emergency Stop — halts all active agents & tasks (agent orchestration only; does not and cannot touch a brokerage)"
        aria-label="Emergency stop: halt all active agents and tasks. Agent orchestration only — no live trading is connected."
        className={cn(
          'wt-hover flex items-center gap-1.5 rounded-md border px-2 py-1 font-terminal text-[10px] uppercase tracking-wider',
          'border-estop/35 bg-estop/[0.08] text-estop transition-colors',
          'hover:bg-estop/[0.18] hover:border-estop/55'
        )}
      >
        <AlertOctagon className="size-3" />
        <span className="hidden sm:inline">E-Stop</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-estop/40 bg-surface-1 shadow-2xl">
            <div className="flex items-center justify-between border-b border-estop/20 px-4 py-3">
              <div className="flex items-center gap-2 text-estop">
                <AlertOctagon className="size-4" />
                <span className="font-terminal text-xs font-bold uppercase tracking-[0.2em]">Emergency Stop</span>
              </div>
              <button onClick={closeModal} className="text-muted-foreground/40 hover:text-muted-foreground" disabled={pending}>
                <X className="size-4" />
              </button>
            </div>

            <div className="space-y-3 px-4 py-4">
              <p className="text-xs leading-relaxed text-foreground/80">
                This halts <span className="text-estop font-semibold">all active agents and running/pending tasks</span>:
                tasks are cancelled, agents are taken offline, and each is stamped <code className="font-terminal text-estop">halted_at</code>.
              </p>
              <p className="font-terminal text-[10px] text-muted-foreground/50">
                Scoped to the agent-orchestration tables only. This cannot be auto-undone.
              </p>
              {error && (
                <p className="rounded border border-estop/30 bg-estop/10 px-2 py-1.5 font-terminal text-[10px] text-estop">
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
                className="wt-hover flex items-center gap-1.5 rounded-md border border-estop/50 bg-estop/15 px-3 py-1.5 font-terminal text-[10px] uppercase tracking-wider text-estop transition-colors hover:bg-estop/25 disabled:opacity-50"
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
