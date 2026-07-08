// Room scoping — the single source of truth for which agents, tasks, and log
// lines belong to each room (Trading / Coding / Research). Used by the room
// pages, the scoped panel instances, and the Control Room's cross-room status
// strip, so a room and its status chip can never disagree.
//
// Grounding (verified against live data, 2026-07-07): tasks.assigned_lane is
// unpopulated, and all engine/risk log lines carry agent_id = null with a
// bracketed subsystem tag. Scoping therefore keys off agent type/name and
// message/description patterns; when lanes start being written, this module
// is the one place to upgrade.
import type { Agent, AgentType, Log, Task } from '@/lib/types/database.types';

export type RoomScope = 'all' | 'trading' | 'coding' | 'research';

export interface RoomDef {
  scope: Exclude<RoomScope, 'all'>;
  label: string;
  href: string;
  accent: string; // tailwind text color class
}

export const ROOMS: RoomDef[] = [
  { scope: 'trading', label: 'Trading', href: '/dashboard/rooms/trading', accent: 'text-neon-green' },
  { scope: 'coding', label: 'Coding', href: '/dashboard/rooms/coding', accent: 'text-neon-cyan' },
];

/** Agent-type → rooms. Hermes (generic) leads Research; Codex (coder) leads
 *  Coding. No agent type is natively "trading" — trading work is loop-engine
 *  driven, so trading membership is earned via trading-domain task history
 *  (see agentInScope's extra set). */
const TYPE_ROOMS: Record<AgentType, Exclude<RoomScope, 'all'>[]> = {
  coder: ['coding'],
  planner: ['coding'],
  researcher: ['research'],
  browser: ['research'],
  generic: ['research'],
};

/** Engine/risk subsystem tags — matches the real hermesLog line shapes
 *  ("[RISK] …", "[ORDER] …", "kill switch ENGAGED …"). */
export const TRADING_LOG_PATTERN =
  /\[(risk|order|regime|control|loop|loop-worker|command|preflight|selftest|comms)\]|kill switch|auto-halt|staged|quote|trade|market/i;

export const TRADING_TASK_PATTERN =
  /\b(trade|trading|market|etf|stock|ticker|option|portfolio|pnl|earnings|momentum|volatility|rsi|macd|spy|nvda|soxs|semiconductor)\b/i;
export const CODING_TASK_PATTERN =
  /\b(code|coding|build|implement|refactor|fix|bug|test|deploy|component|endpoint|api|schema|script)\b/i;
export const RESEARCH_TASK_PATTERN =
  /\b(research|analy[sz]e|investigate|scout|news|sentiment|summar\w*|report|explore|compare)\b/i;

const TASK_PATTERN: Record<Exclude<RoomScope, 'all'>, RegExp> = {
  trading: TRADING_TASK_PATTERN,
  coding: CODING_TASK_PATTERN,
  research: RESEARCH_TASK_PATTERN,
};

export function agentRooms(agent: Agent): Exclude<RoomScope, 'all'>[] {
  return TYPE_ROOMS[agent.type ?? 'generic'] ?? [];
}

/** Does this agent belong in the room? `tradingAgentIds` is the earned-
 *  membership set: agents with trading-domain task history (computed by the
 *  caller from the tasks it already holds). */
export function agentInScope(agent: Agent, scope: RoomScope, tradingAgentIds?: ReadonlySet<string>): boolean {
  if (scope === 'all') return true;
  if (agentRooms(agent).includes(scope)) return true;
  if (scope === 'trading') return tradingAgentIds?.has(agent.id) ?? false;
  return false;
}

export function taskInScope(task: Task, scope: RoomScope, roomsByAgentId?: ReadonlyMap<string, Exclude<RoomScope, 'all'>[]>): boolean {
  if (scope === 'all') return true;
  if (TASK_PATTERN[scope].test(task.description)) return true;
  if (task.agent_id && roomsByAgentId?.get(task.agent_id)?.includes(scope)) return true;
  return false;
}

export function logInScope(log: Log, scope: RoomScope, scopeAgentIds?: ReadonlySet<string>): boolean {
  if (scope === 'all') return true;
  if (log.agent_id && scopeAgentIds?.has(log.agent_id)) return true;
  if (scope === 'trading') return TRADING_LOG_PATTERN.test(log.message);
  if (scope === 'coding') return /\bcodex\b|\[(pipeline|sandbox|tool-runner)\]/i.test(log.message);
  if (scope === 'research') return /\bnews:|\bsentiment\b|\bresearch\b|\bscout\b/i.test(log.message);
  return false;
}

/** Agents that have earned trading-room membership through trading-domain
 *  task history (or a live trading task in flight). */
export function tradingAgentIdsFromTasks(tasks: Task[]): Set<string> {
  const ids = new Set<string>();
  for (const t of tasks) {
    if (t.agent_id && TRADING_TASK_PATTERN.test(t.description)) ids.add(t.agent_id);
  }
  return ids;
}

export function roomsByAgentId(agents: Agent[]): Map<string, Exclude<RoomScope, 'all'>[]> {
  return new Map(agents.map((a) => [a.id, agentRooms(a)]));
}

export function scopeAgentIds(agents: Agent[], scope: RoomScope, tradingAgentIds?: ReadonlySet<string>): Set<string> {
  return new Set(agents.filter((a) => agentInScope(a, scope, tradingAgentIds)).map((a) => a.id));
}
