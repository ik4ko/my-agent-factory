import { getAdminClient } from '@/lib/supabase/admin';
import { recordFeedbackEvent, recordFeedbackEvents } from '@/lib/telemetry/feedback-ledger';
import {
  commitCandidate,
  createPendingProposal,
  emptyLifeContextDocument,
  gateLifeContextCandidate,
  normalizeCandidateAgainstFacts,
  pruneExpiredProposals,
  type LifeContextCandidate,
  type LifeContextDocument,
  type LifeContextFact,
  type LifeContextProvenance,
  type PendingLifeContextProposal,
} from './types';

const LIFE_CONTEXT_KEY = 'life_context:v1';

function parseDocument(value: unknown): LifeContextDocument {
  if (!value || typeof value !== 'object') return emptyLifeContextDocument();
  const candidate = value as Partial<LifeContextDocument>;
  return {
    kind: 'life_context',
    version: 1,
    facts: Array.isArray(candidate.facts) ? candidate.facts as LifeContextFact[] : [],
    pending: Array.isArray(candidate.pending) ? candidate.pending as PendingLifeContextProposal[] : [],
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
  };
}

async function readRow(): Promise<{ id?: string; updatedAt?: string; document: LifeContextDocument }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  const { data, error } = await db.from('memory').select('id, value, updated_at').eq('key', LIFE_CONTEXT_KEY).limit(1).maybeSingle();
  if (error) throw new Error(`[life-context] read failed: ${error.message}`);
  return { id: data?.id, updatedAt: data?.updated_at, document: parseDocument(data?.value) };
}

async function mutateDocument(mutator: (document: LifeContextDocument) => LifeContextDocument): Promise<LifeContextDocument> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await readRow();
    const next = mutator(pruneExpiredProposals(row.document));
    if (!row.id) {
      const { error } = await db.from('memory').insert({ key: LIFE_CONTEXT_KEY, value: next, source: 'life_context', tags: ['life_context'] });
      if (!error) return next;
      if ((error.code === '23505' || /duplicate key/i.test(error.message ?? '')) && attempt < 3) continue;
      throw new Error(`[life-context] insert failed: ${error.message}`);
    }
    const { data, error } = await db
      .from('memory')
      .update({ value: next, source: 'life_context', tags: ['life_context'], updated_at: next.updatedAt })
      .eq('id', row.id)
      .eq('updated_at', row.updatedAt)
      .select('id')
      .maybeSingle();
    if (error) throw new Error(`[life-context] update failed: ${error.message}`);
    if (data?.id) return next;
  }
  throw new Error('[life-context] concurrent write retry exhausted');
}

export async function readLifeContext(): Promise<LifeContextDocument> {
  const row = await readRow();
  const pruned = pruneExpiredProposals(row.document);
  if (pruned !== row.document) {
    // This is the main expiry sweep point: record which proposals aged out.
    // (mutateDocument also prunes defensively; expiry events are recorded
    // only here to avoid double counting — a slight under-count is fine.)
    const keptIds = new Set(pruned.pending.map((p) => p.id));
    recordFeedbackEvents(
      row.document.pending
        .filter((p) => !keptIds.has(p.id))
        .map((p) => ({
          kind: 'fact_expired' as const,
          mentorId: p.provenance.mentorId,
          proposalCategory: p.candidate.category,
          gateReason: p.reason,
        })),
    );
    return mutateDocument((current) => pruneExpiredProposals(current));
  }
  return pruned;
}

export interface ProposeResult {
  facts: LifeContextFact[];
  pending: PendingLifeContextProposal[];
}

export async function proposeLifeContextCandidates(input: {
  candidates: LifeContextCandidate[];
  userMessage: string;
  mentorId: string;
  sourceMessageId: string;
}): Promise<ProposeResult> {
  // Reassigned (not appended) per mutator attempt: the optimistic-concurrency
  // loop can run the mutator more than once, and only the last attempt's
  // outcome is what actually persisted.
  let addedPending: PendingLifeContextProposal[] = [];
  let autoSaved: LifeContextCandidate[] = [];
  let committed: LifeContextFact[] = [];
  await mutateDocument((original) => {
    let document = original;
    const attemptPending: PendingLifeContextProposal[] = [];
    const attemptAutoSaved: LifeContextCandidate[] = [];
    for (const rawCandidate of input.candidates) {
      const candidate = normalizeCandidateAgainstFacts(rawCandidate, document.facts);
      const decision = gateLifeContextCandidate(candidate, input.userMessage);
      const baseProvenance = { mentorId: input.mentorId, sourceMessageId: input.sourceMessageId };
      if (decision.requiresConfirmation) {
        const pending = createPendingProposal(decision, baseProvenance);
        attemptPending.push(pending);
        document = { ...document, pending: [...document.pending, pending], updatedAt: new Date().toISOString() };
      } else {
        const provenance: LifeContextProvenance = {
          ...baseProvenance,
          sourceBasis: decision.candidate.sourceBasis,
          sourceQuote: decision.candidate.sourceQuote,
          createdAt: new Date().toISOString(),
        };
        attemptAutoSaved.push(decision.candidate);
        document = commitCandidate(document, decision.candidate, provenance);
      }
    }
    addedPending = attemptPending;
    autoSaved = attemptAutoSaved;
    committed = document.facts;
    return document;
  });
  recordFeedbackEvents([
    ...addedPending.map((p) => ({
      kind: 'fact_proposed' as const,
      mentorId: input.mentorId,
      proposalCategory: p.candidate.category,
      gateReason: p.reason,
    })),
    ...autoSaved.map((c) => ({
      kind: 'fact_auto_saved' as const,
      mentorId: input.mentorId,
      proposalCategory: c.category,
    })),
  ]);
  return { facts: committed, pending: addedPending };
}

