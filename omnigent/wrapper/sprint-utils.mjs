// Pure helpers for the sprint engine — no I/O, no env reads, fully
// unit-testable (node --test omnigent/wrapper/sprint-utils.test.mjs).
//
// Everything here is deterministic given its inputs; sprint-engine.mjs owns
// all process/network/disk side effects.

import { randomUUID } from 'node:crypto';

/** 8-hex handle for callback_data (Telegram caps callback_data at 64 bytes,
 *  which rules out a pair of uuids — sprint_loops.short_code + gate_id use
 *  these instead). */
export function newShortId() {
  return randomUUID().replaceAll('-', '').slice(0, 8);
}

/** callback_data wire format: `g:<shortCode>:<gateId>:<a|x>` (a=approve,
 *  x=abort). Returns null on anything malformed — the caller must treat null
 *  as "not a gate callback", never guess. */
export function parseCallbackData(data) {
  if (typeof data !== 'string') return null;
  const m = /^g:([0-9a-f]{8}):([0-9a-f]{8}):(a|x)$/.exec(data);
  if (!m) return null;
  return { shortCode: m[1], gateId: m[2], decision: m[3] === 'a' ? 'approved' : 'denied' };
}

export function buildCallbackData(shortCode, gateId, decision) {
  return `g:${shortCode}:${gateId}:${decision === 'approved' ? 'a' : 'x'}`;
}

/**
 * claude CLI invocation — flags verified against the installed claude 2.1.203
 * (`claude --help`, 2026-07-13): -p/--print for non-interactive,
 * --output-format json for a single structured result, --permission-mode
 * acceptEdits so file edits inside the sprint don't prompt (per the spec,
 * in-sprint actions are governed by the CLI's own permission mode, not extra
 * Telegram gates), --allowedTools grants the build/test loop. cwd is set by
 * the spawner to the workspace repo.
 */
export function buildClaudeArgs(prompt) {
  return [
    '-p', prompt,
    '--output-format', 'json',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Bash(git *) Bash(npm *) Bash(npx *) Edit Write Read Glob Grep',
  ];
}

/**
 * codex CLI invocation — flags verified against the installed codex-cli
 * 0.144.3 (`codex exec --help`, 2026-07-13): exec is the non-interactive
 * mode, --json emits JSONL events on stdout, -s workspace-write sandboxes
 * writes to the working root, -C sets that root, -o writes the agent's final
 * message to a file (the reliable way to get the summary without parsing the
 * event stream).
 */
export function buildCodexArgs(prompt, repoDir, lastMessageFile) {
  return [
    'exec',
    '--json',
    '-s', 'workspace-write',
    '-C', repoDir,
    '-o', lastMessageFile,
    prompt,
  ];
}

/**
 * Classify how a sprint child process ended. The engine records WHY it killed
 * a process (engineKill: 'estop' | 'timeout' | null) before signalling, and
 * reads the cgroup oom_kill counter before/after the run (oomDelta; null when
 * the cgroup file is unreadable). This is the OOM-vs-error split the Starter
 * plan makes a real, expected failure mode rather than a hypothetical:
 * measured peaks on this repo are ~1.9GB npm ci / ~1GB cold tsc vs 512MB.
 */
export function classifyExit({ code, signal, engineKill, oomDelta }) {
  if (engineKill === 'estop') return { kind: 'estop', detail: 'killed by E-STOP' };
  if (engineKill === 'timeout') return { kind: 'timeout', detail: 'sprint exceeded its time budget and was killed' };
  const oomKilled = (oomDelta ?? 0) > 0;
  if (oomKilled) {
    return {
      kind: 'oom',
      detail: 'sprint OOM-killed (cgroup oom_kill counter incremented) — consider upscaling the Render plan',
    };
  }
  if (signal === 'SIGKILL' || code === 137) {
    return {
      kind: 'oom-suspect',
      detail:
        'sprint killed by SIGKILL the engine did not send — likely the kernel OOM killer (counter unreadable); consider upscaling the Render plan',
    };
  }
  if (code === 0) return { kind: 'ok', detail: 'exited 0' };
  return { kind: 'error', detail: `exited ${code ?? 'null'}${signal ? ` (signal ${signal})` : ''}` };
}

