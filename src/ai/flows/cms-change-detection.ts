'use server';
/**
 * @fileOverview A Genkit flow for autonomously detecting Medicare plan changes from snapshots.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const CmsSnapshotInputSchema = z.object({
  previousSnapshot: z.array(z.object({
    mbi: z.string(),
    planId: z.string(),
    carrier: z.string(),
    status: z.string(),
  })),
  currentSnapshot: z.array(z.object({
    mbi: z.string(),
    planId: z.string(),
    carrier: z.string(),
    status: z.string(),
  })),
});

const ChangeDetectionOutputSchema = z.object({
  detectedChanges: z.array(z.object({
    mbi: z.string(),
    type: z.enum(['switch', 'disenrollment', 'new-carrier']),
    details: z.string(),
    urgency: z.enum(['low', 'medium', 'high']),
  })),
});

export async function detectCmsChanges(input: z.infer<typeof CmsSnapshotInputSchema>) {
  return detectCmsChangesFlow(input);
}

const detectCmsChangesFlow = ai.defineFlow(
  {
    name: 'detectCmsChangesFlow',
    inputSchema: CmsSnapshotInputSchema,
    outputSchema: ChangeDetectionOutputSchema,
  },
  async (input) => {
    const {output} = await ai.generate({
      model: 'googleai/gemini-2.5-flash',
      prompt: `Analyze these two CMS Medicare enrollment snapshots and identify members who have switched plans or carriers.
      
      Previous Snapshot: ${JSON.stringify(input.previousSnapshot)}
      Current Snapshot: ${JSON.stringify(input.currentSnapshot)}
      
      Rules:
      - A change in planId or carrier for the same mbi is a 'switch'.
      - A member missing in the current snapshot who was in previous is a 'disenrollment'.
      - Assign urgency based on the type of change.
      `,
      output: {schema: ChangeDetectionOutputSchema},
    });
    return output!;
  }
);
