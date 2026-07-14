// Autonomous Loop Engine — the human-gated sprint runner.
//
// Runs as a supervised sibling of server.mjs/watcher.mjs on the persistent
// Render host (see Dockerfile CMD). One non-negotiable rule, enforced
// structurally: the ONLY code path that spawns a `claude`/`codex` process is
// the approved-gate branch of the /gate-decision handler — no timers, no
// auto-continue, no default-approve. Grok (metered API, no subscription-
// account risk) reviews every finished sprint ungated, and its rubric is
// written into the manifest BEFORE the gate message is composed.
//
// State machine (sprint_loops table, forward-only through gates):
//   IDLE → AWAITING_APPROVAL(launch-claude) → CLAUDE_RUNNING
//        → AWAITING_APPROVAL(launch-codex)  → CODEX_RUNNING
//        → AWAITING_APPROVAL(complete-task) → DONE
//   ABORTED / ERROR reachable from anywhere; both terminal.
//   ERROR = engine/CLI failed unexpectedly. ABORTED = human or E-STOP.
//
// Account-safety boundary: this process never reads, stores, or proxies a
// CLI credential. The CLIs are already authenticated via their own login
// state under CLAUDE_CONFIG_DIR / CODEX_HOME on the persistent disk; a
// not-logged-in CLI fails loud here with an actionable message.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   TELEGRAM_BOT_TOKEN, TELEGRAM_OPERATOR_CHAT_ID.
// Optional env: OPENROUTER_API_KEY (Grok review; fail-open without it),
//   ENGINE_PORT (7910), SPRINT_REPO_URL, SPRINT_REPO_DIR, SPRINT_ROOT,
//   SPRINT_TIMEOUT_MS (default 1h), TELEGRAM_API_BASE (test override).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  newShortId,
  buildClaudeArgs,
  buildCodexArgs,
  classifyExit,
  sprintPrompt,
  composeGateMessage,
} from './sprint-utils.mjs';

// ── Config ──────────────────────────────────────────────────────────────
const SB_URL = process.env.SUPABASE_URL?.trim()?.replace(/\/+$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN?.trim();
const OPERATOR_CHAT = process.env.TELEGRAM_OPERATOR_CHAT_ID?.trim();
const TG_BASE = (process.env.TELEGRAM_API_BASE?.trim() || 'https://api.telegram.org').replace(/\/+$/, '');
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY?.trim() || null;
const ENGINE_PORT = Number(process.env.ENGINE_PORT ?? 7910);
const REPO_URL = process.env.SPRINT_REPO_URL?.trim() || 'https://github.com/ik4ko/my-agent-factory.git';
const REPO_DIR = process.env.SPRINT_REPO_DIR?.trim() || '/var/data/repo';
const SPRINT_ROOT = process.env.SPRINT_ROOT?.trim() || '/var/data/sprint-workspace';
const SPRINT_TIMEOUT_MS = Number(process.env.SPRINT_TIMEOUT_MS ?? 3_600_000);
// npm ci opt-out for memory-constrained hosts: a fresh install peaks ~1.9GB
// (measured) — guaranteed OOM on the 512MB Starter plan. When 'false', the
// workspace is code-only; a sprint whose DoD needs tests must install deps
// itself (and will hit the same OOM-classified wall, reported plainly).
const INSTALL_DEPS = (process.env.SPRINT_INSTALL_DEPS ?? 'true') !== 'false';
const ESTOP_POLL_MS = 3_000;
const IDLE_POLL_MS = 5_000;
const KILL_GRACE_MS = 10_000;

for (const [name, v] of [
  ['SUPABASE_URL', SB_URL],
  ['SUPABASE_SERVICE_ROLE_KEY', SB_KEY],
  ['TELEGRAM_BOT_TOKEN', BOT_TOKEN],
  ['TELEGRAM_OPERATOR_CHAT_ID', OPERATOR_CHAT],
]) {
  if (!v) {
    console.error(`[engine] ${name} is not set — refusing to start`);
    process.exit(1);
  }
}

// ── Supabase (PostgREST over fetch — this process stays dependency-free) ──
async function sb(pathAndQuery, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(`postgrest ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.pgCode = json?.code ?? null;
    throw err;
  }
  return json;
}

/** CAS state transition — succeeds only from the expected current state
 *  (and gate, when given). Returns the updated row or null on conflict,
 *  mirroring action-order's pending-predicate update. */
async function casTransition(id, expect, patch) {
  const preds = [`id=eq.${id}`, `state=eq.${expect.state}`];
  if (expect.gateId) preds.push(`gate_id=eq.${expect.gateId}`);
  const rows = await sb(`sprint_loops?${preds.join('&')}`, {
    method: 'PATCH',
    body: { ...patch, updated_at: new Date().toISOString() },
    prefer: 'return=representation',
  });
  return rows?.[0] ?? null;
}

/** Fire-and-forget mirror into the Global Chat overlay's feed (the logs
 *  table the dashboard already streams) — never blocks or fails the engine. */
function mirrorToChat(level, message) {
  sb('logs', { method: 'POST', body: { level, message: `[SPRINT] ${message}` } }).catch(() => {});
}

// ── Telegram (operator chat ONLY — id comes from env, never from input) ──
async function tgSend(text, replyMarkup) {
  try {
    const res = await fetch(`${TG_BASE}/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: OPERATOR_CHAT,
        text,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) console.error(`[engine] sendMessage failed: ${res.status} ${JSON.stringify(data)?.slice(0, 160)}`);
    return data?.result ?? null;
  } catch (err) {
    console.error(`[engine] sendMessage error: ${String(err).slice(0, 160)}`);
    return null;
  }
}

