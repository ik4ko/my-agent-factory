import { Anthropic } from '@anthropic-ai/sdk';
import { z } from 'zod';
import { hermesLog } from '@/lib/hermes/hermes-logger';

// 1. Fully open-ended schema for any department: Trading, Coding, Email, or Meta
export const HermesTaskSchema = z.object({
  department: z.enum(['TRADING', 'DEVELOPMENT', 'COMMUNICATION', 'GENERAL']),
  summary: z.string(),
  assignedAgent: z.enum(['HERMES_AI', 'CODEX_AI', 'BUILDER_AI']),
  payload: z.record(z.any())
});

export type HermesTask = z.infer<typeof HermesTaskSchema>;

export async function runHermesAgent(rawInput: string): Promise<HermesTask> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  
  // Track interception with correct logging signatures
  await hermesLog('info', '[Hermes] Intercepted user task input string.');
  
  // Notice the broad system instruction: Hermes is an autonomous team coordinator
  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 800,
    system: `You are Hermes AI, the executive coordinator of an elite multi-agent system. 
    Your teammates are CODEX_AI (specialized in quantitative risk/trading) and BUILDER_AI (specialized in writing code and managing files).
    
    Analyze the user's request. Determine which department it belongs to, write a summary of the intent, assign it to the correct agent (including yourself if it is communication/coordination), and structure any relevant data into the flexible payload object.
    
    Respond ONLY with a valid, raw JSON object matching this schema:
    {
      "department": "TRADING" | "DEVELOPMENT" | "COMMUNICATION" | "GENERAL",
      "summary": "Brief explanation of what needs to be done",
      "assignedAgent": "HERMES_AI" | "CODEX_AI" | "BUILDER_AI",
      "payload": {}
    }`,
    messages: [{ role: 'user', content: rawInput }]
  });

  // 2. Type Guard: Safely handle modern ContentBlock / ThinkingBlock variants
  const firstBlock = response.content[0];
  if (!firstBlock || firstBlock.type !== 'text') {
    throw new Error('[Hermes] Invalid or non-text response type received from model brain.');
  }

  const rawText = firstBlock.text;
  const result = HermesTaskSchema.parse(JSON.parse(rawText));
  
  // Commit the final allocation logs to the database stream before returning
  await hermesLog('info', `[Hermes] Decided task allocation: Department: ${result.department} assigned to ${result.assignedAgent}`);
  
  return result;
}