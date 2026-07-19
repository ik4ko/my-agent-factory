import {
  LifeContextCandidateSchema,
  MAX_RELEVANT_FACTS,
  PENDING_PROPOSAL_TTL_MS,
  commitCandidate,
  createPendingProposal,
  emptyLifeContextDocument,
  formatRelevantFacts,
  gateLifeContextCandidate,
  normalizeCandidateAgainstFacts,
  pruneExpiredProposals,
  selectRelevantFacts,
  type LifeContextCandidate,
  type LifeContextFact,
  type LifeContextProvenance,
} from '../types';

const ordinary: LifeContextCandidate = {
  operation: 'create',
  category: 'preference',
  subject: 'Planning style',
  value: 'Prefers concise weekly plans',
  semanticKey: 'preference:planning_style',
  sensitivity: 'ordinary',
  sourceBasis: 'explicit',
  sourceQuote: 'I prefer concise weekly plans',
};

const provenance: LifeContextProvenance = {
  mentorId: 'MENTOR_LIFE',
  sourceMessageId: 'message-1',
  sourceQuote: ordinary.sourceQuote,
  sourceBasis: 'explicit',
  createdAt: '2026-07-18T12:00:00.000Z',
};

describe('life-context safety gate', () => {
  it('rejects malformed candidates at the schema boundary', () => {
    expect(LifeContextCandidateSchema.safeParse({ ...ordinary, semanticKey: 'Not a stable key!' }).success).toBe(false);
  });

  it('auto-commits only an ordinary fact with a verified verbatim source quote', () => {
    expect(gateLifeContextCandidate(ordinary, 'Yes, I prefer concise weekly plans going forward.')).toMatchObject({
      requiresConfirmation: false,
      verifiedExplicit: true,
    });
  });

  it('downgrades a model-claimed explicit fact when sourceQuote is hallucinated or paraphrased', () => {
    const hallucinated = {
      ...ordinary,
      category: 'appointment' as const,
      subject: 'Dentist',
      value: 'Dentist next Tuesday at 3 PM',
      semanticKey: 'appointment:dentist:next_tuesday',
      sourceQuote: 'My dentist appointment is next Tuesday at 3 PM',
    };
    const decision = gateLifeContextCandidate(hallucinated, 'I might call the dentist sometime next week.');
    expect(decision.verifiedExplicit).toBe(false);
    expect(decision.candidate.sourceBasis).toBe('inferred');
    expect(decision.requiresConfirmation).toBe(true);
    expect(decision.reason).toBe('inferred_or_unverified');
  });

  it.each(['medical', 'financial', 'consequential'] as const)('always gates %s facts even with a matching quote', (sensitivity) => {
    expect(gateLifeContextCandidate({ ...ordinary, sensitivity }, `I said: ${ordinary.sourceQuote}.`)).toMatchObject({
      requiresConfirmation: true,
      reason: 'sensitive',
      verifiedExplicit: true,
    });
  });

  it('always gates updates and deletions', () => {
    expect(gateLifeContextCandidate({ ...ordinary, operation: 'update' }, ordinary.sourceQuote).reason).toBe('correction');
    expect(gateLifeContextCandidate({ ...ordinary, operation: 'delete' }, ordinary.sourceQuote).reason).toBe('deletion');
  });

  it('turns a create with an existing semantic key into a gated correction', () => {
    const created = commitCandidate(emptyLifeContextDocument(), ordinary, provenance);
    const normalized = normalizeCandidateAgainstFacts({ ...ordinary, value: 'A contradictory preference' }, created.facts);
    expect(normalized).toMatchObject({ operation: 'update', targetId: created.facts[0].id });
    expect(gateLifeContextCandidate(normalized, ordinary.sourceQuote).reason).toBe('correction');
  });
});

describe('life-context lifecycle', () => {
  it('expires pending proposals after exactly 24 hours and fully discards them', () => {
    const now = new Date('2026-07-18T12:00:00.000Z');
    const decision = gateLifeContextCandidate({ ...ordinary, sensitivity: 'medical' }, ordinary.sourceQuote);
    const pending = createPendingProposal(decision, { mentorId: 'MENTOR_HEALTH', sourceMessageId: 'message-2' }, now);
    expect(Date.parse(pending.expiresAt) - now.getTime()).toBe(PENDING_PROPOSAL_TTL_MS);
    const document = { ...emptyLifeContextDocument(now), pending: [pending] };
    expect(pruneExpiredProposals(document, new Date(now.getTime() + PENDING_PROPOSAL_TTL_MS - 1)).pending).toHaveLength(1);
    expect(pruneExpiredProposals(document, new Date(now.getTime() + PENDING_PROPOSAL_TTL_MS)).pending).toEqual([]);
  });

  it('replaces corrections instead of retaining contradictory active facts', () => {
    const created = commitCandidate(emptyLifeContextDocument(), ordinary, provenance);
    const oldFact = created.facts[0];
    const updated = commitCandidate(created, { ...ordinary, operation: 'update', value: 'Prefers detailed monthly plans' }, provenance);
    expect(updated.facts).toHaveLength(1);
    expect(updated.facts[0]).toMatchObject({ value: 'Prefers detailed monthly plans', version: 2, supersedesId: oldFact.id });
  });

  it('deletes the targeted fact rather than leaving it active', () => {
    const created = commitCandidate(emptyLifeContextDocument(), ordinary, provenance);
    const deleted = commitCandidate(created, { ...ordinary, operation: 'delete', targetId: created.facts[0].id }, provenance);
    expect(deleted.facts).toEqual([]);
  });

  it('injects no more than eight relevant active facts and never accepts pending proposals', () => {
    const facts: LifeContextFact[] = Array.from({ length: 12 }, (_, index) => ({
      ...commitCandidate(emptyLifeContextDocument(), { ...ordinary, semanticKey: `routine:training:${index}`, subject: `Training routine ${index}` }, provenance).facts[0],
      updatedAt: new Date(Date.UTC(2026, 6, 18, 12, index)).toISOString(),
    }));
    const selected = selectRelevantFacts(facts, 'Help me plan my training routine');
    expect(selected).toHaveLength(MAX_RELEVANT_FACTS);
    expect(formatRelevantFacts(selected)).toContain('confirmed facts only');
  });
});
