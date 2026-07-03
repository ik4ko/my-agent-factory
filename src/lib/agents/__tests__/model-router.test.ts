import {
  routeModel,
  classifyComplexity,
  estimateTokens,
  MODELS,
  FABLE_SHARE_CAP,
  MIN_FABLE_PAYLOAD_TOKENS,
} from '@/lib/agents/model-router';
import type { SpendSnapshot } from '@/lib/telemetry/token-ledger';

const snap = (byModel: Record<string, number>): SpendSnapshot => ({
  byModel,
  totalTokens: Object.values(byModel).reduce((a, b) => a + b, 0),
  windowHours: 24,
});

// > 2k estimated tokens (~4 chars/token) of high-stakes payload.
const BIG_HIGH_STAKES = 'critical architecture migration plan. ' + 'x'.repeat(MIN_FABLE_PAYLOAD_TOKENS * 4);

describe('classifyComplexity', () => {
  it('flags architecture / migrations / critical debugging', () => {
    expect(classifyComplexity('design the service architecture')).toBe('high-stakes');
    expect(classifyComplexity('run the schema migration')).toBe('high-stakes');
    expect(classifyComplexity('critical debugging of the outage')).toBe('high-stakes');
  });
  it('treats everything else as routine', () => {
    expect(classifyComplexity('summarize this article')).toBe('routine');
  });
});

describe('routeModel', () => {
  it('SEAT: routine → default worker model', () => {
    const d = routeModel('summarize this article', snap({}));
    expect(d).toMatchObject({ model: MODELS.HAIKU, transition: 'SEAT' });
  });

  it('UP: high-stakes, big payload, share under cap → Fable 5', () => {
    const d = routeModel(BIG_HIGH_STAKES, snap({ [MODELS.FABLE]: 10, [MODELS.HAIKU]: 90 }));
    expect(d).toMatchObject({ model: MODELS.FABLE, transition: 'UP' });
    expect(d.fableShare).toBeCloseTo(0.1);
  });

  it('DOWN: payload under 2k tokens → Opus 4.8', () => {
    const d = routeModel('critical migration now', snap({}));
    expect(d).toMatchObject({ model: MODELS.OPUS, transition: 'DOWN' });
    expect(estimateTokens('critical migration now')).toBeLessThan(MIN_FABLE_PAYLOAD_TOKENS);
  });

  it('DOWN: fable share over 20% cap → Opus 4.8', () => {
    const d = routeModel(BIG_HIGH_STAKES, snap({ [MODELS.FABLE]: 30, [MODELS.HAIKU]: 70 }));
    expect(d).toMatchObject({ model: MODELS.OPUS, transition: 'DOWN' });
    expect(d.fableShare).toBeGreaterThan(FABLE_SHARE_CAP);
  });

  it('UP allowed at exactly the cap boundary (cap is strict >)', () => {
    const d = routeModel(BIG_HIGH_STAKES, snap({ [MODELS.FABLE]: 20, [MODELS.HAIKU]: 80 }));
    expect(d.transition).toBe('UP');
  });

  it('zero-spend ledger yields 0 share (no divide-by-zero)', () => {
    const d = routeModel(BIG_HIGH_STAKES, snap({}));
    expect(d.fableShare).toBe(0);
    expect(d.transition).toBe('UP');
  });
});
