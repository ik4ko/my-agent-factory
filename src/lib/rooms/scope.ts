// Room scoping — the single source of truth for which agents, tasks, and log
// lines belong to each room (Trading / Coding / Research). Used by the room
// pages, the scoped panel instances, and the Control Room's cross-room status
// strip, so a room and its status chip can never disagree.
//
// Grounding (verified against live data, 2026-07-07): tasks.assigned_lane was
// unpopulated, and all engine/risk log lines carry agent_id = null with a
// bracketed subsystem tag. Trading/Coding/Research scoping therefore keys off
// agent type/name and message/description patterns.
//
// UPGRADE (2026-07-25): the content pipeline is the first real writer of
// tasks.assigned_lane — every content step task carries its channel slug (see
// createStepTask in src/lib/pipeline/engine.ts). The Content room is
// consequently scoped off that REAL COLUMN, not a fourth description regex.
// The existing trading/coding regex matching is deliberately left untouched;
// it can migrate the same way once something writes lanes for those rooms.
import type { Agent, AgentType, Log, Task } from '@/lib/types/database.types';

export type RoomScope = 'all' | 'trading' | 'coding' | 'research' | 'content';

export interface RoomDef {
  scope: Exclude<RoomScope, 'all'>;
  label: string;
  href: string;
  accent: string; // tailwind text color class
}

export const ROOMS: RoomDef[] = [
  { scope: 'trading', label: 'Trading', href: '/dashboard/rooms/trading', accent: 'text-neon-green' },
  { scope: 'coding', label: 'Coding', href: '/dashboard/rooms/coding', accent: 'text-neon-cyan' },
  { scope: 'content', label: 'YouTube', href: '/dashboard/rooms/youtube', accent: 'text-neon-red' },
];

/** Lane values written by the orchestrator's route-lane hook. Anything else in
 *  assigned_lane is a content_channels.slug — this is the discriminator that
 *  lets the Content room read the column with no extra lookup. */
const ORCHESTRATOR_LANES = new Set(['SEAT', 'UP', 'DOWN']);

/** The channel slug a task belongs to, or null if it is not a content task.
 *  Reads the real assigned_lane column — no description matching. */
export function taskChannelSlug(task: Task): string | null {
  const lane = task.assigned_lane?.trim();
  if (!lane) return null;
  if (ORCHESTRATOR_LANES.has(lane.toUpperCase())) return null;
  return lane;
}

/** Exact per-channel membership — powers the room's channel switcher. */
export function taskInChannel(task: Task, slug: string): boolean {
  return taskChannelSlug(task) === slug;
}

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

/** Regex-matched rooms only. 'content' is intentionally absent — it is scoped
 *  by the real assigned_lane column (see taskChannelSlug), which is why adding
 *  this room did NOT add a fourth description pattern. */
const TASK_PATTERN: Record<Exclude<RoomScope, 'all' | 'content'>, RegExp> = {
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
  // No agent TYPE is natively content — the content playbook borrows whichever
  // generic/researcher/coder agents are idle. Membership is earned per run via
  // contentAgentIdsFromTasks, which the room passes explicitly.
  return false;
}

export function taskInScope(task: Task, scope: RoomScope, roomsByAgentId?: ReadonlyMap<string, Exclude<RoomScope, 'all'>[]>): boolean {
  if (scope === 'all') return true;
  // Real-column scoping, checked before any pattern: a task carrying a channel
  // slug in assigned_lane belongs to the content room regardless of wording.
  if (scope === 'content') return taskChannelSlug(task) !== null;
  if (TASK_PATTERN[scope].test(task.description)) return true;
  if (task.agent_id && roomsByAgentId?.get(task.agent_id)?.includes(scope)) return true;
  return false;
}

/** Agents that worked a content run — earned through assigned_lane history,
 *  mirroring tradingAgentIdsFromTasks. */
export function contentAgentIdsFromTasks(tasks: Task[]): Set<string> {
  const ids = new Set<string>();
  for (const t of tasks) {
    if (t.agent_id && taskChannelSlug(t)) ids.add(t.agent_id);
  }
  return ids;
}

export function logInScope(log: Log, scope: RoomScope, scopeAgentIds?: ReadonlySet<string>): boolean {
  if (scope === 'all') return true;
  if (log.agent_id && scopeAgentIds?.has(log.agent_id)) return true;
  if (scope === 'trading') return TRADING_LOG_PATTERN.test(log.message);
  if (scope === 'coding') return /\bcodex\b|\[(pipeline|sandbox|tool-runner)\]/i.test(log.message);
  if (scope === 'research') return /\bnews:|\bsentiment\b|\bresearch\b|\bscout\b/i.test(log.message);
  // Content stage tags emitted by the pipeline engine ("[SCRIPT] …",
  // "[PUBLISH] …") plus the channel-scoped pipeline start line.
  if (scope === 'content') return /\[(script|assets|voiceover|assembly|publish)\]|channel=/i.test(log.message);
  return false;
}

/** Agents that have earned trading-room membership through trading-domain
 *  task history (or a trading-analysis task in flight). */
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

// 'content' is first: it is decided by a real column, so it must win over the
// description regexes (a content script about "market trends" is still content).
const SCOPE_PRIORITY: Exclude<RoomScope, 'all'>[] = ['content', 'trading', 'coding', 'research'];

/** Best-effort single room for a task — first matching scope wins (same
 *  description/agent patterns as taskInScope), else 'all'. Used to select
 *  scope-specific policies, e.g. the sandbox's web_fetch domain allowlist. */
export function resolveTaskRoomScope(task: Task, roomsByAgentIdMap?: ReadonlyMap<string, Exclude<RoomScope, 'all'>[]>): RoomScope {
  for (const scope of SCOPE_PRIORITY) {
    if (taskInScope(task, scope, roomsByAgentIdMap)) return scope;
  }
  return 'all';
}
