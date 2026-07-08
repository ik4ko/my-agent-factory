#!/usr/bin/env node
// Omnigent trigger wrapper — a thin, dependency-free HTTP shim that runs on
// the same persistent host as the Omnigent runner/host (never on Vercel,
// which can't hold the runner's long-lived tunnel connection — see
// docs/omnigent-integration-plan.md §4). Vercel calls this over plain HTTPS
// exactly like any other external API it already calls; this process is the
// only thing that actually shells out to the `omnigent` CLI.
//
// POST /trigger  { harness, prompt, model? }  (Authorization: Bearer <token>)
// GET  /health
//
// No framework — one route, no reason for a dependency here.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const PORT = Number(process.env.WRAPPER_PORT ?? 7900);
// _FILE variant (Docker-secrets convention) reads the token from disk
// instead of the environment — the more robust option for a persistent
// host, and avoids shell env-var propagation entirely.
const AUTH_TOKEN = process.env.WRAPPER_AUTH_TOKEN_FILE
  ? fs.readFileSync(process.env.WRAPPER_AUTH_TOKEN_FILE, 'utf8').trim()
  : process.env.WRAPPER_AUTH_TOKEN;
const OMNIGENT_SERVER_URL = process.env.OMNIGENT_SERVER_URL ?? 'http://127.0.0.1:6767';
const TRIGGER_TIMEOUT_MS = Number(process.env.WRAPPER_TIMEOUT_MS ?? 30_000);
const ALLOWED_HARNESSES = new Set(['openai-agents', 'claude-sdk']);

if (!AUTH_TOKEN) {
  console.error('WRAPPER_AUTH_TOKEN is not set — refusing to start unauthenticated.');
  process.exit(1);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 10_000) req.destroy(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// `omnigent run -p` leaks a tmux server on EVERY invocation — verified
// live, success or failure or timeout: it attaches a tmux-hosted terminal
// view of the conversation as a side effect, and that tmux server (its own
// session leader, via setsid — the exact mechanism tmux uses to survive its
// invoking shell) keeps running indefinitely after the CLI call returns.
// On a persistent host handling many mirror calls, this is an unbounded
// resource leak.
//
// A per-request "snapshot dirs before, diff after" approach was tried first
// and did NOT work reliably — verified live: the tmux server is spawned
// asynchronously by omnigent's own internal orchestration, slightly *after*
// the CLI process this wrapper spawned already exits, so a diff taken right
// at that exit moment can race and miss it. Reaping is done instead as a
// periodic sweep, fully decoupled from any single request's timing: every
// REAP_INTERVAL_MS, kill any `omnigent-terminal-*` tmux server whose
// directory is older than REAP_GRACE_MS. Nothing legitimate in this
// wrapper's flow ever needs one to survive that long (no request ever
// interactively attaches), so this is safe to always sweep.
const REAP_INTERVAL_MS = 10_000;
const REAP_GRACE_MS = 15_000;

function reapLeakedTmuxServers() {
  const dir = os.tmpdir();
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.startsWith('omnigent-terminal-')) continue;
    const full = path.join(dir, entry);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue; // vanished between readdir and stat — fine
    }
    if (now - stat.mtimeMs < REAP_GRACE_MS) continue; // still within grace period
    try {
      spawnSync('tmux', ['-S', path.join(full, 'tmux.sock'), 'kill-server']);
    } catch {
      /* already gone */
    }
  }
}

setInterval(reapLeakedTmuxServers, REAP_INTERVAL_MS).unref();

// Killing the tmux server does NOT kill the `omnigent.runner._entry`
// process behind it — verified live, it's a second, separate leak. There's
// no reliable way from `ps`/cmdline to correlate a specific runner process
// back to a specific HTTP request (no distinguishing argv/env visible), so
// this is a coarser, age-based reap rather than a precise per-request one.
// That's a safe trade-off *for this wrapper specifically*: every call this
// service makes is a short mirror summary (by design — see
// docs/omnigent-integration-plan.md), so any runner process still alive
// past RUNNER_REAP_GRACE_MS is, by definition, orphaned — its owning
// request already completed or was already killed by this wrapper's own
// per-request timeout. This reap would be wrong for a service that issues
// long-running or interactively-attached sessions; it does not.
const RUNNER_REAP_GRACE_MS = 120_000;