// ── Manifest (§3 — single source of truth, file first, DB mirror second) ──
function workspaceDir(taskId) {
  return path.join(SPRINT_ROOT, taskId);
}

function manifestPath(taskId) {
  return path.join(workspaceDir(taskId), 'manifest.json');
}

function readManifest(taskId) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(taskId), 'utf8'));
  } catch {
    return null;
  }
}

async function writeManifest(loop, manifest) {
  manifest.updated_at = new Date().toISOString();
  const dir = workspaceDir(loop.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(manifestPath(loop.id), JSON.stringify(manifest, null, 2));
  // summary.md is DERIVED from the manifest — never hand-authored (§3).
  fs.writeFileSync(path.join(dir, 'summary.md'), `# Sprint ${loop.id}\n\n${composeGateMessage(manifest)}\n`);
  await sb(`sprint_loops?id=eq.${loop.id}`, {
    method: 'PATCH',
    body: { manifest, updated_at: new Date().toISOString() },
  }).catch((err) => console.error(`[engine] manifest mirror failed: ${String(err).slice(0, 160)}`));
}

function appendSprintLog(manifest, event) {
  (manifest.sprint_log ??= []).push({ at: new Date().toISOString(), event: String(event).slice(0, 400) });
}

// ── OOM detection (cgroup v2) ───────────────────────────────────────────
// /sys/fs/cgroup/memory.events carries an `oom_kill N` counter for this
// container's cgroup. Read before/after a child runs: a positive delta is a
// DEFINITIVE kernel OOM kill — the graceful-failure path the 512MB Starter
// plan makes a likely recurrence (measured: ~1.9GB npm ci, ~1GB cold tsc).
function oomKillCount() {
  try {
    const txt = fs.readFileSync('/sys/fs/cgroup/memory.events', 'utf8');
    const m = /^oom_kill\s+(\d+)$/m.exec(txt);
    return m ? Number(m[1]) : null;
  } catch {
    return null; // unreadable (non-linux dev box, cgroup v1) → classify falls back
  }
}

// ── Child process management (the hard-won server.mjs pattern) ──────────
// detached:true → child leads its own process group → kill(-pid) reaches the
// whole tree. Unlike server.mjs's 120s age-based reaper (correct there
// because every wrapper call is a short mirror), sprints are long-lived BY
// DESIGN — so nothing here reaps by age; a child is killed only by E-STOP,
// timeout, or its own exit, and `active` tracks exactly which sprint owns it.
let active = null; // { child, loopId, engineKill: null|'estop'|'timeout' }

function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    /* group already gone */
  }
}

function killActive(reason) {
  if (!active) return false;
  active.engineKill = reason;
  killGroup(active.child.pid, 'SIGTERM');
  const pid = active.child.pid;
  setTimeout(() => killGroup(pid, 'SIGKILL'), KILL_GRACE_MS).unref();
  return true;
}

/** Run a command to completion with output capture, timeout, and OOM
 *  classification. Used for git/npm plumbing AND the CLI sprints themselves. */
