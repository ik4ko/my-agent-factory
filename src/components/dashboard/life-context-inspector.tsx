'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Eye, EyeOff, Loader2, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import {
  deleteLifeContextFact,
  listLifeContext,
  setLifeContextFactDisabled,
  updateLifeContextFact,
} from '@/app/actions/life-context';
import { LIFE_CONTEXT_UPDATED_EVENT } from '@/lib/life-context/events';
import type { LifeContextDocument, LifeContextFact } from '@/lib/life-context/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * "What my mentors know" — the operator-facing audit surface for the
 * life-context layer. Lists every CONFIRMED fact with its full provenance
 * (which mentor proposed it, the exact supporting quote, explicit vs
 * inferred), version lineage, and timestamps. Edit and Delete deliberately
 * route through the SAME pending-proposal gate mentors use (they queue a
 * correction/deletion proposal for explicit confirmation); only the privacy
 * toggle writes directly, because hiding a fact from mentors must be
 * immediate and only reduces exposure.
 */

function factToCandidate(fact: LifeContextFact, value: string) {
  return {
    category: fact.category,
    subject: fact.subject,
    value,
    semanticKey: fact.semanticKey,
    sensitivity: fact.sensitivity,
    sourceBasis: fact.provenance.sourceBasis,
    sourceQuote: fact.provenance.sourceQuote,
    ...(fact.startsAt ? { startsAt: fact.startsAt } : {}),
  };
}

function FactRow({ fact, onAction }: { fact: LifeContextFact; onAction: (run: () => Promise<unknown>, doneNote: string) => Promise<void> }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const edit = () => {
    const value = window.prompt('Edit this fact (queues a correction for your confirmation):', fact.value);
    if (value === null || value.trim() === '' || value === fact.value) return;
    void onAction(() => updateLifeContextFact(fact.id, factToCandidate(fact, value.trim())), 'correction queued — confirm it in the pending chips');
  };

  return (
    <div className={cn('rounded-md border border-border p-2 text-xs', fact.disabled && 'opacity-60')}>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
          {expanded ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
          <Badge variant="outline">{fact.category}</Badge>
          <span className="truncate font-medium text-foreground">{fact.subject}</span>
          {fact.disabled && <Badge variant="muted">hidden from mentors</Badge>}
        </button>
        <Button variant="ghost" size="icon-sm" title="Edit (queues a correction proposal)" onClick={edit}>
          <Pencil className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title={fact.disabled ? 'Show to mentors again' : 'Hide from mentors (immediate)'}
          onClick={() => void onAction(() => setLifeContextFactDisabled(fact.id, !fact.disabled), fact.disabled ? 'fact visible to mentors again' : 'fact hidden from mentors')}
        >
          {fact.disabled ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
        </Button>
        {confirmingDelete ? (
          <span className="flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5">
            <span className="text-[10px] text-destructive">queue deletion?</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px] text-destructive"
              onClick={() => {
                setConfirmingDelete(false);
                void onAction(() => deleteLifeContextFact(fact.id, factToCandidate(fact, fact.value)), 'deletion queued — confirm it in the pending chips');
              }}
            >
              yes
            </Button>
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={() => setConfirmingDelete(false)}>
              no
            </Button>
          </span>
        ) : (
          <Button variant="ghost" size="icon-sm" title="Delete (queues a deletion proposal)" onClick={() => setConfirmingDelete(true)}>
            <Trash2 className="size-3 text-destructive/70" />
          </Button>
        )}
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words pl-4.5 text-foreground/90">{fact.value}</p>
      {expanded && (
        <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2 font-terminal text-[10px] text-muted-foreground">
          {/* "Why is this here": mentor, basis, and the exact words it rests on. */}
          <p>
            proposed by <span className="text-foreground/80">{fact.provenance.mentorId}</span> ·{' '}
            {fact.provenance.sourceBasis === 'explicit' ? 'explicitly stated by you' : 'inferred (confirmed by you)'} · sensitivity {fact.sensitivity}
          </p>
          <p className="rounded bg-surface-2 p-1.5 italic">&ldquo;{fact.provenance.sourceQuote}&rdquo;</p>
          <p>
            created {new Date(fact.createdAt).toLocaleString()} · updated {new Date(fact.updatedAt).toLocaleString()} · v{fact.version}
            {fact.supersedesId ? ` · supersedes ${fact.supersedesId.slice(0, 8)}` : ''}
          </p>
        </div>
      )}
    </div>
  );
}

export function LifeContextInspector() {
  const [document, setDocument] = useState<LifeContextDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    listLifeContext()
      .then((doc) => {
        setDocument(doc);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'failed to load life context'));
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(LIFE_CONTEXT_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(LIFE_CONTEXT_UPDATED_EVENT, refresh);
  }, [refresh]);

  const onAction = useCallback(
    async (run: () => Promise<unknown>, doneNote: string) => {
      setBusy(true);
      setNote(null);
      setError(null);
      try {
        await run();
        setNote(doneNote);
        refresh();
        window.dispatchEvent(new Event(LIFE_CONTEXT_UPDATED_EVENT));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'action failed');
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const facts = document?.facts ?? [];
  const pendingCount = document?.pending.length ?? 0;

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto p-2.5">
      <div className="flex items-center gap-2">
        <p className="font-terminal text-[10px] text-muted-foreground">
          {document === null && !error ? 'loading…' : `${facts.length} confirmed fact${facts.length === 1 ? '' : 's'}`}
          {pendingCount > 0 ? ` · ${pendingCount} pending in chat` : ''}
        </p>
        {busy && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
        <Button variant="ghost" size="icon-sm" className="ml-auto" title="Refresh" onClick={refresh}>
          <RefreshCw className="size-3" />
        </Button>
      </div>
      {error && (
        <p className="flex items-center gap-1.5 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          <AlertTriangle className="size-3 shrink-0" /> {error}
        </p>
      )}
      {note && <p className="rounded border border-border bg-surface-2 px-2 py-1 text-[10px] text-muted-foreground">{note}</p>}
      {document !== null && facts.length === 0 && !error && (
        <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          Nothing stored yet. When a mentor proposes remembering something, you confirm it in chat — confirmed facts
          appear here with the exact words they rest on.
        </p>
      )}
      {facts.map((fact) => (
        <FactRow key={fact.id} fact={fact} onAction={onAction} />
      ))}
    </div>
  );
}
