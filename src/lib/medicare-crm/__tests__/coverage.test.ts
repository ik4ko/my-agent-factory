import {
  computeCoverageDiffs,
  coverageTaskCondition,
  diffIdempotencyKey,
  isConclusive,
  normalizeContractPbp,
  snapshotIdempotencyKey,
  verificationPeriod,
  type CoverageObservation,
  type PolicyBaseline,
} from '@/lib/medicare-crm/coverage';

/**
 * Synthetic fixtures only. These resemble real CMS MARx rows in shape —
 * contract-PBP formatting, plan naming, date style — and contain no real
 * person, MBI, or plan enrollment.
 */
const POLICY: PolicyBaseline = {
  id: '00000000-0000-4000-8000-000000000001',
  contract_pbp: 'H1234-001',
  plan_name: 'Sample Advantage Choice (PPO)',
  effective_date: '2026-01-01',
  status: 'active',
};

const CLIENT_ID = '00000000-0000-4000-8000-0000000000aa';

function observation(over: Partial<CoverageObservation> = {}): CoverageObservation {
  return {
    source: 'marx',
    observedAt: '2026-07-15T14:00:00.000Z',
    verificationStatus: 'active_same',
    contractPbp: 'H1234-001',
    planName: 'Sample Advantage Choice (PPO)',
    effectiveDate: '2026-01-01',
    ...over,
  };
}

describe('normalizeContractPbp', () => {
  it('treats every carrier formatting of the same plan as equal', () => {
    const forms = ['H1234-001', 'h1234 001', 'H1234_001', 'H1234001'];
    const normalized = forms.map(normalizeContractPbp);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('H1234001');
  });

  it('returns null for absent or empty values rather than an empty string', () => {
    expect(normalizeContractPbp(null)).toBeNull();
    expect(normalizeContractPbp('')).toBeNull();
    expect(normalizeContractPbp('   ')).toBeNull();
  });
});

describe('verificationPeriod', () => {
  it('buckets an observation into its UTC year-month', () => {
    expect(verificationPeriod('2026-07-15T14:00:00.000Z')).toBe('2026-07');
    expect(verificationPeriod('2026-01-01T00:00:00.000Z')).toBe('2026-01');
  });

  it('throws on an unparseable date instead of silently bucketing to NaN', () => {
    expect(() => verificationPeriod('not-a-date')).toThrow(/unparseable/);
  });
});

describe('snapshotIdempotencyKey', () => {
  it('collapses a re-run of the same conclusive check in the same period', () => {
    const first = snapshotIdempotencyKey({
      source: 'marx',
      clientId: CLIENT_ID,
      observedAt: '2026-07-02T09:00:00.000Z',
      verificationStatus: 'active_same',
    });
    const rerun = snapshotIdempotencyKey({
      source: 'marx',
      clientId: CLIENT_ID,
      observedAt: '2026-07-28T17:30:00.000Z',
      verificationStatus: 'active_same',
    });
    expect(rerun).toBe(first);
  });

  it('separates periods so next month records a fresh reading', () => {
    const july = snapshotIdempotencyKey({
      source: 'marx',
      clientId: CLIENT_ID,
      observedAt: '2026-07-02T09:00:00.000Z',
      verificationStatus: 'active_same',
    });
    const august = snapshotIdempotencyKey({
      source: 'marx',
      clientId: CLIENT_ID,
      observedAt: '2026-08-02T09:00:00.000Z',
      verificationStatus: 'active_same',
    });
    expect(august).not.toBe(july);
  });

  it('does not let a failed attempt squat on the period slot', () => {
    // The regression this guards: an MFA prompt at 09:00 must not stop the
    // successful retry at 09:20 from being recorded.
    const blocked = snapshotIdempotencyKey({
      source: 'marx',
      clientId: CLIENT_ID,
      observedAt: '2026-07-02T09:00:00.000Z',
      verificationStatus: 'mfa_required',
    });
    const succeeded = snapshotIdempotencyKey({
      source: 'marx',
      clientId: CLIENT_ID,
      observedAt: '2026-07-02T09:20:00.000Z',
      verificationStatus: 'active_changed',
    });
    expect(blocked).not.toBe(succeeded);
  });

  it('still collapses repeated identical failures', () => {
    const a = snapshotIdempotencyKey({
      source: 'marx',
      clientId: CLIENT_ID,
      observedAt: '2026-07-02T09:00:00.000Z',
      verificationStatus: 'rate_limited',
    });
    const b = snapshotIdempotencyKey({
      source: 'marx',
      clientId: CLIENT_ID,
      observedAt: '2026-07-09T11:00:00.000Z',
      verificationStatus: 'rate_limited',
    });
    expect(b).toBe(a);
  });

  it('keeps sources independent', () => {
    const marx = snapshotIdempotencyKey({
      source: 'marx',
      clientId: CLIENT_ID,
      observedAt: '2026-07-02T09:00:00.000Z',
      verificationStatus: 'active_same',
    });
    const portal = snapshotIdempotencyKey({
      source: 'carrier_portal',
      clientId: CLIENT_ID,
      observedAt: '2026-07-02T09:00:00.000Z',
      verificationStatus: 'active_same',
    });
    expect(portal).not.toBe(marx);
  });
});