function run(cmd, args, { cwd, timeoutMs, loopId, onChunk } = {}) {
  return new Promise((resolve) => {
    const oomBefore = oomKillCount();
    const child = spawn(cmd, args, { cwd, detached: true, env: process.env });
    if (loopId) active = { child, loopId, engineKill: null };
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = timeoutMs
      ? setTimeout(() => {
          if (active?.child === child) active.engineKill = 'timeout';
          killGroup(child.pid, 'SIGKILL');
        }, timeoutMs)
      : null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const engineKill = active?.child === child ? active.engineKill : null;
      if (active?.child === child) active = null;
      const oomAfter = oomKillCount();
      const oomDelta = oomBefore === null || oomAfter === null ? null : oomAfter - oomBefore;
      resolve({ ...result, stdout, stderr, exit: classifyExit({ ...result, engineKill, oomDelta }) });
    };

    child.stdout.on('data', (d) => {
      stdout += d.toString();
      if (stdout.length > 2_000_000) stdout = stdout.slice(-1_000_000);
      onChunk?.(d.toString());
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 500_000) stderr = stderr.slice(-250_000);
    });
    child.on('error', (err) => finish({ code: null, signal: null, spawnError: String(err) }));
    child.on('close', (code, signal) => finish({ code, signal }));
  });
}

// ── Workspace (persistent checkout — node_modules survives sprints) ─────
// npm ci runs ONLY on first clone or when package-lock.json's hash changes
// (recorded on the disk), per the Starter-plan design decision: the ~1.9GB
// fresh-install peak is the single most OOM-prone step, so it must not run
// per-sprint.
const LOCKHASH_FILE = path.join(REPO_DIR, '.engine-lockhash');

async function ensureWorkspace(manifest, branch) {
  const log = (e) => appendSprintLog(manifest, e);
  if (!fs.existsSync(path.join(REPO_DIR, '.git'))) {
    log(`cloning ${REPO_URL}`);
    const clone = await run('git', ['clone', REPO_URL, REPO_DIR], { timeoutMs: 600_000 });
    if (clone.exit.kind !== 'ok') throw new Error(`git clone failed: ${clone.exit.detail} ${clone.stderr.slice(-300)}`);
  }
  const git = (args, t = 120_000) => run('git', ['-C', REPO_DIR, ...args], { timeoutMs: t });
  const fetch_ = await git(['fetch', 'origin', 'main'], 300_000);
  if (fetch_.exit.kind !== 'ok') throw new Error(`git fetch failed: ${fetch_.exit.detail}`);
  // Fresh sprint branch off origin/main; clean tracked junk but keep
  // node_modules (clean -fd respects .gitignore; no -x on purpose).
  for (const args of [['checkout', '-B', branch, 'origin/main'], ['reset', '--hard'], ['clean', '-fd']]) {
    const r = await git(args);
    if (r.exit.kind !== 'ok') throw new Error(`git ${args[0]} failed: ${r.exit.detail}`);
  }
  log(`workspace on branch ${branch} @ origin/main`);

  if (!INSTALL_DEPS) {
    log('deps install disabled (SPRINT_INSTALL_DEPS=false) — code-only workspace');
    return;
  }
  const lock = fs.readFileSync(path.join(REPO_DIR, 'package-lock.json'));
  const hash = createHash('sha256').update(lock).digest('hex');
  const prev = fs.existsSync(LOCKHASH_FILE) ? fs.readFileSync(LOCKHASH_FILE, 'utf8').trim() : null;
  if (hash !== prev || !fs.existsSync(path.join(REPO_DIR, 'node_modules'))) {
    log('package-lock changed or node_modules missing — running npm ci (OOM-watched)');
    const ci = await run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: REPO_DIR, timeoutMs: 900_000 });
    if (ci.exit.kind === 'oom' || ci.exit.kind === 'oom-suspect') throw new EngineOom(ci.exit.detail);
    if (ci.exit.kind !== 'ok') throw new Error(`npm ci failed: ${ci.exit.detail} ${ci.stderr.slice(-300)}`);
    fs.writeFileSync(LOCKHASH_FILE, hash);
    log('npm ci complete');
  } else {
    log('node_modules reused (lockfile unchanged)');
  }
}

class EngineOom extends Error {}

