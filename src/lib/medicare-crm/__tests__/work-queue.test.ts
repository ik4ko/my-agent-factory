import {
  buildWorkQueue,
  summarizeQueue,
  type QueueClient,
  type QueueDiff,
  type QueueLead,
  type QueueTask,
  type WorkQueueInput,
} from '@/lib/medicare-crm/work-queue';

/** Fixed clock — a queue whose tests depend on wall time is a flaky queue. */
const NOW = new Date('2026-07-28T12:00:00.000Z');

function lead(over: Partial<QueueLead> = {}): QueueLead {
  return {
    id: 'lead-1',
    first_name: 'Sample',
    last_name: 'Enquirer',
    status: 'new',
    assigned_to: null,
    first_response_at: null,
    submitted_at: '2026-07-28T11:00:00.000Z',
    do_not_contact: false,
    preferred_contact: 'phone',
    source_page: '/contact',
    ...over,
  };
}

function client(over: Partial<QueueClient> = {}): QueueClient {
  return {
    id: 'client-1',
    first_name: 'Sample',
    last_name: 'Member',
    next_review_at: null,
    last_verified_at: null,
    ...over,
  };
}

function diff(over: Partial<QueueDiff> = {}): QueueDiff {
  return {
    id: 'diff-1',
    client_id: 'client-1',
    target_field: 'contract_pbp',
    current_value: 'H1234-001',
    incoming_value: 'H9999-002',
    source: 'marx',
    observed_at: '2026-07-27T12:00:00.000Z',
    confidence: 'high',
    status: 'pending',
    ...over,
  };
}

function task(over: Partial<QueueTask> = {}): QueueTask {
  return {
    id: 'task-1',
    kind: 'import_failed',
    title: 'Import failed',
    detail: 'Roster upload rejected 3 rows',
    priority: 'normal',
    status: 'open',
    due_at: null,
    created_at: '2026-07-27T12:00:00.000Z',
    updated_at: '2026-07-27T12:00:00.000Z',
    assigned_to: null,
    client_id: null,
    source: 'system',
    ...over,
  };
}

function input(over: Partial<WorkQueueInput> = {}): WorkQueueInput {
  return { leads: [], clients: [], diffs: [], tasks: [], ...over };
}

describe('buildWorkQueue — lead handling', () => {
  it('gives a fresh unanswered lead high priority', () => {
    const [item] = buildWorkQueue(input({ leads: [lead()] }), NOW);
    expect(item).toMatchObject({ kind: 'new_lead', priority: 'high' });
  });

  it('escalates to urgent once the reply SLA is breached', () => {
    const stale = lead({ submitted_at: '2026-07-28T04:00:00.000Z' }); // 8h old
    const [item] = buildWorkQueue(input({ leads: [stale] }), NOW);
    expect(item.priority).toBe('urgent');
    expect(item.subtitle).toMatch(/No reply after 8h/);
  });

  it('drops a do-not-contact lead from the queue entirely', () => {
    // The flag exists to prevent outreach; leaving the lead in a queue whose
    // whole purpose is prompting outreach would defeat it.
    const queue = buildWorkQueue(
      input({ leads: [lead({ do_not_contact: true, status: 'do_not_contact' })] }),
      NOW,
    );
    expect(queue).toEqual([]);
  });

  it('drops closed and enrolled leads', () => {
    const queue = buildWorkQueue(
      input({
        leads: [
          lead({ id: 'a', status: 'closed' }),
          lead({ id: 'b', status: 'enrolled' }),
        ],
      }),
      NOW,
    );
    expect(queue).toEqual([]);
  });

  it('demotes an already-answered lead below a new one', () => {
    const queue = buildWorkQueue(
      input({
        leads: [
          lead({ id: 'answered', first_response_at: '2026-07-28T11:30:00.000Z', status: 'contact_attempted' }),
          lead({ id: 'fresh' }),
        ],
      }),
      NOW,
    );
    expect(queue.map((i) => i.id)).toEqual(['lead:fresh', 'lead:answered']);
  });
});