describe('diffIdempotencyKey', () => {
  it('is period-free so an unresolved proposal never queues twice', () => {
    const march = diffIdempotencyKey({
      source: 'marx',
      clientId: CLIENT_ID,
      targetTable: 'ag_policies',
      targetField: 'contract_pbp',
      incomingValue: 'H9999-002',
    });
    const april = diffIdempotencyKey({
      source: 'marx',
      clientId: CLIENT_ID,
      targetTable: 'ag_policies',
      targetField: 'contract_pbp',
      incomingValue: 'H9999-002',
    });
    expect(april).toBe(march);
  });

  it('distinguishes a different proposed value', () => {
    const a = diffIdempotencyKey({
      source: 'marx',
      clientId: CLIENT_ID,
      targetTable: 'ag_policies',
      targetField: 'contract_pbp',
      incomingValue: 'H9999-002',
    });
    const b = diffIdempotencyKey({
      source: 'marx',
      clientId: CLIENT_ID,
      targetTable: 'ag_policies',
      targetField: 'contract_pbp',
      incomingValue: 'H5555-003',
    });
    expect(b).not.toBe(a);
  });
});

describe('computeCoverageDiffs', () => {
  it('proposes nothing when the plan is unchanged', () => {
    const diffs = computeCoverageDiffs({
      clientId: CLIENT_ID,
      policy: POLICY,
      observation: observation(),
    });
    expect(diffs).toEqual([]);
  });

  it('ignores formatting-only differences in the contract code', () => {
    // 'h1234 001' is the same plan as 'H1234-001'. Reporting this as a change
    // is the bug that makes operators stop trusting the queue.
    const diffs = computeCoverageDiffs({
      clientId: CLIENT_ID,
      policy: POLICY,
      observation: observation({ contractPbp: 'h1234 001' }),
    });
    expect(diffs).toEqual([]);
  });

  it('proposes a high-confidence change when the contract code really differs', () => {
    const diffs = computeCoverageDiffs({
      clientId: CLIENT_ID,
      policy: POLICY,
      observation: observation({
        verificationStatus: 'active_changed',
        contractPbp: 'H9999-002',
        planName: 'Other Advantage Plus (HMO)',
      }),
    });

    const planChange = diffs.find((d) => d.targetField === 'contract_pbp');
    expect(planChange).toBeDefined();
    expect(planChange).toMatchObject({
      targetTable: 'ag_policies',
      currentValue: 'H1234-001',
      incomingValue: 'H9999-002',
      confidence: 'high',
    });
  });

  it('rates a marketing-name change as low confidence', () => {
    const diffs = computeCoverageDiffs({
      clientId: CLIENT_ID,
      policy: POLICY,
      observation: observation({
        verificationStatus: 'active_changed',
        planName: 'Sample Advantage Choice PPO 2027',
      }),
    });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ targetField: 'plan_name', confidence: 'low' });
  });

  it('does not treat a whitespace/case reformat of the plan name as a change', () => {
    const diffs = computeCoverageDiffs({
      clientId: CLIENT_ID,
      policy: POLICY,
      observation: observation({ planName: '  SAMPLE   Advantage Choice (PPO) ' }),
    });
    expect(diffs).toEqual([]);
  });

  it('proposes nothing for an inconclusive observation', () => {
    for (const status of ['mfa_required', 'rate_limited', 'source_unavailable', 'failed'] as const) {
      const diffs = computeCoverageDiffs({
        clientId: CLIENT_ID,
        policy: POLICY,
        observation: observation({ verificationStatus: status, contractPbp: 'H9999-002' }),
      });
      expect(diffs).toEqual([]);
    }
  });

  it('never blanks a live policy from a not_found result', () => {
    // A mistyped MBI produces not_found. If that overwrote the record, one
    // typo would erase a real client's coverage.
    const diffs = computeCoverageDiffs({
      clientId: CLIENT_ID,
      policy: POLICY,
      observation: observation({
        verificationStatus: 'not_found',
        contractPbp: null,
        planName: null,
        effectiveDate: null,
      }),
    });
    expect(diffs).toEqual([]);
  });

  it('never proposes a change from a field the source simply did not report', () => {
    const diffs = computeCoverageDiffs({
      clientId: CLIENT_ID,
      policy: POLICY,
      observation: observation({
        verificationStatus: 'active_changed',
        contractPbp: 'H9999-002',
        planName: null,
        effectiveDate: undefined,
      }),
    });
    expect(diffs.map((d) => d.targetField)).toEqual(['contract_pbp']);
  });

  it('only ever targets ag_policies or ag_clients', () => {
    const diffs = computeCoverageDiffs({
      clientId: CLIENT_ID,
      policy: POLICY,
      observation: observation({
        verificationStatus: 'active_changed',
        contractPbp: 'H9999-002',
        planName: 'Other Plan',
        effectiveDate: '2027-01-01',
      }),
    });
    expect(diffs.length).toBeGreaterThan(0);
    for (const diff of diffs) {
      expect(['ag_policies', 'ag_clients']).toContain(diff.targetTable);
    }
  });
});

