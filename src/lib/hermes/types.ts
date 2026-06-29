import type { AgentType } from '@/lib/types/database.types';

export interface ParsedIntent {
  agentType: AgentType;
  priority: number;
  description: string;
  confidence: 'rule' | 'llm';
}

export interface HermesResult {
  requestId: string;
  status: 'dispatched' | 'no_agents' | 'error';
  taskId?: string;
  agentId?: string;
  agentName?: string;
  intent: ParsedIntent;
  message: string;
}