async function collectDiff(baseSha, taskId) {
  const git = (args) => run('git', ['-C', REPO_DIR, ...args], { timeoutMs: 60_000 });
  const stat = await git(['diff', '--shortstat', baseSha]);
  const names = await git(['diff', '--name-only', baseSha]);
  const patch = await git(['diff', baseSha]);
  // The actual patch rides in the manifest (truncated) and on disk in full —
  // the DB mirror is how a remote reviewer sees the real diff, not just stats.
  if (taskId) {
    try {
      fs.writeFileSync(path.join(workspaceDir(taskId), 'diff.patch'), patch.stdout);
    } catch { /* disk write is best-effort; the manifest copy still lands */ }
  }
  const m = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(stat.stdout) ?? [];
  return {
    files_changed: Number(m[1] ?? 0),
    insertions: Number(m[2] ?? 0),
    deletions: Number(m[3] ?? 0),
    file_list: names.stdout.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 200),
    patch: patch.stdout.slice(0, 20_000),
  };
}

// ── Grok review (§4 — ungated, metered API, fail-open) ──────────────────
async function grokReview(manifest, baseSha) {
  if (!OPENROUTER_KEY) return null;
  try {
    const diff = await run('git', ['-C', REPO_DIR, 'diff', baseSha], { timeoutMs: 60_000 });
    const body = {
      model: 'x-ai/grok-4.3',
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content:
            'You are an automated pre-approval reviewer. Review the diff against the definition of done. Reply ONLY with JSON: {"rubric":{"correctness":"pass|fail|flag","security":"pass|fail|flag","test_coverage":"pass|fail|flag","style":"pass|fail|flag"},"notes":"<=60 words","flagged_for_review":["item", ...]}',
        },
        {
          role: 'user',
          content: `OBJECTIVE: ${manifest.sprint.objective}\nDEFINITION OF DONE:\n${(manifest.sprint.definition_of_done ?? []).join('\n')}\n\nSPRINT SUMMARY: ${manifest.summary}\n\nDIFF (may be truncated):\n${diff.stdout.slice(0, 60_000)}`,
        },
      ],
    };
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    return {
      reviewer: 'grok',
      reviewed_at: new Date().toISOString(),
      rubric: parsed.rubric,
      notes: parsed.notes ?? null,
      flagged: Array.isArray(parsed.flagged_for_review) ? parsed.flagged_for_review : [],
    };
  } catch (err) {
    console.error(`[engine] grok review failed (fail-open): ${String(err).slice(0, 160)}`);
    return null; // gate message renders "Grok review unavailable" — §4
  }
}

// ── Gates ────────────────────────────────────────────────────────────────
const GATE_NEXT_PREVIEW = {
  'launch-claude': 'spawn a Claude Code CLI sprint on this objective (subscription account — this tap is the launch authorization)',
  'launch-codex': 'spawn a Codex CLI sprint to independently verify/extend the Claude sprint result (subscription account — this tap is the launch authorization)',
  'complete-task': 'mark the task DONE — no further CLI launches',
};

async function openGate(loop, manifest, gateKind, fromState) {
  const gateId = newShortId();
  manifest.next_step_preview = GATE_NEXT_PREVIEW[gateKind];
  manifest.state = 'AWAITING_APPROVAL';
  manifest.approval = { gate_id: gateId, requested_at: new Date().toISOString(), decided_at: null, decided_by: null, decision: null };
  const row = await casTransition(loop.id, { state: fromState }, {
    state: 'AWAITING_APPROVAL',
    gate_id: gateId,
    gate_kind: gateKind,
  });
  if (!row) throw new Error(`gate open CAS conflict (expected ${fromState})`);
  await writeManifest(loop, manifest);
  const kb = {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `g:${loop.short_code}:${gateId}:a` },
      { text: '⛔ Abort', callback_data: `g:${loop.short_code}:${gateId}:x` },
    ]],
  };
  await tgSend(composeGateMessage(manifest), kb);
  mirrorToChat('info', `gate ${gateKind} open for ${loop.short_code} (${manifest.sprint?.objective?.slice(0, 80) ?? ''})`);
}

