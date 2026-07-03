'use client';

import type { QueryClient } from '@tanstack/react-query';
import { LOGS_KEY } from '@/hooks/use-logs-query';
import { AGENTS_KEY } from '@/hooks/use-agents-query';
import { spawnAgent, pauseAgent, sysInject } from '@/lib/control/actions';
import type { Agent, AgentType } from '@/lib/types/database.types';

export const AGENT_ROLES: AgentType[] = ['generic', 'coder', 'researcher', 'browser', 'planner'];

export interface CommandContext {
  queryClient: QueryClient;
  print: (text: string, level?: 'info' | 'success' | 'error' | 'system') => void;
  requestEmergencyStop: () => void;
}

export interface CommandDef {
  name: string;
  usage: string;
  description: string;
  run: (args: string[], ctx: CommandContext) => Promise<void> | void;
}

export interface ParsedCommand {
  name: string;
  args: string[];
  raw: string;
}

/** Tokenize a raw `/command arg --flag value` string. */
export function parseCommand(input: string): ParsedCommand | null {
  const raw = input.trim().replace(/^\//, '');
  if (!raw) return null;
  const tokens = raw.match(/"[^"]*"|\S+/g)?.map((t) => t.replace(/^"|"$/g, '')) ?? [];
  if (tokens.length === 0) return null;
  return { name: tokens[0].toLowerCase(), args: tokens.slice(1), raw };
}

function getFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

export const COMMANDS: Record<string, CommandDef> = {
  help: {
    name: 'help',
    usage: '/help',
    description: 'List available commands',
    run: (_args, ctx) => {
      ctx.print('Available commands:', 'system');
      for (const c of Object.values(COMMANDS)) ctx.print(`  ${c.usage.padEnd(34)} ${c.description}`, 'info');
    },
  },

  spawn: {
    name: 'spawn',
    usage: '/spawn <name> --role <type>',
    description: 'Provision a new agent',
    run: async (args, ctx) => {
      const name = args[0]?.startsWith('--') ? undefined : args[0];
      const role = (getFlag(args, '--role') ?? 'generic') as AgentType;
      if (!name) return ctx.print('spawn: a name is required — /spawn Atlas --role coder', 'error');
      if (!AGENT_ROLES.includes(role)) return ctx.print(`spawn: invalid role "${role}" (${AGENT_ROLES.join('|')})`, 'error');
      ctx.print(`Spawning "${name}" as ${role}…`, 'system');
      try {
        const agent = await spawnAgent(name, role);
        ctx.print(`✓ Agent "${agent.name}" online (${agent.id.slice(0, 8)})`, 'success');
      } catch (e) {
        ctx.print(`✗ ${e instanceof Error ? e.message : 'spawn failed'}`, 'error');
      }
    },
  },

  pause: {
    name: 'pause',
    usage: '/pause <agent_id>',
    description: 'Pause an active agent',
    run: async (args, ctx) => {
      const id = args[0];
      if (!id) return ctx.print('pause: an agent id is required', 'error');
      try {
        await pauseAgent(id, true);
        ctx.print(`✓ Agent ${id.slice(0, 8)} paused`, 'success');
      } catch (e) {
        ctx.print(`✗ ${e instanceof Error ? e.message : 'pause failed'}`, 'error');
      }
    },
  },

  resume: {
    name: 'resume',
    usage: '/resume <agent_id>',
    description: 'Resume a paused agent',
    run: async (args, ctx) => {
      const id = args[0];
      if (!id) return ctx.print('resume: an agent id is required', 'error');
      try {
        await pauseAgent(id, false);
        ctx.print(`✓ Agent ${id.slice(0, 8)} resumed`, 'success');
      } catch (e) {
        ctx.print(`✗ ${e instanceof Error ? e.message : 'resume failed'}`, 'error');
      }
    },
  },

  'clear-logs': {
    name: 'clear-logs',
    usage: '/clear-logs',
    description: 'Flush the local log view (does not touch the database)',
    run: (_args, ctx) => {
      ctx.queryClient.setQueryData(LOGS_KEY, []);
      ctx.print('✓ Local log view cleared', 'success');
    },
  },

  'sys-inject': {
    name: 'sys-inject',
    usage: '/sys-inject <message>',
    description: 'Broadcast a priority system-prompt injection to the active run',
    run: async (args, ctx) => {
      const message = args.join(' ').trim();
      if (!message) return ctx.print('sys-inject: a message is required', 'error');
      try {
        await sysInject(message);
        ctx.print(`✓ Injected: "${message}"`, 'success');
      } catch (e) {
        ctx.print(`✗ ${e instanceof Error ? e.message : 'injection failed'}`, 'error');
      }
    },
  },

  halt: {
    name: 'halt',
    usage: '/halt',
    description: 'Trigger the guarded Emergency Stop confirmation',
    run: (_args, ctx) => {
      ctx.print('Opening Emergency Stop confirmation…', 'system');
      ctx.requestEmergencyStop();
    },
  },
};

/**
 * Suggestions for the current input: command names while typing the verb,
 * or live agent IDs once the verb is a command that takes an agent id.
 */
export function autocomplete(input: string, queryClient: QueryClient): string[] {
  const parsed = parseCommand(input);
  const endsWithSpace = /\s$/.test(input);

  // Still typing the command name.
  if (parsed && !endsWithSpace && parsed.args.length === 0) {
    return Object.keys(COMMANDS)
      .filter((name) => name.startsWith(parsed.name))
      .map((name) => `/${name}`);
  }

  // Agent-id completion for pause/resume.
  if (parsed && (parsed.name === 'pause' || parsed.name === 'resume')) {
    const agents = queryClient.getQueryData<Agent[]>(AGENTS_KEY) ?? [];
    const frag = parsed.args[0] ?? '';
    return agents
      .filter((a) => a.id.startsWith(frag))
      .map((a) => `/${parsed.name} ${a.id}`)
      .slice(0, 6);
  }

  // Role completion for spawn.
  if (parsed && parsed.name === 'spawn' && parsed.args.includes('--role')) {
    const frag = getFlag(parsed.args, '--role') ?? '';
    return AGENT_ROLES.filter((r) => r.startsWith(frag)).map(
      (r) => input.replace(/--role\s+\S*$/, `--role ${r}`)
    );
  }

  if (!parsed) return Object.keys(COMMANDS).map((n) => `/${n}`);
  return [];
}