describe('buildWorkQueue — review and coverage', () => {
  it('surfaces a client whose review date has passed', () => {
    const [item] = buildWorkQueue(
      input({ clients: [client({ next_review_at: '2026-07-27T12:00:00.000Z' })] }),
      NOW,
    );
    expect(item).toMatchObject({ kind: 'client_review_due', priority: 'normal' });
    expect(item.subtitle).toMatch(/never verified/);
  });

  it('does not surface a review that is not yet due', () => {
    const queue = buildWorkQueue(
      input({ clients: [client({ next_review_at: '2026-09-01T00:00:00.000Z' })] }),
      NOW,
    );
    expect(queue).toEqual([]);
  });

  it('escalates a review more than a week overdue', () => {
    const [item] = buildWorkQueue(
      input({ clients: [client({ next_review_at: '2026-07-10T12:00:00.000Z' })] }),
      NOW,
    );
    expect(item.priority).toBe('high');
  });

  it('shows a pending coverage diff as an approval item, never as applied', () => {
    const [item] = buildWorkQueue(
      input({ clients: [client()], diffs: [diff()] }),
      NOW,
    );
    expect(item).toMatchObject({ kind: 'coverage_change', status: 'awaiting approval' });
    expect(item.subtitle).toBe('contract_pbp: H1234-001 → H9999-002');
    expect(item.action.label).toBe('Review change');
  });

  it('hides diffs that are already resolved', () => {
    const queue = buildWorkQueue(
      input({
        clients: [client()],
        diffs: [
          diff({ id: 'a', status: 'accepted' }),
          diff({ id: 'b', status: 'rejected' }),
          diff({ id: 'c', status: 'superseded' }),
        ],
      }),
      NOW,
    );
    expect(queue).toEqual([]);
  });

  it('ranks a low-confidence diff below a high-confidence one', () => {
    const queue = buildWorkQueue(
      input({
        clients: [client()],
        diffs: [
          diff({ id: 'low', confidence: 'low', observed_at: '2026-07-20T12:00:00.000Z' }),
          diff({ id: 'high', confidence: 'high' }),
        ],
      }),
      NOW,
    );
    // The low-confidence item is older, so this also proves priority beats age.
    expect(queue.map((i) => i.id)).toEqual(['diff:high', 'diff:low']);
  });
});

describe('buildWorkQueue — tasks', () => {
  it('includes open tasks', () => {
    const [item] = buildWorkQueue(input({ tasks: [task()] }), NOW);
    expect(item).toMatchObject({ kind: 'failed_job', priority: 'normal' });
  });

  it('keeps a snoozed task hidden until its timer expires', () => {
    const hidden = buildWorkQueue(
      input({ tasks: [task({ status: 'snoozed', due_at: '2026-08-05T12:00:00.000Z' })] }),
      NOW,
    );
    expect(hidden).toEqual([]);

    const surfaced = buildWorkQueue(
      input({ tasks: [task({ status: 'snoozed', due_at: '2026-07-27T12:00:00.000Z' })] }),
      NOW,
    );
    expect(surfaced).toHaveLength(1);
  });

  it('excludes completed and dismissed tasks', () => {
    const queue = buildWorkQueue(
      input({ tasks: [task({ id: 'a', status: 'done' }), task({ id: 'b', status: 'dismissed' })] }),
      NOW,
    );
    expect(queue).toEqual([]);
  });

  it('classifies compliance-sensitive kinds so they can be routed to Eric', () => {
    const [item] = buildWorkQueue(
      input({ tasks: [task({ kind: 'ambiguous_match', priority: 'high' })] }),
      NOW,
    );
    expect(item.kind).toBe('compliance_action');
  });
});

describe('buildWorkQueue — ordering', () => {
  it('sorts by priority band, then oldest-first within the band', () => {
    const queue = buildWorkQueue(
      input({
        leads: [
          lead({ id: 'urgent-new', submitted_at: '2026-07-28T02:00:00.000Z' }),
          lead({ id: 'urgent-older', submitted_at: '2026-07-27T02:00:00.000Z' }),
          lead({ id: 'fresh', submitted_at: '2026-07-28T11:45:00.000Z' }),
        ],
      }),
      NOW,
    );

    expect(queue.map((i) => i.id)).toEqual([
      'lead:urgent-older', // urgent, oldest
      'lead:urgent-new', // urgent
      'lead:fresh', // high
    ]);
  });

  it('is stable across repeated builds of identical input', () => {
    const data = input({
      leads: [lead({ id: 'a' }), lead({ id: 'b' })],
      clients: [client()],
      diffs: [diff()],
      tasks: [task()],
    });
    const first = buildWorkQueue(data, NOW).map((i) => i.id);
    const second = buildWorkQueue(data, NOW).map((i) => i.id);
    expect(second).toEqual(first);
  });

  it('gives every item exactly one action', () => {
    const queue = buildWorkQueue(
      input({
        leads: [lead()],
        clients: [client({ next_review_at: '2026-07-01T00:00:00.000Z' })],
        diffs: [diff()],
        tasks: [task()],
      }),
      NOW,
    );
    expect(queue.length).toBe(4);
    for (const item of queue) {
      expect(typeof item.action.label).toBe('string');
      expect(item.action.href).toMatch(/^\/dashboard\/rooms\/medicare/);
    }
  });
});

describe('summarizeQueue', () => {
  it('counts each kind and reports zero for absent ones', () => {
    const queue = buildWorkQueue(
      input({ leads: [lead()], clients: [client()], diffs: [diff()] }),
      NOW,
    );
    const summary = summarizeQueue(queue);
    expect(summary.new_lead).toBe(1);
    expect(summary.coverage_change).toBe(1);
    expect(summary.failed_job).toBe(0);
  });
});