// ── Sprint execution ─────────────────────────────────────────────────────
async function runSprint(loop, agentKind) {
  const runningState = agentKind === 'claude-code' ? 'CLAUDE_RUNNING' : 'CODEX_RUNNING';
  const manifest = readManifest(loop.id) ?? {
    task_id: loop.id,
    loop_id: loop.id,
    created_at: new Date().toISOString(),
    sprint_log: [],
  };
  const prevSummary = manifest.summary ?? null;
  manifest.state = runningState;
  manifest.sprint = {
    agent: agentKind,
    objective: loop.objective,
    definition_of_done: loop.definition_of_done ?? [],
    started_at: new Date().toISOString(),
    ended_at: null,
  };
  appendSprintLog(manifest, `${agentKind} sprint starting`);
  await writeManifest(loop, manifest);
  mirrorToChat('info', `${agentKind} sprint started for ${loop.short_code}`);

  try {
    const branch = `sprint/${loop.short_code}`;
    await ensureWorkspace(manifest, branch);
    const base = await run('git', ['-C', REPO_DIR, 'rev-parse', 'HEAD'], { timeoutMs: 30_000 });
    const baseSha = base.stdout.trim();
    await writeManifest(loop, manifest);

    const prompt = sprintPrompt({
      agentName: agentKind === 'claude-code' ? 'Claude Code' : 'Codex',
      objective: loop.objective,
      definitionOfDone: loop.definition_of_done ?? [],
      extraContext: agentKind === 'codex' && prevSummary ? prevSummary : null,
    });

    const lastMsgFile = path.join(workspaceDir(loop.id), 'codex-last-message.txt');
    const [cmd, args] =
      agentKind === 'claude-code'
        ? ['claude', buildClaudeArgs(prompt)]
        : ['codex', buildCodexArgs(prompt, REPO_DIR, lastMsgFile)];

    appendSprintLog(manifest, `spawning ${cmd} (timeout ${Math.round(SPRINT_TIMEOUT_MS / 60000)}m)`);
    await writeManifest(loop, manifest);

    let lastFlush = 0;
    const result = await run(cmd, args, {
      cwd: REPO_DIR,
      timeoutMs: SPRINT_TIMEOUT_MS,
      loopId: loop.id,
      onChunk: (chunk) => {
        // Continuous sprint log (§2): append + flush at most every 15s so a
        // crash mid-sprint leaves a resumable record, not a lost thread.
        appendSprintLog(manifest, chunk.slice(0, 300));
        const now = Date.now();
        if (now - lastFlush > 15_000) {
          lastFlush = now;
          writeManifest(loop, manifest).catch(() => {});
        }
      },
    });

    manifest.sprint.ended_at = new Date().toISOString();
    fs.writeFileSync(path.join(workspaceDir(loop.id), `${agentKind}-stdout.log`), result.stdout);

    if (result.exit.kind !== 'ok') {
      if (result.exit.kind === 'estop') return; // estop handler owns the ABORTED transition
      const isOom = result.exit.kind === 'oom' || result.exit.kind === 'oom-suspect';
      // Not-logged-in shows up as a plain error exit — make it actionable.
      const authHint = /log ?in|authenticat|credential/i.test(result.stderr + result.stdout)
        ? ' (CLI output mentions authentication — the host login may be missing/expired; re-run the login runbook)'
        : '';
      const msg = isOom ? result.exit.detail : `${agentKind} sprint failed: ${result.exit.detail}${authHint}`;
      appendSprintLog(manifest, msg);
      manifest.state = 'ERROR';
      await writeManifest(loop, manifest);
      await casTransition(loop.id, { state: runningState }, { state: 'ERROR', error: msg, gate_id: null, gate_kind: null });
      await tgSend(`🛑 ${loop.short_code}: ${msg}`);
      mirrorToChat('error', `${loop.short_code}: ${msg}`);
      return;
    }

    // Extract the CLI's own summary. claude -p --output-format json → single
    // JSON object with a `result` string; codex → -o last-message file.
    let summary = '';
    if (agentKind === 'claude-code') {
      try {
        summary = String(JSON.parse(result.stdout).result ?? '').slice(-1500);
      } catch {
        summary = result.stdout.slice(-1500);
      }
    } else {
      try {
        summary = fs.readFileSync(lastMsgFile, 'utf8').slice(-1500);
      } catch {
        summary = result.stdout.slice(-1500);
      }
    }
    manifest.summary = summary;
    manifest.diff = await collectDiff(baseSha, loop.id);
    manifest.tests = manifest.tests ?? { passed: 0, failed: 0, skipped: 0, typecheck: 'not_run' };
    appendSprintLog(manifest, `${agentKind} sprint finished ok · ${manifest.diff.files_changed} file(s) changed`);
    await writeManifest(loop, manifest);

    // §4 — Grok reviews BEFORE the gate message is composed. Fail-open on
    // review failure, fail-loud in the message when the rubric is missing.
    const review = await grokReview(manifest, baseSha);
    if (review) {
      manifest.review = { reviewer: review.reviewer, reviewed_at: review.reviewed_at, rubric: review.rubric, notes: review.notes };
      manifest.flagged_for_review = review.flagged;
    } else {
      manifest.review = { reviewer: 'grok', reviewed_at: null, rubric: null, notes: null };
    }

    const nextGate = agentKind === 'claude-code' ? 'launch-codex' : 'complete-task';
    await openGate(loop, manifest, nextGate, runningState);
  } catch (err) {
    const isOom = err instanceof EngineOom;
    const msg = isOom ? err.message : `sprint infrastructure failed: ${String(err).slice(0, 300)}`;
    appendSprintLog(manifest, msg);
    manifest.state = 'ERROR';
    await writeManifest(loop, manifest).catch(() => {});
    await casTransition(loop.id, { state: runningState }, { state: 'ERROR', error: msg, gate_id: null, gate_kind: null }).catch(() => {});
    await tgSend(`🛑 ${loop.short_code}: ${msg}`);
    mirrorToChat('error', `${loop.short_code}: ${msg}`);
  }
}

