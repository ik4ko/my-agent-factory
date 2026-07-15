// node --test omnigent/wrapper/sprint-utils.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newShortId,
  parseCallbackData,
  buildCallbackData,
  buildClaudeArgs,
  buildCodexArgs,
  classifyExit,
  composeGateMessage,
  parseSprintCommand,
} from './sprint-utils.mjs';

test('short ids are 8-hex and unique-ish', () => {
  const a = newShortId();
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.notEqual(a, newShortId());
});

test('callback data round-trips and rejects garbage', () => {
  const data = buildCallbackData('ab12cd34', 'ef56ab78', 'approved');
  assert.equal(data, 'g:ab12cd34:ef56ab78:a');
  assert.ok(data.length <= 64, 'inside the Telegram callback_data limit');
  assert.deepEqual(parseCallbackData(data), { shortCode: 'ab12cd34', gateId: 'ef56ab78', decision: 'approved' });
  assert.deepEqual(parseCallbackData('g:ab12cd34:ef56ab78:x').decision, 'denied');
  for (const bad of [null, '', 'g:xyz', 'g:ab12cd34:ef56ab78:q', 'approve:uuid-here', 'g:AB12CD34:ef56ab78:a']) {
    assert.equal(parseCallbackData(bad), null, `must reject ${JSON.stringify(bad)}`);
  }
});

test('spawn args carry only verified flags', () => {
  const c = buildClaudeArgs('do the thing');
  assert.equal(c[0], '-p');
  assert.ok(c.includes('--output-format') && c.includes('json'));
  assert.ok(!c.includes('--dangerously-skip-permissions'), 'never bypass all permissions');
  const x = buildCodexArgs('do the thing', '/var/data/repo', '/tmp/last.txt');
  assert.equal(x[0], 'exec');
  // DELIBERATE: bwrap (workspace-write's isolation) is categorically
  // unavailable on Render's container (unprivileged userns disabled). The
  // container IS the sandbox, so codex runs with the doc-sanctioned
  // externally-sandboxed flag. See buildCodexArgs' rationale.
  assert.ok(x.includes('--dangerously-bypass-approvals-and-sandbox'), 'container-is-sandbox mode');
  assert.ok(!x.includes('workspace-write'), 'no bwrap sandbox mode on Render');
  assert.equal(x[x.length - 1], 'do the thing');
});

test('exit classification — the OOM paths are distinct and plainly worded', () => {
  assert.equal(classifyExit({ code: 0, signal: null, engineKill: null, oomDelta: 0 }).kind, 'ok');
  assert.equal(classifyExit({ code: 1, signal: null, engineKill: null, oomDelta: 0 }).kind, 'error');
  assert.equal(classifyExit({ code: null, signal: 'SIGTERM', engineKill: 'estop', oomDelta: 0 }).kind, 'estop');
  assert.equal(classifyExit({ code: null, signal: 'SIGKILL', engineKill: 'timeout', oomDelta: 0 }).kind, 'timeout');
  const oom = classifyExit({ code: null, signal: 'SIGKILL', engineKill: null, oomDelta: 1 });
  assert.equal(oom.kind, 'oom');
  assert.match(oom.detail, /upscaling the Render plan/);
  const suspect = classifyExit({ code: 137, signal: null, engineKill: null, oomDelta: null });
  assert.equal(suspect.kind, 'oom-suspect');
  assert.match(suspect.detail, /OOM/);
  // an engine kill takes precedence over an incremented counter
  assert.equal(classifyExit({ code: null, signal: 'SIGKILL', engineKill: 'estop', oomDelta: 1 }).kind, 'estop');
});

test('gate message comes from the manifest alone, missing review is explicit', () => {
  const msg = composeGateMessage({
    task_id: '12345678-aaaa',
    sprint: { agent: 'claude-code', objective: 'fix the tests', ended_at: 'x' },
    diff: { files_changed: 3, insertions: 40, deletions: 5 },
    tests: { passed: 12, failed: 0, typecheck: 'pass' },
    summary: 'Did the thing.',
    review: { rubric: null },
    next_step_preview: 'spawn codex',
  });
  assert.match(msg, /12345678/);
  assert.match(msg, /3 file\(s\), \+40\/-5/);
  assert.match(msg, /Grok review unavailable/);
  assert.match(msg, /NEXT IF APPROVED: spawn codex/);
  const withRubric = composeGateMessage({
    review: { rubric: { correctness: 'pass', security: 'flag', test_coverage: 'pass', style: 'pass' }, notes: 'ok' },
  });
  assert.match(withRubric, /security=flag/);
});

test('per-phase breakdown shows both claude and codex, neither hidden', () => {
  const msg = composeGateMessage({
    task_id: 'abc1234',
    sprint: { agent: 'codex', objective: 'do X', ended_at: 'y' },
    diff: { files_changed: 1, insertions: 5, deletions: 0 },
    summary: 'codex added a helper',
    review: { rubric: { correctness: 'pass', security: 'pass', test_coverage: 'pass', style: 'pass' } },
    phases: [
      { agent: 'claude-code', diff: { files_changed: 2, insertions: 30, deletions: 1 }, review: { rubric: { correctness: 'pass', security: 'pass', test_coverage: 'pass', style: 'pass' } } },
      { agent: 'codex', diff: { files_changed: 1, insertions: 5, deletions: 0 }, review: { rubric: { correctness: 'pass', security: 'pass', test_coverage: 'pass', style: 'pass' } } },
    ],
  });
  assert.match(msg, /phases:/);
  assert.match(msg, /claude-code: 2 file\(s\) \+30\/-1/); // claude's work not clobbered
  assert.match(msg, /codex: 1 file\(s\) \+5\/-0/);        // codex's work also present
});

test('/sprint parsing demands a human-authored definition of done', () => {
  assert.deepEqual(parseSprintCommand('/sprint fix the flaky auth test | done: test passes 5x; typecheck clean'), {
    objective: 'fix the flaky auth test',
    definitionOfDone: ['test passes 5x', 'typecheck clean'],
  });
  assert.equal(parseSprintCommand('/sprint just do stuff'), null, 'no DoD → rejected');
  assert.equal(parseSprintCommand('/sprint | done: x'), null, 'no objective → rejected');
  assert.equal(parseSprintCommand('/sprint obj | done:'), null, 'empty DoD → rejected');
  assert.ok(parseSprintCommand('/sprint@mybot obj | done: a')); // /cmd@botname tolerated
});
