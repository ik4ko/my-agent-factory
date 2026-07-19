import { LifeContextCandidateListSchema, type LifeContextCandidate } from './types';

export const LIFE_CONTEXT_BLOCK_START = '<life_context_proposals>';
export const LIFE_CONTEXT_BLOCK_END = '</life_context_proposals>';

export const LIFE_CONTEXT_MODEL_INSTRUCTIONS = `
You may propose durable shared life facts when the user reveals something useful across mentor conversations.
Never treat a proposal as already saved. Put at most 5 proposals in one final block after your normal reply:
${LIFE_CONTEXT_BLOCK_START}
[{"operation":"create","category":"appointment|routine|commitment|preference|important_fact","subject":"short label","value":"concise fact","semanticKey":"lowercase:stable:key","sensitivity":"ordinary|medical|financial|consequential","sourceBasis":"explicit|inferred","sourceQuote":"exact quote from the CURRENT user message","startsAt":"optional ISO timestamp"}]
${LIFE_CONTEXT_BLOCK_END}
Use [] when there is nothing worth remembering. sourceQuote must be verbatim, never paraphrased. Updates/deletes must include targetId when known. This block is machine-readable and will not be shown as part of your reply.`;

export function parseLifeContextProposals(content: string): { content: string; candidates: LifeContextCandidate[] } {
  const start = content.lastIndexOf(LIFE_CONTEXT_BLOCK_START);
  const end = content.lastIndexOf(LIFE_CONTEXT_BLOCK_END);
  if (start < 0 || end < start) return { content: content.trim(), candidates: [] };
  const visible = `${content.slice(0, start)}${content.slice(end + LIFE_CONTEXT_BLOCK_END.length)}`.trim();
  const raw = content.slice(start + LIFE_CONTEXT_BLOCK_START.length, end).trim();
  try {
    const parsed = LifeContextCandidateListSchema.safeParse(JSON.parse(raw));
    return { content: visible, candidates: parsed.success ? parsed.data : [] };
  } catch {
    return { content: visible, candidates: [] };
  }
}
