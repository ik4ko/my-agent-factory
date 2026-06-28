'use server';
/**
 * @fileOverview AI sentiment analysis for member check-in transcripts.
 *
 * - analyzeCallSentiment - A function that handles the sentiment analysis process.
 * - CallSentimentInput - The input type for the analyzeCallSentiment function.
 * - CallSentimentOutput - The return type for the analyzeCallSentiment function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const CallSentimentInputSchema = z.object({
  transcript: z.string().describe('The full transcript of the check-in call.'),
  memberName: z.string().describe('The name of the member.'),
});
export type CallSentimentInput = z.infer<typeof CallSentimentInputSchema>;

const CallSentimentOutputSchema = z.object({
  sentiment: z.enum(['Positive', 'Neutral', 'Negative']).describe('The overall sentiment of the call.'),
  churnRiskScore: z.number().min(0).max(100).describe('Calculated disenrollment risk (0-100).'),
  escalationReason: z.string().optional().describe('Reason for escalation if sentiment is Negative.'),
  keyPhrases: z.array(z.string()).describe('Identified phrases indicating satisfaction or issues.'),
});
export type CallSentimentOutput = z.infer<typeof CallSentimentOutputSchema>;

export async function analyzeCallSentiment(input: CallSentimentInput): Promise<CallSentimentOutput> {
  return callSentimentFlow(input);
}

const sentimentPrompt = ai.definePrompt({
  name: 'callSentimentPrompt',
  input: {schema: CallSentimentInputSchema},
  output: {schema: CallSentimentOutputSchema},
  prompt: `You are a clinical sentiment analyst for a Medicare retention platform. 
Analyze the following transcript of a check-in call with {{{memberName}}}.

Transcript:
{{{transcript}}}

Goals:
1. Determine the overall sentiment (Positive, Neutral, Negative).
2. Identify keywords that suggest disenrollment risk (e.g., "switching", "too expensive", "my doctor left", "AARP called me").
3. Calculate a Churn Risk Score where 100 is "Highest Risk" and 0 is "No Risk".
4. If Negative, provide a concise reason for escalation to a human broker.

Please populate the output schema accurately.`,
});

const callSentimentFlow = ai.defineFlow(
  {
    name: 'callSentimentFlow',
    inputSchema: CallSentimentInputSchema,
    outputSchema: CallSentimentOutputSchema,
  },
  async input => {
    const {output} = await sentimentPrompt(input);
    return output!;
  }
);
