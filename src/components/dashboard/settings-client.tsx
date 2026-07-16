'use client';

import { useState, useTransition } from 'react';
import { Check, Loader2, PlugZap, XCircle } from 'lucide-react';
import { dispatchAgent } from '@/app/actions/agent-dispatcher';
import { ACTIVE_BRAIN_IDS, BRAIN_IDS, BRAIN_MATRIX, type ActiveBrainId, type BrainId } from '@/lib/agents/brain-matrix';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type TestState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'ok'; latencyMs: number; snippet: string }
  | { status: 'error'; reason: string };

export interface EnvFlag {
  label: string;
  configured: boolean;
  hint: string;
}

const TIER_LABEL: Record<1 | 2 | 3, string> = {
  1: 'Core orchestrators',
  2: 'Specialized workers',
  3: 'Utilities',
};

/**
 * Settings — brain routing matrix with per-agent live connectivity tests
 * (each test is ONE metered dispatchAgent call, only on click) plus
 * environment flags computed server-side as booleans (key values never
 * reach the client).
 */
export function SettingsClient({ envFlags }: { envFlags: EnvFlag[] }) {
  const [tests, setTests] = useState<Partial<Record<BrainId, TestState>>>({});
  const [, startTransition] = useTransition();
  const active = new Set<BrainId>(ACTIVE_BRAIN_IDS);

  const runTest = (agentId: BrainId) => {
    if (!active.has(agentId)) return;
    setTests((t) => ({ ...t, [agentId]: { status: 'pending' } }));
    startTransition(async () => {
      const t0 = performance.now();
      try {
        const result = await dispatchAgent({
          agentId: agentId as ActiveBrainId,
          prompt: `Connectivity check. Reply with exactly: ${agentId} online.`,
        });
        const latencyMs = Math.round(performance.now() - t0);
        setTests((t) => ({
          ...t,
          [agentId]: result.error
            ? { status: 'error', reason: result.error }
            : { status: 'ok', latencyMs, snippet: result.content.slice(0, 60) },
        }));
      } catch (err) {
        setTests((t) => ({
          ...t,
          [agentId]: { status: 'error', reason: err instanceof Error ? err.message : 'dispatch failed' },
        }));
      }
    });
  };

  const tiers = [1, 2, 3] as const;

  return (
    <div className="flex flex-col gap-4">
      {/* Environment / connections — booleans only */}
      <section>
        <h2 className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">Connections</h2>
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {envFlags.map((flag) => (
            <div
              key={flag.label}
              title={flag.hint}
              className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 font-terminal text-[10px]"
            >
              <span
                className={cn('size-1.5 shrink-0 rounded-full', flag.configured ? 'bg-neon-green' : 'bg-neon-orange')}
                aria-hidden
              />
              <span className="truncate text-foreground/80">{flag.label}</span>
              <span className={cn('ml-auto shrink-0', flag.configured ? 'text-neon-green' : 'text-neon-orange')}>
                {flag.configured ? 'configured' : 'not set'}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-1.5 font-terminal text-[9px] text-muted-foreground/40">
          Values live in .env.local — this panel only shows presence, never contents.
        </p>
      </section>

      {/* Brain routing matrix */}
      <section>
        <h2 className="mb-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
          Brain routing matrix — Claude + Codex active; future lanes locked
        </h2>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse font-terminal text-[10px]">
            <thead>
              <tr className="border-b border-border bg-surface-1/60 text-left text-[9px] uppercase tracking-wider text-muted-foreground/50">
                <th className="px-2.5 py-1.5 font-medium">agent</th>
                <th className="px-2.5 py-1.5 font-medium">role</th>
                <th className="hidden px-2.5 py-1.5 font-medium md:table-cell">model</th>
                <th className="px-2.5 py-1.5 font-medium">temp</th>
                <th className="px-2.5 py-1.5 font-medium">link test</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => (
                <SettingsTierRows key={tier} tier={tier} tests={tests} onTest={runTest} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 font-terminal text-[9px] text-muted-foreground/40">
          Active tests send one minimal metered request through the dispatchAgent server action. Future
          lanes are display-only until explicitly enabled.
        </p>
      </section>
    </div>
  );
}

function SettingsTierRows({
  tier,
  tests,
  onTest,
}: {
  tier: 1 | 2 | 3;
  tests: Partial<Record<BrainId, TestState>>;
  onTest: (id: BrainId) => void;
}) {
  const rows = BRAIN_IDS.filter((id) => BRAIN_MATRIX[id].tier === tier);
  const active = new Set<BrainId>(ACTIVE_BRAIN_IDS);
  return (
    <>
      <tr className="border-b border-border/40 bg-surface-1/30">
        <td colSpan={5} className="px-2.5 py-1 text-[9px] uppercase tracking-widest text-muted-foreground/40">
          Tier {tier} — {TIER_LABEL[tier]}
        </td>
      </tr>
      {rows.map((id) => {
        const def = BRAIN_MATRIX[id];
        const test = tests[id] ?? { status: 'idle' as const };
        const isActive = active.has(id);
        return (
          <tr key={id} className="border-b border-border/40 last:border-b-0 hover:bg-surface-1/40">
            <td className="px-2.5 py-1.5 font-semibold text-foreground/90">{id}</td>
            <td className="px-2.5 py-1.5 text-muted-foreground/60">{def.role}</td>
            <td className="hidden px-2.5 py-1.5 text-muted-foreground/50 md:table-cell">{def.model}</td>
            <td className="px-2.5 py-1.5 tabular text-muted-foreground/60">{def.temperature.toFixed(1)}</td>
            <td className="px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onTest(id)}
                  disabled={!isActive || test.status === 'pending'}
                  aria-label={`Test ${id} connectivity`}
                  className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground transition-colors hover:border-neon-cyan/40 hover:text-neon-cyan disabled:opacity-50"
                >
                  {test.status === 'pending' ? (
                    <Loader2 className="size-2.5 animate-spin" aria-hidden />
                  ) : (
                    <PlugZap className="size-2.5" aria-hidden />
                  )}
                  {isActive ? 'test' : 'locked'}
                </button>
                {test.status === 'ok' && (
                  <span className="flex min-w-0 items-center gap-1 text-neon-green" title={test.snippet}>
                    <Check className="size-2.5 shrink-0" aria-hidden />
                    <span className="tabular">{test.latencyMs}ms</span>
                  </span>
                )}
                {test.status === 'error' && (
                  <span className="flex min-w-0 items-center gap-1 text-neon-red" title={test.reason}>
                    <XCircle className="size-2.5 shrink-0" aria-hidden />
                    <span className="max-w-[180px] truncate">{test.reason}</span>
                  </span>
                )}
                {!isActive ? <Badge variant="muted">future</Badge> : test.status === 'idle' && <Badge variant="muted">untested</Badge>}
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}
