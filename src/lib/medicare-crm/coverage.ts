/**
 * Coverage verification: comparison, not blind automation.
 *
 * Everything in this file is pure. An observation arrives from a source (the
 * browser extension's CMS MARx read, a carrier roster sync, an operator's
 * spreadsheet), and these functions decide two things:
 *
 *   1. Is this observation new, or have we already recorded it?
 *   2. Does it disagree with the book of business, and if so, exactly how?
 *
 * What these functions never do is write. Producing an `ProposedDiff` is a
 * proposal for a human, and `ag_coverage_diffs.status = 'accepted'` is the only
 * thing that ever changes ag_clients or ag_policies.
 *
 * The verification-status vocabulary deliberately mirrors what the existing
 * AegisSage Roster Sync extension already emits from classifyMarxResult(), so
 * the Phase 4 adapter is a transport concern rather than a re-modelling one.
 */

/** Statuses that represent a real reading of someone's coverage. */
export const CONCLUSIVE_STATUSES = [
  'active_same',
  'active_changed',
  'pending_switch',
  'no_ma_plan',
  'not_found',
] as const;

/**
 * Statuses that mean the attempt did not complete. These are recorded — a
 * verification that keeps hitting MFA is exactly the thing Eric needs to see —
 * but they are not readings, so they never produce a diff.
 */
export const INCONCLUSIVE_STATUSES = [
  'source_unavailable',
  'login_required',
  'mfa_required',
  'captcha_encountered',
  'rate_limited',
  'ambiguous_match',
  'needs_review',
  'completed_with_warnings',
  'failed',
] as const;

export type ConclusiveStatus = (typeof CONCLUSIVE_STATUSES)[number];
export type InconclusiveStatus = (typeof INCONCLUSIVE_STATUSES)[number];
export type VerificationStatus = ConclusiveStatus | InconclusiveStatus;

export function isConclusive(status: string): status is ConclusiveStatus {
  return (CONCLUSIVE_STATUSES as readonly string[]).includes(status);
}

/**
 * CMS identifies a Medicare Advantage plan as contract + PBP, but every source
 * writes it differently: "H1234-001", "h1234 001", "H1234001". Comparing raw
 * strings would report a plan change every time a carrier reformatted its
 * export, so both sides are normalised before comparison.
 *
 * Matches the extension's normalizeMarxCode() exactly — if these two ever
 * disagree, unchanged plans start alerting as changed.
 */
export function normalizeContractPbp(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.replace(/[-\s_]/g, '').toUpperCase();
  return compact.length > 0 ? compact : null;
}

/** YYYY-MM. The verification period a snapshot belongs to. */
export function verificationPeriod(observedAt: string | Date): string {
  const date = observedAt instanceof Date ? observedAt : new Date(observedAt);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`verificationPeriod: unparseable date ${String(observedAt)}`);
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Snapshot identity: one reading per source, per member, per period.
 *
 * Re-running a monthly batch is therefore free — the second run collides and
 * is discarded rather than doubling the history.
 *
 * Inconclusive attempts get the status folded into the key, and the reason is
 * worth stating: if a run hits `login_required` and a retry ten minutes later
 * succeeds, a period-only key would let the failure squat on the slot and the
 * successful reading would be thrown away. Failures must not block the result
 * that actually matters.
 */
export function snapshotIdempotencyKey(input: {
  source: string;
  clientId: string;
  observedAt: string | Date;
  verificationStatus: string;
}): string {
  const period = verificationPeriod(input.observedAt);
  const base = `${input.source}:${input.clientId}:${period}`;
  return isConclusive(input.verificationStatus)
    ? base
    : `${base}:${input.verificationStatus}`;
}

/**
 * Diff identity: source + client + field + proposed value.
 *
 * Deliberately period-free. If the same plan change is observed in March and
 * again in April while Eric has not yet reviewed it, that is one decision, not
 * two, and it must not appear twice in his queue. The cost is that a diff he
 * explicitly rejected will not re-raise if the same value is seen again later —
 * which is the correct reading of a rejection.
 */
export function diffIdempotencyKey(input: {
  source: string;
  clientId: string;
  targetTable: string;
  targetField: string;
  incomingValue: string | null;
}): string {
  return [
    input.source,
    input.clientId,
    `${input.targetTable}.${input.targetField}`,
    input.incomingValue ?? '<null>',
  ].join(':');
}

/** Task identity: one open task per condition, per anchor, per period. */
export function taskDedupeKey(input: {
  kind: string;
  anchorId: string;
  observedAt?: string | Date;
}): string {
  const period = input.observedAt ? verificationPeriod(input.observedAt) : 'standing';
  return `${input.kind}:${input.anchorId}:${period}`;
}

// ── Diff computation ────────────────────────────────────────────────────────

export type CoverageObservation = {
  source: 'marx' | 'carrier_portal' | 'import' | 'manual';
  observedAt: string;
  verificationStatus: VerificationStatus;
  contractPbp?: string | null;
  planName?: string | null;
  carrierName?: string | null;
  effectiveDate?: string | null;
  endDate?: string | null;
  planStatus?: string | null;
};

/** The subset of a policy this comparison reads. */
export type PolicyBaseline = {
  id: string;
  contract_pbp: string | null;
  plan_name: string | null;
  effective_date: string | null;
  status: string | null;
};

export type ProposedDiff = {
  targetTable: 'ag_policies' | 'ag_clients';
  targetField: string;
  currentValue: string | null;
  incomingValue: string | null;
  confidence: 'low' | 'medium' | 'high';
  idempotencyKey: string;
};

