import Anthropic from '@anthropic-ai/sdk';
import type { AgentType } from '@/lib/types/database.types';
import type { ParsedIntent } from './types';

type RulePattern = { pattern: RegExp; agentType: AgentType; priority: number };

const RULES: RulePattern[] = [
  { pattern: /(write|create|build|code|implement|fix|debug|refactor)/i, agentType: 'coder', priority: 7 },
  { pattern: /(research|find|search|look up|analyze|compare|investigate)/i, agentType: 'researcher', priority: 5 },
  { pattern: /(browse|open|navigate|click|scrape|fetch|visit)/i, agentType: 'browser', priority: 5 },
  { pattern: /(plan|decompose|break down|organize|schedule|prioritize)/i, agentType: 'planner', priority: 6 },
];

let _anthropic: Anthropic | null = null;
function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

function applyRules(command: string): ParsedIntent | null {
  for (const { pattern, agentType, priority } of RULES) {
    if (pattern.test(command)) {
      return { agentType, priority, description: command, confidence: 'rule' };
    }
  }
  return null;
}

async function llmFallback(command: string): Promise<ParsedIntent> {
  const client = getAnthropic();
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 128,
    messages: [
      {
        role: 'user',
        content: `Classify this command for an AI agent factory. Reply with JSON only — no explanation:\n{"agentType":"coder"|"researcher"|"browser"|"planner"|"generic","priority":1-10}\n\nCommand: ${command}`,
      },
    ],
  });

  try {
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '{}';
    const json = text.match(/\{[\s\S]*\}/)?.[0] ?? '{}';
    const parsed = JSON.parse(json) as { agentType?: string; priority?: number };
    return {
      agentType: (parsed.agentType ?? 'generic') as AgentType,
      priority: Math.min(10, Math.max(1, Number(parsed.priority ?? 5))),
      description: command,
      confidence: 'llm',
    };
  } catch {
    return { agentType: 'generic', priority: 5, description: command, confidence: 'llm' };
  }
}

export async function parseIntent(command: string): Promise<ParsedIntent> {
  return applyRules(command) ?? (await llmFallback(command));
}