// Pure /proc reads, no `ps`/`pgrep` — verified live that this WSL2 image
// doesn't ship them at all (a minimal container image may not either, and
// this way there's nothing extra to remember installing). `/proc/<pid>`'s
// own mtime is set at process start and not touched again, so it doubles
// as a reliable process-age clock without parsing `/proc/<pid>/stat`'s
// clock-ticks-since-boot field.
function reapOrphanedRunners() {
  let pidDirs;
  try {
    pidDirs = fs.readdirSync('/proc').filter((e) => /^\d+$/.test(e));
  } catch {
    return; // /proc unavailable (non-Linux) — nothing to reap
  }
  const now = Date.now();
  for (const pid of pidDirs) {
    let cmdline;
    try {
      cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    } catch {
      continue; // vanished between readdir and read — fine
    }
    if (!cmdline.includes('omnigent.runner._entry')) continue;
    let ageMs;
    try {
      ageMs = now - fs.statSync(`/proc/${pid}`).mtimeMs;
    } catch {
      continue;
    }
    if (ageMs < RUNNER_REAP_GRACE_MS) continue;
    try {
      process.kill(Number(pid), 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

setInterval(reapOrphanedRunners, REAP_INTERVAL_MS).unref();

// Node's built-in spawn({timeout}) only signals the *immediate* child.
// `omnigent run` fans out into a process tree of its own (a local server,
// a runner, a tmux-attached terminal) — a plain SIGTERM to the top process
// can leave the rest orphaned (observed live: a tmux/attach pair from an
// earlier run was still alive 40+ minutes later, waiting on an event that
// never fired). `detached: true` makes the child its own process-group
// leader, so `process.kill(-pid, sig)` reaches the whole tree — except the
// tmux server, which escapes the group on purpose (see above); that's
// reaped separately by the periodic sweep.
function runOmnigent({ harness, prompt, model }) {
  return new Promise((resolve, reject) => {
    const args = ['run', '--harness', harness, '--server', OMNIGENT_SERVER_URL, '-p', prompt];
    if (model) args.push('--model', model);
    const child = spawn('omnigent', args, {
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      detached: true,
    });

    let settled = false;
    let stdout = '';
    let stderr = '';

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL'); // negative pid = whole process group
      } catch {
        /* group already gone */
      }
      finish(new Error(`omnigent run timed out after ${TRIGGER_TIMEOUT_MS}ms — subprocess tree killed`));
    }, TRIGGER_TIMEOUT_MS);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => finish(err));
    child.on('close', (code) => {
      if (code === 0) finish(null, { stdout, stderr });
      else finish(new Error(`omnigent exited ${code}: ${stderr.slice(-500) || stdout.slice(-500)}`));
    });
  });
}

const server = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.method === 'GET' && req.url === '/health') {
    return send(200, { ok: true });
  }

  if (req.method !== 'POST' || req.url !== '/trigger') {
    return send(404, { ok: false, error: 'not found' });
  }

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${AUTH_TOKEN}`) {
    return send(401, { ok: false, error: 'unauthorized' });
  }

  let payload;
  try {
    const raw = await readBody(req);
    payload = JSON.parse(raw);
  } catch (err) {
    return send(400, { ok: false, error: `invalid JSON body: ${err.message}` });
  }

  const { harness, prompt, model } = payload ?? {};
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return send(400, { ok: false, error: 'prompt (string) is required' });
  }
  if (!ALLOWED_HARNESSES.has(harness)) {
    return send(400, { ok: false, error: `harness must be one of: ${[...ALLOWED_HARNESSES].join(', ')}` });
  }

  try {
    const { stdout } = await runOmnigent({ harness, prompt, model });
    send(200, { ok: true, output: stdout.trim().slice(-2000) });
  } catch (err) {
    send(502, { ok: false, error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`omnigent-wrapper listening on :${PORT} → ${OMNIGENT_SERVER_URL}`);
});