/** Field-level comparison rules. Kept declarative so adding a field is data. */
const POLICY_FIELDS: ReadonlyArray<{
  field: string;
  current: (policy: PolicyBaseline) => string | null;
  incoming: (obs: CoverageObservation) => string | null | undefined;
  /** Comparison is on the normalised form; display keeps the raw value. */
  normalize?: (value: string | null) => string | null;
  confidence: 'low' | 'medium' | 'high';
}> = [
  {
    field: 'contract_pbp',
    current: (p) => p.contract_pbp,
    incoming: (o) => o.contractPbp,
    normalize: normalizeContractPbp,
    // A contract-PBP mismatch read straight off the CMS record is about as
    // strong a signal as this system gets.
    confidence: 'high',
  },
  {
    field: 'plan_name',
    current: (p) => p.plan_name,
    incoming: (o) => o.planName,
    // Marketing names drift constantly between carrier exports without the
    // underlying plan changing at all, so this stays advisory.
    confidence: 'low',
    normalize: (value) => (value ? value.trim().toLowerCase().replace(/\s+/g, ' ') : null),
  },
  {
    field: 'effective_date',
    current: (p) => p.effective_date,
    incoming: (o) => o.effectiveDate,
    confidence: 'medium',
  },
];

/**
 * Compare one observation against one policy and return the proposals.
 *
 * Returns [] — meaning "nothing for a human to do" — when the observation is
 * inconclusive, when it agrees with the record, or when the incoming value is
 * absent. That last case matters: a source that simply did not report a field
 * is not evidence that the field should be blanked.
 */
export function computeCoverageDiffs(input: {
  clientId: string;
  policy: PolicyBaseline;
  observation: CoverageObservation;
}): ProposedDiff[] {
  const { clientId, policy, observation } = input;

  if (!isConclusive(observation.verificationStatus)) return [];

  // "Member not found" and "no MA plan" are real findings, but they are
  // statements about absence. Turning them into field-level overwrites would
  // let a bad MBI silently blank a live policy, so they raise a task instead
  // (see coverageTaskCondition) and propose no field changes.
  if (observation.verificationStatus === 'not_found') return [];
  if (observation.verificationStatus === 'no_ma_plan') return [];

  const proposals: ProposedDiff[] = [];

  for (const rule of POLICY_FIELDS) {
    const rawIncoming = rule.incoming(observation);
    if (rawIncoming === undefined || rawIncoming === null || rawIncoming === '') continue;

    const rawCurrent = rule.current(policy);
    const normalize = rule.normalize ?? ((value: string | null) => value);

    if (normalize(rawCurrent) === normalize(rawIncoming)) continue;

    proposals.push({
      targetTable: 'ag_policies',
      targetField: rule.field,
      currentValue: rawCurrent,
      incomingValue: rawIncoming,
      confidence: rule.confidence,
      idempotencyKey: diffIdempotencyKey({
        source: observation.source,
        clientId,
        targetTable: 'ag_policies',
        targetField: rule.field,
        incomingValue: rawIncoming,
      }),
    });
  }

  return proposals;
}

// ── Task conditions ─────────────────────────────────────────────────────────

export type TaskCondition = {
  kind: string;
  title: string;
  detail: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
};

/**
 * Which observations deserve a task on Eric's queue.
 *
 * `active_same` deliberately returns null. An unchanged plan is the expected
 * outcome of most verifications, and manufacturing a task for it is how a work
 * queue becomes noise that gets ignored.
 */
export function coverageTaskCondition(
  observation: CoverageObservation,
  context: { clientName: string; consecutiveFailures?: number },
): TaskCondition | null {
  const { clientName } = context;

  switch (observation.verificationStatus) {
    case 'active_same':
      return null;

    case 'active_changed':
      return {
        kind: 'coverage_changed',
        title: `Coverage changed — ${clientName}`,
        detail: `${observation.source} reported plan ${observation.contractPbp ?? 'unknown'} on ${observation.observedAt}. Review the proposed change before it is applied.`,
        priority: 'high',
      };

    case 'pending_switch':
      return {
        kind: 'pending_switch',
        title: `Pending plan switch — ${clientName}`,
        detail: `A future enrollment was detected. Confirm whether this switch is expected.`,
        priority: 'high',
      };

    case 'not_found':
      return {
        kind: 'member_not_found',
        title: `Member not found — ${clientName}`,
        detail: `${observation.source} returned no record. The MBI may be wrong, or the member may have left the book.`,
        priority: 'normal',
      };

    case 'no_ma_plan':
      return {
        kind: 'no_ma_plan',
        title: `No active MA plan — ${clientName}`,
        detail: `${observation.source} shows enrollment history but no active Medicare Advantage contract.`,
        priority: 'high',
      };

    case 'ambiguous_match':
      return {
        kind: 'ambiguous_match',
        title: `Ambiguous identity match — ${clientName}`,
        detail: `More than one record matched. A human must decide which member this observation belongs to before it can be applied.`,
        priority: 'high',
      };

    case 'mfa_required':
    case 'login_required':
    case 'captcha_encountered':
      return {
        kind: 'verification_blocked',
        title: `Verification blocked — ${clientName}`,
        detail: `The source requires ${observation.verificationStatus.replace(/_/g, ' ')}. This must be completed by a human in the browser; it is never bypassed.`,
        priority: 'normal',
      };

    default: {
      // Repeated failure is a condition; a single transient one is not, or
      // every rate-limit blip would land on the queue.
      const failures = context.consecutiveFailures ?? 0;
      if (failures >= 3) {
        return {
          kind: 'verification_failing',
          title: `Verification failing repeatedly — ${clientName}`,
          detail: `${failures} consecutive failed attempts (last: ${observation.verificationStatus}).`,
          priority: 'normal',
        };
      }
      return null;
    }
  }
}
