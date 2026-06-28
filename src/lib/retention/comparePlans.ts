// Plan-to-plan delta analysis for Medicare retention risk scoring.
// Scores range 0–100. Scores above 50 are treated as High Risk in the dashboard.

export interface RiskProfile {
  score: number;
  lastChecked: Date;
  reasons: string[];
}

export interface PlanSnapshot {
  planId: string;
  monthly_allowance: number;       // OTC / flex-card allowance ($)
  out_of_pocket_max: number;       // Annual MOOP ($) — higher is worse
  dental_coverage_limit: number;   // Annual dental benefit cap ($)
  [key: string]: unknown;
}

export interface NegativeDelta {
  field: 'monthly_allowance' | 'out_of_pocket_max' | 'dental_coverage_limit';
  label: string;
  delta: number;      // absolute change (negative means member loses value)
  pctChange: number;  // fractional change relative to plan25
}

// ---------------------------------------------------------------------------
// Weight table: how much each field contributes to the 0-100 risk score.
// Weights sum to 100 so the score is directly interpretable as a percentage.
// ---------------------------------------------------------------------------
const FIELD_CONFIG = [
  {
    field:       'out_of_pocket_max'      as NegativeDelta['field'],
    label:       'Out-of-Pocket Maximum',
    weight:      40,
    higherIsBad: true,   // cost the member bears — an increase is a negative
  },
  {
    field:       'monthly_allowance'      as NegativeDelta['field'],
    label:       'Monthly OTC / Flex Allowance',
    weight:      35,
    higherIsBad: false,  // benefit the member receives — a decrease is a negative
  },
  {
    field:       'dental_coverage_limit'  as NegativeDelta['field'],
    label:       'Dental Coverage Limit',
    weight:      25,
    higherIsBad: false,
  },
] as const;

// ---------------------------------------------------------------------------
// calculateRetentionRisk
//
// Compares a member's 2025 plan to their 2026 plan.  For each of the three
// sentinel fields it checks whether the change is adverse, scales that change
// against the field's weight, and accumulates a score.
//
// A 25 % adverse swing in any single field moves that field to its full weight
// contribution; smaller swings are proportional.
// ---------------------------------------------------------------------------
export function calculateRetentionRisk(
  plan25: PlanSnapshot,
  plan26: PlanSnapshot,
): { score: number; deltas: NegativeDelta[]; riskProfile: RiskProfile } {
  let totalScore = 0;
  const deltas: NegativeDelta[] = [];
  const reasons: string[] = [];

  for (const { field, label, weight, higherIsBad } of FIELD_CONFIG) {
    const v25 = (plan25[field] as number) ?? 0;
    const v26 = (plan26[field] as number) ?? 0;
    const delta = v26 - v25;
    const pctChange = v25 !== 0 ? delta / v25 : 0;

    const isAdverse = higherIsBad ? delta > 0 : delta < 0;

    if (isAdverse) {
      // Scale linearly: a 25 % or greater swing reaches the field's full weight.
      const magnitude = Math.abs(pctChange);
      const contribution = Math.min((magnitude / 0.25) * weight, weight);
      totalScore += contribution;

      deltas.push({ field, label, delta, pctChange });

      const direction = higherIsBad ? 'increased' : 'decreased';
      reasons.push(
        `${label} ${direction} by ${(magnitude * 100).toFixed(1)}%`
        + (higherIsBad
          ? ` (member cost up $${Math.abs(delta).toFixed(0)})`
          : ` (benefit reduced by $${Math.abs(delta).toFixed(0)})`),
      );
    }
  }

  const score = Math.min(Math.round(totalScore), 100);

  const riskProfile: RiskProfile = {
    score,
    lastChecked: new Date(),
    reasons,
  };

  return { score, deltas, riskProfile };
}