// ── Gate decision endpoint (127.0.0.1 only — the watcher is the sole caller,
//    after its own double allowlist check) ────────────────────────────────
async function handleGateDecision(payload) {
  const { shortCode, gateId, decision, dedupeKey, decidedBy } = payload ?? {};
  if (!/^[0-9a-f]{8}$/.test(shortCode ?? '') || !/^[0-9a-f]{8}$/.test(gateId ?? '') || !['approved', 'denied'].includes(decision)) {
    return { status: 400, body: { ok: false, message: 'malformed gate decision' } };
  }

  // Dedupe claim BEFORE any state change — same system_bus unique-index claim
  // action-order proved live (redelivery → 23505 → explicit rejection).
  if (dedupeKey) {
    try {
      await sb('system_bus', {
        method: 'POST',
        body: {
          topic: 'operator.telegram.update',
          agent: 'sprint-engine',
          payload: { update_id: String(dedupeKey), action: decision, gate_id: gateId, loop: shortCode, source: 'telegram-callback' },
          status: 'consumed',
          consumed_at: new Date().toISOString(),
        },
      });
    } catch (err) {
      if (err.pgCode === '23505' || err.status === 409) {
        return { status: 409, body: { ok: false, deduped: true, message: 'duplicate delivery — already processed (no change)' } };
      }
      return { status: 500, body: { ok: false, message: `dedupe claim failed: ${String(err).slice(0, 120)}` } };
    }
  }

  const rows = await sb(`sprint_loops?short_code=eq.${shortCode}&limit=1`);
  const loop = rows?.[0];
  if (!loop) return { status: 404, body: { ok: false, message: `no sprint loop ${shortCode}` } };

  // CAS: only decide a gate that is still open — a stale/replayed callback
  // gets a clear rejection, never a silent drop, never a re-trigger (§5).
  if (decision === 'denied') {
    const row = await casTransition(loop.id, { state: 'AWAITING_APPROVAL', gateId }, {
      state: 'ABORTED',
      gate_id: null,
      gate_kind: null,
      decided_by: String(decidedBy ?? ''),
    });
    if (!row) return { status: 409, body: { ok: false, message: 'stale gate — already decided or not awaiting approval' } };
    const manifest = readManifest(loop.id);
    if (manifest) {
      manifest.state = 'ABORTED';
      if (manifest.approval) Object.assign(manifest.approval, { decided_at: new Date().toISOString(), decided_by: String(decidedBy ?? ''), decision: 'denied' });
      appendSprintLog(manifest, 'gate DENIED by operator — pipeline stopped, nothing launched');
      await writeManifest({ id: loop.id, short_code: loop.short_code }, manifest);
    }
    mirrorToChat('warn', `${shortCode} ABORTED at gate by operator`);
    return { status: 200, body: { ok: true, message: `⛔ aborted — ${shortCode} stopped, no CLI launched` } };
  }

  const target = { 'launch-claude': 'CLAUDE_RUNNING', 'launch-codex': 'CODEX_RUNNING', 'complete-task': 'DONE' }[loop.gate_kind];
  if (!target) return { status: 500, body: { ok: false, message: `unknown gate kind ${loop.gate_kind}` } };
  const row = await casTransition(loop.id, { state: 'AWAITING_APPROVAL', gateId }, {
    state: target,
    gate_id: null,
    gate_kind: null,
    decided_by: String(decidedBy ?? ''),
    ...(target === 'CLAUDE_RUNNING' || target === 'CODEX_RUNNING' ? { agent: target === 'CLAUDE_RUNNING' ? 'claude-code' : 'codex' } : {}),
  });
  if (!row) return { status: 409, body: { ok: false, message: 'stale gate — already decided or not awaiting approval' } };

  const manifest = readManifest(loop.id);
  if (manifest?.approval) {
    Object.assign(manifest.approval, { decided_at: new Date().toISOString(), decided_by: String(decidedBy ?? ''), decision: 'approved' });
    await writeManifest({ id: loop.id, short_code: loop.short_code }, manifest).catch(() => {});
  }

  if (target === 'DONE') {
    mirrorToChat('success', `${shortCode} DONE`);
    return { status: 200, body: { ok: true, message: `✅ ${shortCode} marked DONE` } };
  }

  // One approval, one launch (§1): this is the only spawn site, and it runs
  // strictly after the CAS above proved this exact gate was open.
  runSprint(row, row.agent).catch((err) => console.error(`[engine] runSprint crashed: ${String(err).slice(0, 300)}`));
  mirrorToChat('info', `${shortCode} gate approved → ${row.agent} sprint launching`);
  return { status: 200, body: { ok: true, message: `✅ approved — ${row.agent} sprint launching for ${shortCode}` } };
}

