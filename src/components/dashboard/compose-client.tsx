'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LOOPS_KEY } from '@/hooks/use-loops-query';
import type { EventSeverity, EventType, LoopKind } from '@/lib/types/database.types';

const KIND_OPTIONS: LoopKind[] = ['monitor', 'research', 'build', 'personal', 'trade'];
const BRAIN_OPTIONS = ['claude', 'codex', 'hermes'] as const;
const TRIGGER_TYPES: EventType[] = ['news', 'price', 'earnings', 'manual', 'phone'];
const SEVERITIES: EventSeverity[] = ['low', 'med', 'high', 'critical'];

interface TriggerDraft {
  type: EventType;
  symbol: string;
  minSeverity: EventSeverity;
}

const inputCls = 'h-11 w-full rounded-md border border-border bg-background px-3 text-sm';

/** Author view — "send our prompts / loops from my phone." Creates a loop
 *  (paused by default) with a full trigger builder, then optionally arms it
 *  in the same action. Arming an already-created loop for tuning happens on
 *  /dashboard/loops. */
export function ComposeClient() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<LoopKind>('monitor');
  const [objective, setObjective] = useState('');
  const [cadence, setCadence] = useState<number | ''>(30);
  const [brain, setBrain] = useState<(typeof BRAIN_OPTIONS)[number]>('claude');
  const [symbolAllowlist, setSymbolAllowlist] = useState('');
  const [maxTradeUsd, setMaxTradeUsd] = useState<number | ''>('');
  const [triggers, setTriggers] = useState<TriggerDraft[]>([]);
  const [armImmediately, setArmImmediately] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  function addTrigger() {
    setTriggers((t) => [...t, { type: 'news', symbol: '', minSeverity: 'high' }]);
  }
  function updateTrigger(i: number, patch: Partial<TriggerDraft>) {
    setTriggers((t) => t.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }
  function removeTrigger(i: number) {
    setTriggers((t) => t.filter((_, idx) => idx !== i));
  }

  async function submit() {
    if (!name.trim() || !objective.trim()) {
      setResult('name and objective are required');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const config: Record<string, unknown> = {};
      if (symbolAllowlist.trim()) config.symbolAllowlist = symbolAllowlist.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (maxTradeUsd !== '') config.maxTradeUsd = maxTradeUsd;

      const res = await fetch('/api/loops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          kind,
          objective,
          cadence_seconds: cadence === '' ? null : cadence,
          brain,
          config,
          triggers: triggers.filter((t) => t.type).map((t) => ({ type: t.type, symbol: t.symbol || undefined, minSeverity: t.minSeverity })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `create failed (${res.status})`);

      if (armImmediately) {
        const armRes = await fetch(`/api/loops/${json.loop.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'armed' }),
        });
        if (!armRes.ok) throw new Error('created but failed to arm — arm it from /dashboard/loops');
      }

      await queryClient.invalidateQueries({ queryKey: LOOPS_KEY });
      setResult(`created "${name}"${armImmediately ? ' and armed' : ' (paused — arm it from Results/Loops when ready)'}`);
      setName('');
      setObjective('');
      setTriggers([]);
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'create failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="NVDA momentum watch" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Kind</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as LoopKind)} className={inputCls}>
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Brain</label>
          <select value={brain} onChange={(e) => setBrain(e.target.value as (typeof BRAIN_OPTIONS)[number])} className={inputCls}>
            {BRAIN_OPTIONS.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Objective (the standing prompt)</label>
        <textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          rows={3}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="Watch NVDA for momentum breakouts and react to high-severity news."
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Cadence (seconds, blank = event-only)</label>
          <input
            type="number"
            min={5}
            value={cadence}
            onChange={(e) => setCadence(e.target.value === '' ? '' : Number(e.target.value))}
            className={inputCls}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Max trade $ (trade loops)</label>
          <input
            type="number"
            min={1}
            value={maxTradeUsd}
            onChange={(e) => setMaxTradeUsd(e.target.value === '' ? '' : Number(e.target.value))}
            className={inputCls}
            placeholder="stricter of this vs MAX_TRADE_USD wins"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground">Symbol allowlist override (comma-separated, optional — narrows the global one)</label>
        <input value={symbolAllowlist} onChange={(e) => setSymbolAllowlist(e.target.value)} className={inputCls} placeholder="NVDA, AAPL" />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground">Triggers (event-driven switching)</label>
          <Button variant="outline" size="sm" onClick={addTrigger}>
            <Plus /> Add
          </Button>
        </div>
        {triggers.map((t, i) => (
          <div key={i} className="flex items-center gap-2 rounded-md border border-border p-2">
            <select value={t.type} onChange={(e) => updateTrigger(i, { type: e.target.value as EventType })} className="h-9 rounded border border-border bg-background px-2 text-xs">
              {TRIGGER_TYPES.map((tt) => (
                <option key={tt} value={tt}>{tt}</option>
              ))}
            </select>
            <input
              value={t.symbol}
              onChange={(e) => updateTrigger(i, { symbol: e.target.value.toUpperCase() })}
              placeholder="symbol (optional)"
              className="h-9 flex-1 rounded border border-border bg-background px-2 text-xs"
            />
            <select value={t.minSeverity} onChange={(e) => updateTrigger(i, { minSeverity: e.target.value as EventSeverity })} className="h-9 rounded border border-border bg-background px-2 text-xs">
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>min {s}</option>
              ))}
            </select>
            <Button variant="ghost" size="icon-sm" onClick={() => removeTrigger(i)}>
              <Trash2 className="text-destructive/70" />
            </Button>
          </div>
        ))}
      </div>

      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={armImmediately} onChange={(e) => setArmImmediately(e.target.checked)} className="size-5" />
        Arm immediately after creating
      </label>

      {result && <p className="rounded border border-border bg-surface-2 px-3 py-2 text-xs">{result}</p>}

      <Button disabled={busy} onClick={submit} className="min-h-11">
        {busy ? 'Creating…' : armImmediately ? 'Create and arm' : 'Create loop (paused)'}
      </Button>
    </div>
  );
}
