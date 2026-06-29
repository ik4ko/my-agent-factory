import { randomUUID } from 'crypto';
import { parseIntent } from './intent-parser';
import { hermesLog } from './hermes-logger';
import { readRecentMemory, writeMemory } from './memory-service';
import { findIdleAgent, createTask, assignAgentToTask } from './task-router';
import type { HermesResult } from './types';

export async function runHermesCommand(command: string): Promise<HermesResult> {
  const requestId = randomUUID();

  await hermesLog('info', `Command received: "${command}"`, { requestId });

  // 1. Parse intent (rule-based first, LLM fallback)
  let intent;
  try {
    intent = await parseIntent(command);
    await hermesLog(
      'debug',
      `Intent: type=${intent.agentType} priority=${intent.priority} via=${intent.confidence}`,
      { requestId, intent }
    );
  } catch (err) {
    await hermesLog('error', `Intent parsing failed: ${String(err)}`, { requestId });
    return {
      requestId,
      status: 'error',
      intent: { agentType: 'generic', priority: 5, description: command, confidence: 'llm' },
      message: 'Failed to parse intent.',
    };
  }

  // 2. Read recent memory for context (non-blocking — failure is tolerated)
  try {
    const memories = await readRecentMemory(3);
    if (memories.length > 0) {
      await hermesLog('debug', `Loaded ${memories.length} memory entries`, { requestId });
    }
  } catch { /* memory read failure does not block dispatch */ }

  // 3. Find an idle agent of the target type
  const agent = await findIdleAgent(intent.agentType);
  if (!agent) {
    await hermesLog('warn', `No idle ${intent.agentType} agent available`, { requestId });
    return {
      requestId,
      status: 'no_agents',
      intent,
      message: `No idle ${intent.agentType} agent available. Try again shortly.`,
    };
  }

  // 4. Create task and assign agent
  let task;
  try {
    task = await createTask(intent.description, intent.priority, agent.id);
    await assignAgentToTask(agent.id, task.id);
    await hermesLog(
      'success',
      `Dispatched to ${agent.name} — task ${task.id.slice(0, 8)}`,
      { requestId, taskId: task.id, agentId: agent.id },
      task.id
    );
  } catch (err) {
    await hermesLog('error', `Dispatch failed: ${String(err)}`, { requestId });
    return { requestId, status: 'error', intent, message: `Dispatch failed: ${String(err)}` };
  }

  // 5. Write memory — record last command for future context
  try {
    await writeMemory(
      'hermes:last_command',
      { command, agentType: intent.agentType, taskId: task.id, agentName: agent.name, timestamp: new Date().toISOString() },
      { tags: ['hermes', 'command', intent.agentType], importance: 4, source: 'hermes' }
    );
  } catch { /* memory write failure does not break the response */ }

  return {
    requestId,
    status: 'dispatched',
    taskId: task.id,
    agentId: agent.id,
    agentName: agent.name,
    intent,
    message: `Dispatched to ${agent.name}`,
  };
}