export async function confirmPendingProposal(id: string): Promise<LifeContextDocument> {
  let confirmed: PendingLifeContextProposal | undefined;
  const document = await mutateDocument((current) => {
    const proposal = current.pending.find((item) => item.id === id);
    if (!proposal) throw new Error('pending proposal not found or expired');
    confirmed = proposal;
    const committed = commitCandidate(current, proposal.candidate, proposal.provenance);
    return { ...committed, pending: committed.pending.filter((item) => item.id !== id) };
  });
  if (confirmed) {
    void recordFeedbackEvent({
      kind: 'fact_confirmed',
      mentorId: confirmed.provenance.mentorId,
      proposalCategory: confirmed.candidate.category,
      gateReason: confirmed.reason,
      userAction: 'confirm',
    });
  }
  return document;
}

export async function discardPendingProposal(id: string): Promise<LifeContextDocument> {
  let discarded: PendingLifeContextProposal | undefined;
  const document = await mutateDocument((current) => {
    discarded = current.pending.find((item) => item.id === id);
    return { ...current, pending: current.pending.filter((item) => item.id !== id), updatedAt: new Date().toISOString() };
  });
  if (discarded) {
    void recordFeedbackEvent({
      kind: 'fact_discarded',
      mentorId: discarded.provenance.mentorId,
      proposalCategory: discarded.candidate.category,
      gateReason: discarded.reason,
      userAction: 'discard',
    });
  }
  return document;
}

export async function editPendingProposal(id: string, candidate: LifeContextCandidate): Promise<PendingLifeContextProposal> {
  let edited: PendingLifeContextProposal | undefined;
  await mutateDocument((document) => {
    const proposal = document.pending.find((item) => item.id === id);
    if (!proposal) throw new Error('pending proposal not found or expired');
    edited = { ...proposal, candidate, provenance: { ...proposal.provenance, sourceBasis: candidate.sourceBasis, sourceQuote: candidate.sourceQuote } };
    return { ...document, pending: document.pending.map((item) => item.id === id ? edited! : item), updatedAt: new Date().toISOString() };
  });
  if (edited) {
    void recordFeedbackEvent({
      kind: 'fact_edited',
      mentorId: edited.provenance.mentorId,
      proposalCategory: edited.candidate.category,
      gateReason: edited.reason,
      userAction: 'edit',
    });
  }
  return edited!;
}

/** Operator privacy toggle — direct write, see LifeContextFact.disabled. */
export async function setFactDisabled(id: string, disabled: boolean): Promise<LifeContextDocument> {
  return mutateDocument((document) => {
    const fact = document.facts.find((item) => item.id === id);
    if (!fact) throw new Error('fact not found');
    return {
      ...document,
      facts: document.facts.map((item) =>
        item.id === id ? { ...item, disabled, updatedAt: new Date().toISOString() } : item,
      ),
      updatedAt: new Date().toISOString(),
    };
  });
}

export async function enqueueConfirmedAction(input: {
  candidate: LifeContextCandidate;
  mentorId?: string;
  sourceMessageId?: string;
}): Promise<PendingLifeContextProposal> {
  const reason = input.candidate.operation === 'delete' ? 'deletion' : 'correction';
  const decision = {
    candidate: input.candidate,
    requiresConfirmation: true,
    reason,
    verifiedExplicit: false,
  } as const;
  const pending = createPendingProposal(decision, {
    mentorId: input.mentorId ?? 'OPERATOR',
    sourceMessageId: input.sourceMessageId ?? crypto.randomUUID(),
  });
  await mutateDocument((document) => ({
    ...document,
    pending: [...document.pending, pending],
    updatedAt: new Date().toISOString(),
  }));
  return pending;
}
