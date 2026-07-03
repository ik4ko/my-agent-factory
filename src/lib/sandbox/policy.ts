// Sandbox security policy — the real boundary. Two hard rules, both allowlist-
// based (denylists for shell execution are unclosable and give false safety):
//
//   1. execute_command: exact-argv allowlist, NO shell interpretation, child
//      env scrubbed of every secret. The app's process.env holds the Supabase
//      service-role key + Anthropic key + dashboard password; nothing the
//      sandbox spawns may see them.
//   2. file ops: resolved path must stay inside SANDBOX_ROOT (realpath-checked
//      so symlinks can't escape).
import path from 'node:path';
import fs from 'node:fs';

export function sandboxRoot(): string {
  const root = process.env.SANDBOX_ROOT || path.join(process.cwd(), '.sandbox');
  fs.mkdirSync(root, { recursive: true });
  return fs.realpathSync(root);
}

export interface PathCheck {
  ok: boolean;
  resolved?: string;
  reason?: string;
}

/**
 * Confine `target` to the sandbox root. For writes, `mustExist=false` checks
 * the nearest existing ancestor's realpath so a symlinked parent can't escape.
 */
export function confinePath(target: string, mustExist = false): PathCheck {
  const root = sandboxRoot();
  if (typeof target !== 'string' || target.length === 0 || target.includes('\0')) {
    return { ok: false, reason: 'empty or invalid path' };
  }
  const resolved = path.resolve(root, target);
  const rel = path.relative(root, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, reason: 'path escapes sandbox root' };
  }
  // realpath the deepest existing ancestor to defeat symlink escapes.
  let probe = mustExist ? resolved : path.dirname(resolved);
  while (!fs.existsSync(probe) && probe !== root && probe.length > root.length) {
    probe = path.dirname(probe);
  }
  if (fs.existsSync(probe)) {
    const realProbe = fs.realpathSync(probe);
    const realRel = path.relative(root, realProbe);
    if (realRel !== '' && (realRel.startsWith('..') || path.isAbsolute(realRel))) {
      return { ok: false, reason: 'symlinked path escapes sandbox root' };
    }
  }
  return { ok: true, resolved };
}

// Exact-argv command allowlist. Keys are the full argv joined by single spaces.
// npm run <script> is additionally gated by ALLOWED_NPM_SCRIPTS.
export const ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  'npm test',
  'npm run typecheck',
  'npm run lint',
  'npm run build',
  'npx tsc --noEmit',
  'tsc --noEmit',
  'node --version',
  'npm --version',
]);
const ALLOWED_NPM_SCRIPTS: ReadonlySet<string> = new Set(['test', 'typecheck', 'lint', 'build']);

// Any shell metacharacter → hard reject. We never invoke a shell, but this also
// blocks argv injection attempts before they reach the allowlist check.
const SHELL_METACHARS = /[;&|<>$`(){}\[\]!#*?~\n\r\\'"]/;

export interface CommandCheck {
  ok: boolean;
  argv?: string[];
  reason?: string;
}

export function vetCommand(command: string): CommandCheck {
  if (typeof command !== 'string' || command.trim().length === 0) {
    return { ok: false, reason: 'empty command' };
  }
  if (SHELL_METACHARS.test(command)) {
    return { ok: false, reason: 'shell metacharacters are not permitted' };
  }
  const argv = command.trim().split(/\s+/);
  const norm = argv.join(' ');
  if (ALLOWED_COMMANDS.has(norm)) return { ok: true, argv };
  if (argv[0] === 'npm' && argv[1] === 'run' && argv.length === 3 && ALLOWED_NPM_SCRIPTS.has(argv[2])) {
    return { ok: true, argv };
  }
  return { ok: false, reason: `command not in allowlist: "${norm}"` };
}

/** Minimal child-process env — deliberately excludes every secret. */
export function scrubbedEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    NODE_ENV: process.env.NODE_ENV ?? 'production',
  };
}