/**
 * The sprint prompt — §2's macro-batch contract, rendered identically for
 * both CLIs. Self-correction inside scope is the default; scope changes stop
 * the sprint and surface to the gate. The definition of done is human-authored
 * per task (a confirmed product decision — never templated).
 */
export function sprintPrompt({ agentName, objective, definitionOfDone, extraContext }) {
  const dod = (definitionOfDone ?? []).map((c, i) => `${i + 1}. ${c}`).join('\n');
  return [
    `You are running an autonomous coding sprint as ${agentName} inside the my-agent-factory repo (your working directory).`,
    ``,
    `OBJECTIVE: ${objective}`,
    ``,
    `DEFINITION OF DONE — every item must be objectively satisfied before you finish:`,
    dod || '(none provided — treat the objective sentence itself as the checkable goal)',
    ``,
    `RULES:`,
    `- Self-correction is authorized and expected: if a test fails or the build breaks because of your own changes, fix it and continue.`,
    `- STOP WORKING and summarize instead if completing the objective would require any of: adding a new dependency, a database schema change beyond what the objective names, or deleting a file the objective does not explicitly name. Describe what you would have done and why — a human gate decides.`,
    `- Never push, never touch git remotes. Commit locally on the current branch as you go.`,
    `- Do not modify files under omnigent/wrapper/ unless the objective names them.`,
    extraContext ? `\nCONTEXT FROM THE PREVIOUS SPRINT:\n${extraContext}` : null,
    ``,
    `When done, end with a 2-4 sentence summary of what you changed and the state of each definition-of-done item (met / not met / blocked-by-scope).`,
  ].filter((l) => l !== null).join('\n');
}

/**
 * §3/§5 — the Telegram gate message, generated from the manifest ONLY (the
 * markdown summary and the machine data can't drift because both come from
 * this one object). Composed AFTER Grok's review is written into the
 * manifest; a missing rubric renders as an explicit "unavailable" line,
 * never a silent omission.
 */
export function composeGateMessage(manifest) {
  const m = manifest ?? {};
  const s = m.sprint ?? {};
  const d = m.diff ?? {};
  const t = m.tests ?? {};
  const r = m.review ?? {};
  const rubric = r.rubric
    ? `Grok review: correctness=${r.rubric.correctness} security=${r.rubric.security} tests=${r.rubric.test_coverage} style=${r.rubric.style}${r.notes ? `\n  ${String(r.notes).slice(0, 300)}` : ''}`
    : 'Grok review unavailable';
  const flagged = (m.flagged_for_review ?? []).length
    ? `⚑ flagged:\n${m.flagged_for_review.map((f) => `  • ${f}`).join('\n')}`
    : null;
  const lines = [
    `⏳ SPRINT GATE · ${m.task_id ? String(m.task_id).slice(0, 8) : '?'}`,
    `objective: ${s.objective ?? '?'}`,
    s.agent ? `last sprint: ${s.agent}${s.ended_at ? ' (finished)' : ''}` : null,
    `diff: ${d.files_changed ?? 0} file(s), +${d.insertions ?? 0}/-${d.deletions ?? 0}`,
    `tests: ${t.passed ?? 0} pass / ${t.failed ?? 0} fail · typecheck: ${t.typecheck ?? 'not_run'}`,
    m.summary ? `summary: ${m.summary}` : null,
    rubric,
    flagged,
    ``,
    `NEXT IF APPROVED: ${m.next_step_preview ?? '?'}`,
    `Approve to proceed, Abort to stop. Nothing runs without this tap.`,
  ].filter((l) => l !== null);
  return lines.join('\n');
}

/** Parse `/sprint <objective> | done: cond1; cond2` — DoD is mandatory
 *  (human-authored per task). Returns {objective, definitionOfDone} or null. */
export function parseSprintCommand(text) {
  if (typeof text !== 'string') return null;
  const body = text.replace(/^\/sprint(@\S+)?\s*/i, '');
  const parts = body.split('|');
  if (parts.length < 2) return null;
  const objective = parts[0].trim();
  const doneMatch = /^\s*done\s*:\s*(.+)$/is.exec(parts.slice(1).join('|'));
  if (!objective || !doneMatch) return null;
  const definitionOfDone = doneMatch[1].split(';').map((c) => c.trim()).filter(Boolean);
  if (definitionOfDone.length === 0) return null;
  return { objective, definitionOfDone };
}