async function handleCreateTask(payload) {
  const objective = String(payload?.objective ?? '').trim();
  const dod = Array.isArray(payload?.definitionOfDone) ? payload.definitionOfDone.map(String).filter(Boolean) : [];
  if (!objective || objective.length > 2000) return { status: 400, body: { ok: false, message: 'objective required (≤2000 chars)' } };
  if (dod.length === 0) return { status: 400, body: { ok: false, message: 'definition of done required (human-authored per task)' } };
  const rows = await sb('sprint_loops', {
    method: 'POST',
    body: { objective, definition_of_done: dod, state: 'IDLE' },
    prefer: 'return=representation',
  });
  const loop = rows[0];
  mirrorToChat('info', `task created ${loop.short_code}: ${objective.slice(0, 100)}`);
  return { status: 200, body: { ok: true, shortCode: loop.short_code, message: `task ${loop.short_code} created — launch gate will follow` } };
}

// ── Pollers ──────────────────────────────────────────────────────────────
/** IDLE rows get their first gate (launch-claude). Composing a gate is not a
 *  launch — the CLI still cannot start without the human tap. */
async function pollIdle() {
  try {
    const rows = await sb(`sprint_loops?state=eq.IDLE&order=created_at.asc&limit=1`);
    const loop = rows?.[0];
    if (!loop) return;
    const manifest = {
      task_id: loop.id,
      loop_id: loop.id,
      created_at: new Date().toISOString(),
      state: 'IDLE',
      sprint: { agent: null, objective: loop.objective, definition_of_done: loop.definition_of_done, started_at: null, ended_at: null },
      diff: { files_changed: 0, insertions: 0, deletions: 0, file_list: [] },
      tests: { passed: 0, failed: 0, skipped: 0, typecheck: 'not_run' },
      summary: 'No sprint has run yet — this gate authorizes the FIRST Claude Code launch.',
      sprint_log: [],
    };
    await openGate(loop, manifest, 'launch-claude', 'IDLE');
  } catch (err) {
    console.error(`[engine] idle poll error: ${String(err).slice(0, 160)}`);
  }
}

/** E-STOP (§1): the Vercel route flips a system_bus flag; this host performs
 *  the actual process-group kill and marks every non-terminal loop ABORTED. */
