// Sandboxed step runner — executes a single vetted ToolCall and streams
// structured output rows into `logs` (task_id set). Never throws; every path
// returns a StepResult and logs it.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { getAdminClient } from '@/lib/supabase/admin';
import {
  confinePath,
  vetCommand,
  scrubbedEnv,
  sandboxRoot,
  vetUrl,
  checkWebFetchRateLimit,
  ALLOWED_WEB_CONTENT_TYPES,
} from '@/lib/sandbox/policy';
import { safeFetch } from '@/lib/sandbox/safe-fetch';
import type { ToolCall } from '@/lib/sandbox/parser';
import type { LogLevel } from '@/lib/types/database.types';
import type { RoomScope } from '@/lib/rooms/scope';

const MAX_OUTPUT = 8_000; // chars persisted per stream
const CMD_TIMEOUT_MS = 30_000;
const WEB_FETCH_TIMEOUT_MS = 10_000;
const WEB_FETCH_MAX_BYTES = 500_000;

export interface StepResult {
  tool: ToolCall['tool'];
  ok: boolean;
  summary: string;
  stdout?: string;
  stderr?: string;
  content?: string;
  exitCode?: number;
}

function clip(s: string): string {
  return s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n…[truncated ${s.length - MAX_OUTPUT} chars]` : s;
}

async function log(taskId: string, level: LogLevel, message: string, metadata?: Record<string, unknown>) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = getAdminClient() as any;
    await db.from('logs').insert({
      level,
      message: `[SANDBOX] ${message}`,
      task_id: taskId,
      metadata: metadata ?? null,
      timestamp: new Date().toISOString(),
    });
  } catch {
    /* logging must never crash the runner */
  }
}

function runCommand(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: sandboxRoot(),
      env: scrubbedEnv(),
      shell: false, // no shell — argv is passed literally
      timeout: CMD_TIMEOUT_MS,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      if (stdout.length < MAX_OUTPUT * 2) stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      if (stderr.length < MAX_OUTPUT * 2) stderr += d.toString();
    });
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: `${stderr}\n${err.message}` }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export async function executeStep(
  taskId: string,
  call: ToolCall,
  rateLimitKey = 'unscoped',
  roomScope: RoomScope = 'all'
): Promise<StepResult> {
  switch (call.tool) {
    case 'view_file': {
      const check = confinePath(call.path, true);
      if (!check.ok) {
        await log(taskId, 'error', `view_file DENIED ${call.path}: ${check.reason}`);
        return { tool: 'view_file', ok: false, summary: `denied: ${check.reason}` };
      }
      try {
        const content = clip(await fs.readFile(check.resolved!, 'utf8'));
        await log(taskId, 'info', `view_file ${call.path} (${content.length} chars)`, { path: call.path });
        return { tool: 'view_file', ok: true, summary: `read ${call.path}`, content };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await log(taskId, 'error', `view_file FAILED ${call.path}: ${msg}`);
        return { tool: 'view_file', ok: false, summary: msg };
      }
    }

    case 'write_file': {
      const check = confinePath(call.path, false);
      if (!check.ok) {
        await log(taskId, 'error', `write_file DENIED ${call.path}: ${check.reason}`);
        return { tool: 'write_file', ok: false, summary: `denied: ${check.reason}` };
      }
      try {
        const dir = check.resolved!.slice(0, check.resolved!.lastIndexOf('/'));
        if (dir) await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(check.resolved!, call.content, 'utf8');
        await log(taskId, 'success', `write_file ${call.path} (${call.content.length} bytes)`, { path: call.path });
        return { tool: 'write_file', ok: true, summary: `wrote ${call.path} (${call.content.length} bytes)` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await log(taskId, 'error', `write_file FAILED ${call.path}: ${msg}`);
        return { tool: 'write_file', ok: false, summary: msg };
      }
    }

    case 'execute_command': {
      const vet = vetCommand(call.command);
      if (!vet.ok) {
        await log(taskId, 'error', `execute_command DENIED "${call.command}": ${vet.reason}`);
        return { tool: 'execute_command', ok: false, summary: `denied: ${vet.reason}` };
      }
      await log(taskId, 'info', `execute_command ▶ ${vet.argv!.join(' ')}`);
      const { code, stdout, stderr } = await runCommand(vet.argv!);
      const ok = code === 0;
      await log(taskId, ok ? 'success' : 'error', `execute_command exit=${code} ${vet.argv!.join(' ')}`, {
        exitCode: code,
        stdout: clip(stdout),
        stderr: clip(stderr),
      });
      return {
        tool: 'execute_command',
        ok,
        summary: `${vet.argv!.join(' ')} → exit ${code}`,
        stdout: clip(stdout),
        stderr: clip(stderr),
        exitCode: code,
      };
    }

    case 'web_fetch': {
      const check = vetUrl(call.url, roomScope);
      if (!check.ok) {
        await log(taskId, 'error', `web_fetch DENIED ${call.url}: ${check.reason}`);
        return { tool: 'web_fetch', ok: false, summary: `denied: ${check.reason}` };
      }
      const limit = checkWebFetchRateLimit(rateLimitKey);
      if (!limit.ok) {
        await log(taskId, 'error', `web_fetch DENIED ${call.url}: ${limit.reason}`);
        return { tool: 'web_fetch', ok: false, summary: `denied: ${limit.reason}` };
      }
      try {
        // safeFetch (not global fetch): validates the resolved IP at actual
        // connect time (DNS-rebinding-safe), never follows redirects, and
        // enforces the size cap during transfer rather than after.
        const result = await safeFetch(check.url!, {
          timeoutMs: WEB_FETCH_TIMEOUT_MS,
          maxBytes: WEB_FETCH_MAX_BYTES,
          userAgent: 'AgentFactory-Sandbox/1.0 (read-only tool)',
          allowedContentTypes: ALLOWED_WEB_CONTENT_TYPES,
        });
        if (result.refusedReason) {
          await log(taskId, 'error', `web_fetch DENIED ${call.url}: ${result.refusedReason}`);
          return { tool: 'web_fetch', ok: false, summary: `denied: ${result.refusedReason}` };
        }
        if (result.status >= 300 && result.status < 400) {
          // Never followed — report it and let the caller re-request the
          // target explicitly (through the same allowlist + DNS check).
          await log(taskId, 'error', `web_fetch ${call.url} → ${result.status} redirect (not followed)`, { url: call.url, status: result.status });
          return { tool: 'web_fetch', ok: false, summary: `${call.url} → ${result.status} redirect (not followed)` };
        }
        const content = clip(result.body) + (result.truncated ? `\n…[truncated at ${WEB_FETCH_MAX_BYTES} bytes]` : '');
        const ok = result.status >= 200 && result.status < 300;
        await log(taskId, ok ? 'success' : 'error', `web_fetch ${call.url} → ${result.status}`, { url: call.url, status: result.status, truncated: result.truncated });
        return { tool: 'web_fetch', ok, summary: `${call.url} → ${result.status}`, content };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await log(taskId, 'error', `web_fetch FAILED ${call.url}: ${msg}`);
        return { tool: 'web_fetch', ok: false, summary: msg };
      }
    }
  }
}

export const MAX_STEPS_PER_TASK = 8;

/** Execute a batch of parsed calls in order, bounded, collecting results.
 *  `rateLimitKey` scopes web_fetch's rate limit (per agent by default via
 *  the caller in api/tasks/execute) so one agent's usage can't starve
 *  another's. `roomScope` selects web_fetch's per-room domain allowlist
 *  (see ALLOWED_WEB_DOMAINS_BY_SCOPE in policy.ts). */
export async function executeToolCalls(
  taskId: string,
  calls: ToolCall[],
  rateLimitKey = 'unscoped',
  roomScope: RoomScope = 'all'
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const call of calls.slice(0, MAX_STEPS_PER_TASK)) {
    results.push(await executeStep(taskId, call, rateLimitKey, roomScope));
  }
  if (calls.length > MAX_STEPS_PER_TASK) {
    await log(taskId, 'warn', `step cap: ${calls.length - MAX_STEPS_PER_TASK} tool call(s) skipped (limit ${MAX_STEPS_PER_TASK})`);
  }
  return results;
}

/** Feedback block appended to agent context so it can react to its own outputs. */
export function formatToolResults(results: StepResult[]): string {
  return results
    .map((r) => {
      const head = `[${r.tool}] ${r.ok ? 'OK' : 'FAIL'} — ${r.summary}`;
      const body = r.content ?? [r.stdout, r.stderr].filter(Boolean).join('\n');
      return body ? `${head}\n${body}` : head;
    })
    .join('\n\n');
}