describe('coverageTaskCondition', () => {
  const context = { clientName: 'Sample Member' };

  it('creates no task when the plan is unchanged', () => {
    expect(coverageTaskCondition(observation(), context)).toBeNull();
  });

  it('raises a task when coverage changed', () => {
    const task = coverageTaskCondition(observation({ verificationStatus: 'active_changed' }), context);
    expect(task).toMatchObject({ kind: 'coverage_changed', priority: 'high' });
  });

  it('raises a task when the member is not found', () => {
    const task = coverageTaskCondition(observation({ verificationStatus: 'not_found' }), context);
    expect(task).toMatchObject({ kind: 'member_not_found' });
  });

  it('raises a task on an ambiguous identity match', () => {
    const task = coverageTaskCondition(observation({ verificationStatus: 'ambiguous_match' }), context);
    expect(task).toMatchObject({ kind: 'ambiguous_match', priority: 'high' });
  });

  it('routes MFA and CAPTCHA to a human rather than suggesting a bypass', () => {
    for (const status of ['mfa_required', 'captcha_encountered', 'login_required'] as const) {
      const task = coverageTaskCondition(observation({ verificationStatus: status }), context);
      expect(task).toMatchObject({ kind: 'verification_blocked' });
      expect(task?.detail).toMatch(/never bypassed/i);
    }
  });

  it('ignores a single transient failure but escalates a persistent one', () => {
    const once = coverageTaskCondition(observation({ verificationStatus: 'rate_limited' }), {
      ...context,
      consecutiveFailures: 1,
    });
    expect(once).toBeNull();

    const repeated = coverageTaskCondition(observation({ verificationStatus: 'rate_limited' }), {
      ...context,
      consecutiveFailures: 3,
    });
    expect(repeated).toMatchObject({ kind: 'verification_failing' });
  });
});

describe('isConclusive', () => {
  it('separates readings from failed attempts', () => {
    expect(isConclusive('active_same')).toBe(true);
    expect(isConclusive('active_changed')).toBe(true);
    expect(isConclusive('not_found')).toBe(true);
    expect(isConclusive('mfa_required')).toBe(false);
    expect(isConclusive('failed')).toBe(false);
  });
});