async function pollEstop() {
  try {
    const rows = await sb(`system_bus?topic=eq.control.estop&status=eq.pending&limit=10`);
    if (!rows?.length) return;
    const killed = killActive('estop');
    const open = await sb(`sprint_loops?state=in.(IDLE,CLAUDE_RUNNING,AWAITING_APPROVAL,CODEX_RUNNING)`);
    for (const loop of open ?? []) {
      await sb(`sprint_loops?id=eq.${loop.id}`, {
        method: 'PATCH',
        body: { state: 'ABORTED', gate_id: null, gate_kind: null, error: 'E-STOP', updated_at: new Date().toISOString() },
      });
      const manifest = readManifest(loop.id);
      if (manifest) {
        manifest.state = 'ABORTED';
        appendSprintLog(manifest, 'E-STOP — engine killed the sprint process group and aborted the loop');
        await writeManifest(loop, manifest).catch(() => {});
      }
    }
    for (const r of rows) {
      await sb(`system_bus?id=eq.${r.id}`, { method: 'PATCH', body: { status: 'consumed', consumed_at: new Date().toISOString() } });
    }
    await tgSend(`🛑 E-STOP executed on sprint engine — ${killed ? 'active sprint process group killed, ' : 'no process was running, '}${open?.length ?? 0} loop(s) → ABORTED`);
    mirrorToChat('error', `E-STOP — ${open?.length ?? 0} loop(s) aborted${killed ? ', process tree killed' : ''}`);
  } catch (err) {
    console.error(`[engine] estop poll error: ${String(err).slice(0, 160)}`);
  }
}

/** §2 — a restarted engine recovers state from persistence, never resets.
 *  RUNNING rows whose process died with the old container are honestly ERROR
 *  (the CLI session may be resumable later — the log + session live on disk);
 *  AWAITING_APPROVAL rows just keep their open gate. */
async function recoverOnBoot() {
  const rows = await sb(`sprint_loops?state=in.(CLAUDE_RUNNING,CODEX_RUNNING)`);
  for (const loop of rows ?? []) {
    const msg = 'engine restarted mid-sprint — the sprint process did not survive; sprint log preserved in workspace (CLI session may be resumable)';
    await sb(`sprint_loops?id=eq.${loop.id}`, {
      method: 'PATCH',
      body: { state: 'ERROR', error: msg, gate_id: null, gate_kind: null, updated_at: new Date().toISOString() },
    });
    const manifest = readManifest(loop.id);
    if (manifest) {
      manifest.state = 'ERROR';
      appendSprintLog(manifest, msg);
      await writeManifest(loop, manifest).catch(() => {});
    }
    await tgSend(`🛑 ${loop.short_code}: ${msg}`);
  }
  const waiting = await sb(`sprint_loops?state=eq.AWAITING_APPROVAL&select=short_code`);
  if (waiting?.length) console.log(`[engine] ${waiting.length} gate(s) still open from before restart: ${waiting.map((w) => w.short_code).join(', ')}`);
}

// ── HTTP server (loopback only) ──────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return send(200, { ok: true, activeSprint: active?.loopId ?? null });
    }
    if (req.method !== 'POST') return send(404, { ok: false });
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 20_000) req.destroy(new Error('body too large'));
    });
    await new Promise((r, j) => (req.on('end', r), req.on('error', j)));
    const payload = JSON.parse(raw || '{}');
    if (req.url === '/gate-decision') {
      const { status, body } = await handleGateDecision(payload);
      return send(status, body);
    }
    if (req.url === '/task') {
      const { status, body } = await handleCreateTask(payload);
      return send(status, body);
    }
    return send(404, { ok: false });
  } catch (err) {
    return send(500, { ok: false, message: String(err).slice(0, 200) });
  }
});

// ── Boot ─────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(SPRINT_ROOT, { recursive: true });
  await recoverOnBoot().catch((err) => console.error(`[engine] recovery error: ${String(err).slice(0, 200)}`));
  server.listen(ENGINE_PORT, '127.0.0.1', () => {
    console.log(`[engine] sprint engine online · loopback :${ENGINE_PORT} · repo=${REPO_URL}`);
  });
  setInterval(pollEstop, ESTOP_POLL_MS);
  setInterval(pollIdle, IDLE_POLL_MS);
  await tgSend('sprint engine online — /sprint <objective> | done: <cond>; <cond> to create a gated task');
}

process.on('SIGTERM', () => {
  // The container is going down (redeploy/restart) — kill any sprint tree so
  // nothing orphans; recovery marks the row ERROR on next boot.
  if (active) killGroup(active.child.pid, 'SIGKILL');
  process.exit(0);
});

main();
