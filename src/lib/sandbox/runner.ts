// Sandboxed step runner — executes a single vetted ToolCall and streams
// structured output rows into `logs` (task_id set) so the LiveTerminal renders
// tool activity in real time. Never throws; every path returns a StepResult
// and logs it.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { getAdminClient } from '@/lib/supabase/admin';
import { confinePath, vetCommand, scrubbedEnv, sandboxRoot } from '@/lib/sandbox/policy';
import type { ToolCall } from '@/lib/sandbox/parser';
import type { LogLevel } from '@/lib/types/database.types';

const MAX_OUTPUT = 8_000; // chars persisted per stream
const CMD_TIMEOUT_MS = 30_000;

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

export async function executeStep(taskId: string, call: ToolCall): Promise<StepResult> {
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
  }
}

export const MAX_STEPS_PER_TASK = 8;

/** Execute a batch of parsed calls in order, bounded, collecting results. */
export async function executeToolCalls(taskId: string, calls: ToolCall[]): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const call of calls.slice(0, MAX_STEPS_PER_TASK)) {
    results.push(await executeStep(taskId, call));
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
