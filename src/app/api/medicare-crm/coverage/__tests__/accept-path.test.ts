/**
 * End-to-end exercise of the coverage accept path.
 *
 * This drives the real route handlers with a real signed operator session and
 * a real in-memory database, so the assertions are about what the book of
 * business actually looks like afterwards — not about which mocks were called.
 *
 * Every identifier below is synthetic. No real member, MBI, plan enrolment, or
 * carrier record appears anywhere in this file.
 */

import { createFakeSupabase, type Store } from './fake-supabase';

const store: Store = {};
let missingTables: string[] = [];

jest.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => createFakeSupabase(store, missingTables),
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/medicare-crm/coverage/route';
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth/session';

const PASSWORD = 'test-operator-password-not-a-real-secret';

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const POLICY_ID = '22222222-2222-4222-8222-222222222222';
const SNAPSHOT_ID = '33333333-3333-4333-8333-333333333333';
const DIFF_ID = '44444444-4444-4444-8444-444444444444';
const MBI_DIFF_ID = '55555555-5555-4555-8555-555555555555';
const TASK_ID = '66666666-6666-4666-8666-666666666666';
const ORPHAN_DIFF_ID = '77777777-7777-4777-8777-777777777777';

let sessionCookie = '';

/** A synthetic book of business, rebuilt before each test. */
function seed() {
  for (const key of Object.keys(store)) delete store[key];
  missingTables = [];

  store.ag_clients = [
    {
      id: CLIENT_ID,
      first_name: 'Fixture',
      last_name: 'Member',
      state: 'NJ',
      medicare_beneficiary_identifier: '1EG4TE5MK72',
      date_of_birth: '1955-03-02',
      last_verified_at: null,
      next_review_at: null,
    },
  ];
  store.ag_policies = [
    {
      id: POLICY_ID,
      client_id: CLIENT_ID,
      plan_name: 'Sample Advantage Choice (PPO)',
      contract_pbp: 'H1234001',
      effective_date: '2026-01-01',
      status: 'active',
      last_verified_at: null,
    },
  ];
  store.ag_coverage_snapshots = [
    {
      id: SNAPSHOT_ID,
      client_id: CLIENT_ID,
      policy_id: POLICY_ID,
      source: 'marx',
      source_detail: 'CMS MARx M232',
      observed_at: '2026-07-15T14:00:00.000Z',
      verification_status: 'active_changed',
      contract_pbp: 'H9999002',
      plan_name: 'Other Advantage Plus (HMO)',
      carrier_name: null,
      evidence_ref: null,
    },
  ];
  store.ag_coverage_diffs = [
    {
      id: DIFF_ID,
      client_id: CLIENT_ID,
      policy_id: POLICY_ID,
      snapshot_id: SNAPSHOT_ID,
      target_table: 'ag_policies',
      target_field: 'contract_pbp',
      current_value: 'H1234001',
      incoming_value: 'H9999002',
      source: 'marx',
      observed_at: '2026-07-15T14:00:00.000Z',
      confidence: 'high',
      status: 'pending',
      resolved_at: null,
      resolved_by: null,
      resolution_note: '',
    },
    {
      // A source claiming the record is about a different person. Must never
      // be applicable through this path.
      id: MBI_DIFF_ID,
      client_id: CLIENT_ID,
      policy_id: null,
      snapshot_id: SNAPSHOT_ID,
      target_table: 'ag_clients',
      target_field: 'medicare_beneficiary_identifier',
      current_value: '1EG4TE5MK72',
      incoming_value: '9XY8ZW7VU65',
      source: 'import',
      observed_at: '2026-07-15T14:00:00.000Z',
      confidence: 'low',
      status: 'pending',
      resolved_at: null,
      resolved_by: null,
      resolution_note: '',
    },
    {
      // Targets a policy row that does not exist.
      id: ORPHAN_DIFF_ID,
      client_id: CLIENT_ID,
      policy_id: '99999999-9999-4999-8999-999999999999',
      snapshot_id: SNAPSHOT_ID,
      target_table: 'ag_policies',
      target_field: 'plan_name',
      current_value: 'Whatever',
      incoming_value: 'Something Else',
      source: 'import',
      observed_at: '2026-07-15T14:00:00.000Z',
      confidence: 'low',
      status: 'pending',
      resolved_at: null,
      resolved_by: null,
      resolution_note: '',
    },
  ];
  store.ag_operator_tasks = [
    {
      id: TASK_ID,
      kind: 'coverage_changed',
      title: 'Coverage changed — Fixture Member',
      diff_id: DIFF_ID,
      client_id: CLIENT_ID,
      status: 'open',
      priority: 'high',
      completed_at: null,
      completed_by: null,
    },
  ];
  store.ag_audit_events = [];
}

