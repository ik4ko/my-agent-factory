import { selectRelevantFacts, type LifeContextFact } from '../types';

function fact(overrides: Partial<LifeContextFact>): LifeContextFact {
  return {
    id: crypto.randomUUID(),
    category: 'preference',
    subject: 'coffee',
    value: 'prefers espresso over drip coffee',
    semanticKey: 'pref:coffee',
    sensitivity: 'ordinary',
    provenance: {
      mentorId: 'MENTOR_LIFE',
      sourceMessageId: crypto.randomUUID(),
      sourceQuote: 'I prefer espresso',
      sourceBasis: 'explicit',
      createdAt: new Date().toISOString(),
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
    ...overrides,
  };
}

describe('disabled facts are never surfaced to mentors', () => {
  it('selectRelevantFacts skips disabled facts even on a perfect match', () => {
    const enabled = fact({ semanticKey: 'pref:coffee:a' });
    const hidden = fact({ semanticKey: 'pref:coffee:b', disabled: true });
    const selected = selectRelevantFacts([enabled, hidden], 'what coffee do I prefer, espresso?');
    expect(selected.map((f) => f.id)).toContain(enabled.id);
    expect(selected.map((f) => f.id)).not.toContain(hidden.id);
  });

  it('re-enabling restores visibility', () => {
    const restored = fact({ disabled: false });
    const selected = selectRelevantFacts([restored], 'espresso coffee preference');
    expect(selected.map((f) => f.id)).toContain(restored.id);
  });
});
