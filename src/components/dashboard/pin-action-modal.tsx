'use client';

import { useState } from 'react';
import { Loader2, ShieldAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PinActionModalProps {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (pin: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}

/** Shared PIN-gated confirm modal for privileged actions (arm/disarm/kill).
 *  Never optimistic — only closes and reports success once the server has
 *  actually confirmed it. */
export function PinActionModal({ title, description, confirmLabel, danger, onConfirm, onClose }: PinActionModalProps) {
  const [pin, setPin] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!pin) return;
    setPending(true);
    setError(null);
    try {
      const result = await onConfirm(pin);
      if (!result.ok) {
        setError(result.error ?? 'rejected');
        return;
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'offline — could not confirm');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4">
      <div className={cn('w-full max-w-sm rounded-xl border bg-surface-1 shadow-2xl', danger ? 'border-neon-red/40' : 'border-primary/30')}>
        <div className={cn('flex items-center justify-between border-b px-4 py-3', danger ? 'border-neon-red/20' : 'border-border')}>
          <div className={cn('flex items-center gap-2', danger ? 'text-neon-red' : 'text-primary')}>
            <ShieldAlert className="size-4" />
            <span className="font-terminal text-xs font-bold uppercase tracking-[0.2em]">{title}</span>
          </div>
          <button onClick={onClose} disabled={pending} className="flex size-9 items-center justify-center text-muted-foreground/40 hover:text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-3 px-4 py-4">
          <p className="text-xs leading-relaxed text-foreground/80">{description}</p>
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Operator PIN"
            className="h-11 w-full rounded-md border border-border bg-background px-3 text-center text-lg tracking-[0.3em]"
          />
          {error && (
            <p className="rounded border border-neon-red/30 bg-neon-red/10 px-2 py-1.5 font-terminal text-[10px] text-neon-red">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={onClose}
            disabled={pending}
            className="flex min-h-11 items-center rounded-md border border-border px-3 font-terminal text-[10px] text-muted-foreground hover:border-muted-foreground/40"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={pending || !pin}
            className={cn(
              'flex min-h-11 items-center gap-1.5 rounded-md border px-3 font-terminal text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50',
              danger
                ? 'border-neon-red/50 bg-neon-red/15 text-neon-red hover:bg-neon-red/25'
                : 'border-primary/50 bg-primary/15 text-primary hover:bg-primary/25'
            )}
          >
            {pending && <Loader2 className="size-3 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