function authed(method: 'GET' | 'POST', body?: unknown): NextRequest {
  return new NextRequest('https://factory.test/api/medicare-crm/coverage', {
    method,
    headers: {
      cookie: `${SESSION_COOKIE}=${sessionCookie}`,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function anonymous(method: 'GET' | 'POST', body?: unknown): NextRequest {
  return new NextRequest('https://factory.test/api/medicare-crm/coverage', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const policy = () => store.ag_policies.find((row) => row.id === POLICY_ID)!;
const client = () => store.ag_clients.find((row) => row.id === CLIENT_ID)!;
const diff = (id: string) => store.ag_coverage_diffs.find((row) => row.id === id)!;
const task = () => store.ag_operator_tasks.find((row) => row.id === TASK_ID)!;

beforeAll(async () => {
  // DASHBOARD_PASSWORD must be set: requireMedicareOperator treats an absent
  // password as "auth not configured", which in development returns null and
  // would let every request through — the opposite of what these tests check.
  process.env.DASHBOARD_PASSWORD = PASSWORD;
  sessionCookie = await createSessionToken(PASSWORD);
});

beforeEach(seed);

// ── Authorization ──────────────────────────────────────────────────────────

describe('authorization', () => {
  it('refuses to list coverage diffs without a session', async () => {
    const response = await GET(anonymous('GET'));
    expect(response.status).toBe(401);
  });

  it('refuses to accept a diff without a session', async () => {
    const response = await POST(anonymous('POST', { id: DIFF_ID, decision: 'accept' }));
    expect(response.status).toBe(401);
    // The critical assertion: rejection happened before any write.
    expect(policy().contract_pbp).toBe('H1234001');
    expect(diff(DIFF_ID).status).toBe('pending');
  });

  it('refuses a forged session cookie', async () => {
    const forged = new NextRequest('https://factory.test/api/medicare-crm/coverage', {
      method: 'POST',
      headers: {
        cookie: `${SESSION_COOKIE}=99999999999999.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ id: DIFF_ID, decision: 'accept' }),
    });
    expect((await POST(forged)).status).toBe(401);
    expect(policy().contract_pbp).toBe('H1234001');
  });

  it('refuses an expired session', async () => {
    const expired = await createSessionToken(PASSWORD, Date.now() - 30 * 24 * 60 * 60 * 1000);
    const request = new NextRequest('https://factory.test/api/medicare-crm/coverage', {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE}=${expired}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: DIFF_ID, decision: 'accept' }),
    });
    expect((await POST(request)).status).toBe(401);
    expect(policy().contract_pbp).toBe('H1234001');
  });
});

// ── Reading the review queue ───────────────────────────────────────────────

describe('review queue', () => {
  it('shows the current value beside the incoming value with provenance', async () => {
    const response = await GET(authed('GET'));
    expect(response.status).toBe(200);
    const body = await response.json();

    const pending = body.diffs.find((d: { id: string }) => d.id === DIFF_ID);
    expect(pending).toMatchObject({
      current_value: 'H1234001',
      incoming_value: 'H9999002',
      confidence: 'high',
      status: 'pending',
    });

    // Provenance has to travel with the proposal or it cannot be judged.
    const snapshot = body.snapshots.find((s: { id: string }) => s.id === SNAPSHOT_ID);
    expect(snapshot).toMatchObject({ source: 'marx', verification_status: 'active_changed' });
    expect(body.clients.find((c: { id: string }) => c.id === CLIENT_ID)).toBeDefined();
  });

  it('degrades to an empty queue when the migration has not been applied', async () => {
    missingTables = ['ag_coverage_diffs'];
    const response = await GET(authed('GET'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.migrationApplied).toBe(false);
    expect(body.diffs).toEqual([]);
  });
});

// ── Accepting ──────────────────────────────────────────────────────────────

describe('accepting an allowed field', () => {
  it('writes the approved value, stamps verification, audits, and closes the task', async () => {
    const response = await POST(authed('POST', { id: DIFF_ID, decision: 'accept' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'accepted', applied: true });

    // 1. the value actually changed on the policy
    expect(policy().contract_pbp).toBe('H9999002');
    // 2. verification date came from the observation, not from "now"
    expect(policy().last_verified_at).toBe('2026-07-15T14:00:00.000Z');
    expect(client().last_verified_at).toBe('2026-07-15T14:00:00.000Z');
    // 3. the diff is resolved
    expect(diff(DIFF_ID)).toMatchObject({ status: 'accepted', resolved_by: 'operator' });
    // 4. the task that existed only to prompt this decision is closed
    expect(task()).toMatchObject({ status: 'done', completed_by: 'operator' });

    // 5. the audit records both sides of the change
    const audit = store.ag_audit_events.find((e) => e.action === 'coverage_diff_accepted');
    expect(audit).toBeDefined();
    expect(audit).toMatchObject({ entity_type: 'ag_policies', entity_id: POLICY_ID });
    expect(audit!.before).toEqual({ contract_pbp: 'H1234001' });
    expect(audit!.after).toEqual({ contract_pbp: 'H9999002' });
  });

  it('is idempotent on replay — the second accept changes nothing', async () => {
    expect((await POST(authed('POST', { id: DIFF_ID, decision: 'accept' }))).status).toBe(200);

    // Simulate someone editing the record between the two presses. If the
    // replay were not blocked it would overwrite this.
    policy().contract_pbp = 'H7777003';

    const replay = await POST(authed('POST', { id: DIFF_ID, decision: 'accept' }));
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ error: 'Already resolved' });

    expect(policy().contract_pbp).toBe('H7777003');
    expect(store.ag_audit_events.filter((e) => e.action === 'coverage_diff_accepted')).toHaveLength(1);
  });
});

// ── The fields that must never be applied ──────────────────────────────────

describe('identity fields are not applicable through the diff path', () => {
  it('refuses to accept an MBI change and leaves the record untouched', async () => {
    const response = await POST(authed('POST', { id: MBI_DIFF_ID, decision: 'accept' }));
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/cannot be applied automatically/i);

    expect(client().medicare_beneficiary_identifier).toBe('1EG4TE5MK72');
    expect(diff(MBI_DIFF_ID).status).toBe('pending');
    expect(store.ag_audit_events.filter((e) => e.action === 'coverage_diff_accepted')).toHaveLength(0);
  });

  it('refuses to accept a date-of-birth change', async () => {
    store.ag_coverage_diffs.push({
      ...diff(MBI_DIFF_ID),
      id: '88888888-8888-4888-8888-888888888888',
      target_field: 'date_of_birth',
      current_value: '1955-03-02',
      incoming_value: '1956-04-03',
    });

    const response = await POST(
      authed('POST', { id: '88888888-8888-4888-8888-888888888888', decision: 'accept' }),
    );
    expect(response.status).toBe(422);
    expect(client().date_of_birth).toBe('1955-03-02');
  });
});

// ── Stale proposals ────────────────────────────────────────────────────────

describe('records edited since the proposal', () => {
  it('supersedes rather than clobbering a value that changed underneath it', async () => {
    // Someone corrected the plan by hand after the observation was recorded.
    policy().contract_pbp = 'H5555009';

    const response = await POST(authed('POST', { id: DIFF_ID, decision: 'accept' }));
    expect(response.status).toBe(409);

    // The hand-made correction survives.
    expect(policy().contract_pbp).toBe('H5555009');
    expect(diff(DIFF_ID).status).toBe('superseded');
    expect(store.ag_audit_events.some((e) => e.action === 'coverage_diff_superseded')).toBe(true);
  });

  it('rejects a diff whose target record no longer exists', async () => {
    const response = await POST(authed('POST', { id: ORPHAN_DIFF_ID, decision: 'accept' }));
    expect(response.status).toBe(404);
    expect(diff(ORPHAN_DIFF_ID).status).toBe('pending');
  });
});

// ── Rejecting and flagging ─────────────────────────────────────────────────

describe('reject and follow-up', () => {
  it('records a rejection without writing to the book of business', async () => {
    const response = await POST(authed('POST', { id: DIFF_ID, decision: 'reject', note: 'Carrier confirmed no change' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'rejected', applied: false });

    expect(policy().contract_pbp).toBe('H1234001');
    expect(diff(DIFF_ID)).toMatchObject({ status: 'rejected', resolution_note: 'Carrier confirmed no change' });
    expect(store.ag_audit_events.some((e) => e.action === 'coverage_diff_rejected')).toBe(true);
  });

  it('records a follow-up flag without applying anything', async () => {
    const response = await POST(authed('POST', { id: DIFF_ID, decision: 'follow_up' }));
    expect(response.status).toBe(200);
    expect(policy().contract_pbp).toBe('H1234001');
    expect(diff(DIFF_ID).status).toBe('follow_up');
  });

  it('will not resolve an already-rejected diff a second time', async () => {
    await POST(authed('POST', { id: DIFF_ID, decision: 'reject' }));
    const replay = await POST(authed('POST', { id: DIFF_ID, decision: 'accept' }));
    expect(replay.status).toBe(409);
    expect(policy().contract_pbp).toBe('H1234001');
  });
});

// ── Malformed input ────────────────────────────────────────────────────────

describe('malformed requests', () => {
  it.each([
    ['no body', undefined],
    ['missing id', { decision: 'accept' }],
    ['id is not a uuid', { id: 'not-a-uuid', decision: 'accept' }],
    ['unknown decision', { id: DIFF_ID, decision: 'delete-everything' }],
    ['decision missing', { id: DIFF_ID }],
  ])('rejects %s with 400 and writes nothing', async (_label, body) => {
    const response = await POST(authed('POST', body));
    expect(response.status).toBe(400);
    expect(policy().contract_pbp).toBe('H1234001');
    expect(store.ag_audit_events).toHaveLength(0);
  });

  it('returns 404 for a diff that does not exist', async () => {
    const response = await POST(
      authed('POST', { id: '00000000-0000-4000-8000-000000000000', decision: 'accept' }),
    );
    expect(response.status).toBe(404);
  });
});
