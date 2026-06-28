'use server';
/**
 * @fileOverview Client churn prediction: rule-based risk scoring + optional AI narrative.
 *
 * Exports:
 *  scoreClientRisk(input)  -- pure deterministic rule engine, safe to call from
 *                            Cloud Functions or the client. No AI dependency.
 *  predictClientChurn(input) -- Genkit AI flow for a human-readable suggested action.
 *  HIGH_RISK_THRESHOLD, MEDIUM_RISK_THRESHOLD -- shared constants used by FCM trigger.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

// ---------------------------------------------------------------------------
// Thresholds -- also imported by the Cloud Function (keep in sync with
// functions/src/index.ts RISK_THRESHOLDS constant).
// ---------------------------------------------------------------------------
export const HIGH_RISK_THRESHOLD = 65;
export const MEDIUM_RISK_THRESHOLD = 35;

// ---------------------------------------------------------------------------
// Rule-based risk engine
// ---------------------------------------------------------------------------

export interface RiskInput {
  age: number;
  lastReviewDate?: string;
  ptcExpiryDate?: string;
  checkInStatus?: string;
  lastCallSentiment?: string;
  medicareMedicaidStatus?: string;
  VCCStatus?: string;
  poaStatus?: string;
  futureContract?: string;
  carrier?: string;
}

export interface RiskScore {
  score: number;              // 0-100
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  triggers: string[];         // Human-readable reasons, ordered by severity
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function scoreClientRisk(input: RiskInput): RiskScore {
  let score = 0;
  const triggers: string[] = [];
  const today = new Date();

  // Plan non-renewal: CMS shows a future contract different from current carrier
  // This is the highest-weight signal -- the plan will not exist next year.
  if (input.futureContract && input.carrier &&
      !input.futureContract.startsWith(input.carrier.slice(0, 3))) {
    score += 35;
    triggers.push('CMS plan non-renewal detected -- contract changing next year');
  }

  // Age triggers
  if (input.age >= 64 && input.age <= 66) {
    score += 30;
    triggers.push('Approaching Medicare eligibility window');
  } else if (input.age >= 80) {
    score += 20;
    triggers.push('Age 80+ -- elevated care coordination needs');
  }

  // Escalated check-in
  if (input.checkInStatus === 'escalated') {
    score += 25;
    triggers.push('Active escalation flag on check-in');
  }

  // Overdue policy review
  if (input.lastReviewDate) {
    const daysSince = daysBetween(new Date(input.lastReviewDate), today);
    if (daysSince >= 330) {
      score += 25;
      triggers.push(`No policy review in ${Math.floor(daysSince / 30)} months`);
    }
  } else {
    score += 20;
    triggers.push('No policy review on record');
  }

  // PTC consent expiry
  if (input.ptcExpiryDate) {
    const daysUntil = daysBetween(today, new Date(input.ptcExpiryDate));
    if (daysUntil <= 0) {
      score += 25;
      triggers.push('PTC consent has expired');
    } else if (daysUntil <= 30) {
      score += 15;
      triggers.push(`PTC consent expires in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`);
    }
  }

  // Negative last call sentiment
  if (input.lastCallSentiment === 'negative') {
    score += 20;
    triggers.push('Negative sentiment on last recorded call');
  }

  // Dual-eligible with pending VCC application
  if (input.medicareMedicaidStatus === 'Both' && input.VCCStatus === 'pending-fax') {
    score += 15;
    triggers.push('Dual-eligible member with pending VCC application');
  }

  // No POA protection
  if (input.poaStatus === 'unprotected') {
    score += 10;
    triggers.push('No power-of-attorney protection in place');
  }

  const capped = Math.min(score, 100);
  const level: RiskScore['level'] =
    capped >= HIGH_RISK_THRESHOLD ? 'HIGH'
    : capped >= MEDIUM_RISK_THRESHOLD ? 'MEDIUM'
    : 'LOW';

  return { score: capped, level, triggers };
}

// ---------------------------------------------------------------------------
// Genkit AI flow -- adds a human-readable narrative on top of the rule score
// ---------------------------------------------------------------------------

const ClientChurnPredictionInputSchema = z.object({
  clientAge: z.number().describe('The client\'s current age.'),
  lastReviewDate: z
    .string()
    .optional()
    .describe(
      'The date of the client\'s last policy review in "YYYY-MM-DD" format. Optional.'
    ),
});

const ClientChurnPredictionPromptSchema = ClientChurnPredictionInputSchema.extend({
  currentDate: z.string().describe('The current date in YYYY-MM-DD format.'),
});

export type ClientChurnPredictionInput = z.infer<typeof ClientChurnPredictionInputSchema>;

const ClientChurnPredictionOutputSchema = z.object({
  needsReview: z
    .boolean()
    .describe('Whether the client needs a policy review or new coverage.'),
  reason: z
    .string()
    .describe('The primary reason why the client needs a review or new coverage.'),
  suggestedAction: z
    .string()
    .describe('A suggested action for the agent to take based on the identified need.'),
});

export type ClientChurnPredictionOutput = z.infer<typeof ClientChurnPredictionOutputSchema>;

export async function predictClientChurn(
  input: ClientChurnPredictionInput
): Promise<ClientChurnPredictionOutput> {
  return clientChurnPredictionFlow(input);
}

const predictClientChurnPrompt = ai.definePrompt({
  name: 'predictClientChurnPrompt',
  input: {schema: ClientChurnPredictionPromptSchema},
  output: {schema: ClientChurnPredictionOutputSchema},
  prompt: `You are an AI assistant tasked with identifying clients who might need a policy review or new coverage to prevent churn.

Analyze the following client data and determine if a review is needed, provide a clear reason, and suggest an action for the agent.

Rules for identifying needs:
1. If the client's age is 64 or older, they likely need a review for Medicare or retirement planning. This is a high priority.
2. If the client's last policy review date is 11 months ago or more, they need a review due to inactivity. Assume current date is {{currentDate}}.

Client Data:
- Current Age: {{{clientAge}}}
- Last Policy Review Date: {{{lastReviewDate}}}

Consider the current date as {{currentDate}} when evaluating the last policy review date.

If the client needs a review, set 'needsReview' to true, provide a concise 'reason' (e.g., "Approaching Medicare eligibility" or "Overdue for policy review"), and a 'suggestedAction' (e.g., "Schedule Medicare consultation" or "Contact client for review"). If no review is needed, set 'needsReview' to false, and the reason and suggestedAction can be an empty string.
`,
});

const clientChurnPredictionFlow = ai.defineFlow(
  {
    name: 'clientChurnPredictionFlow',
    inputSchema: ClientChurnPredictionInputSchema,
    outputSchema: ClientChurnPredictionOutputSchema,
  },
  async input => {
    const currentDate = new Date().toISOString().split('T')[0];
    const {output} = await predictClientChurnPrompt({
      ...input,
      currentDate,
    });
    return output!;
  }
);
