'use server';
/**
 * @fileOverview This file defines a Genkit flow for generating insurance plan suggestions and risk flags based on client information.
 *
 * - insurancePlanRecommendation - A function that handles the insurance plan recommendation process.
 * - InsurancePlanRecommendationInput - The input type for the insurancePlanRecommendation function.
 * - InsurancePlanRecommendationOutput - The return type for the insurancePlanRecommendation function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const InsurancePlanRecommendationInputSchema = z.object({
  age: z.number().min(0).describe('The client\u0027s age.'),
  healthConditions: z
    .array(z.string())
    .describe('A list of the client\u0027s health conditions or medical history.'),
  medicareMedicaidStatus: z
    .enum(['None', 'Medicare', 'Medicaid', 'Both'])
    .describe('The client\u0027s Medicare or Medicaid status.'),
});
export type InsurancePlanRecommendationInput = z.infer<
  typeof InsurancePlanRecommendationInputSchema
>;

const InsurancePlanRecommendationOutputSchema = z.object({
  suggestedPlans: z
    .array(
      z.object({
        name: z.string().describe('The name of the suggested insurance plan.'),
        description: z
          .string()
          .describe('A brief description of the insurance plan.'),
        reasoning: z
          .string()
          .describe('Explanation of why this plan is suitable for the client.'),
      })
    )
    .describe('A list of tailored insurance plan suggestions.'),
  riskFlags: z
    .array(z.string().describe('A potential risk or concern based on the client\u0027s information.'))
    .describe('A list of identified risk flags.'),
  summary: z
    .string()
    .describe('A general summary of the recommendations and risks.'),
});
export type InsurancePlanRecommendationOutput = z.infer<
  typeof InsurancePlanRecommendationOutputSchema
>;

export async function insurancePlanRecommendation(
  input: InsurancePlanRecommendationInput
): Promise<InsurancePlanRecommendationOutput> {
  return insurancePlanRecommendationFlow(input);
}

const insurancePlanRecommendationPrompt = ai.definePrompt({
  name: 'insurancePlanRecommendationPrompt',
  input: {schema: InsurancePlanRecommendationInputSchema},
  output: {schema: InsurancePlanRecommendationOutputSchema},
  prompt: `You are an expert insurance agent specializing in recommending suitable insurance plans and identifying potential risks for clients.

Given the following client details, provide tailored insurance plan suggestions, coverage recommendations, and highlight any relevant risk flags.
For each suggested plan, explain 'Why this plan?' by providing clear reasoning based on the client's information.

Client Details:
- Age: {{{age}}}
- Health Conditions: {{#if healthConditions}}{{#each healthConditions}}- {{{this}}}
{{/each}}{{else}}None{{/if}}
- Medicare/Medicaid Status: {{{medicareMedicaidStatus}}}

Carefully analyze the information and provide:
1. A list of suitable insurance plan suggestions, including their names, descriptions, and detailed reasoning for each.
2. Any potential risk flags or concerns based on the client's profile.
3. An overall summary of your recommendations and identified risks.

Please format your response according to the provided JSON schema, ensuring all fields are populated accurately and comprehensively.`,
});

const insurancePlanRecommendationFlow = ai.defineFlow(
  {
    name: 'insurancePlanRecommendationFlow',
    inputSchema: InsurancePlanRecommendationInputSchema,
    outputSchema: InsurancePlanRecommendationOutputSchema,
  },
  async input => {
    const {output} = await insurancePlanRecommendationPrompt(input);
    return output!;
  }
);
