/**
 * The Today queue: one ordered answer to "what should I do next?".
 *
 * This is a pure function over already-fetched rows. Keeping it free of I/O is
 * what makes the ordering rules testable — the interesting bugs in a work queue
 * are all ordering bugs, and they are invisible if the only way to exercise the
 * logic is to stand up a database.
 *
 * Design rule taken from the room's existing lead inbox: within a priority
 * band, OLDEST FIRST. A queue that surfaces the newest item first is how the
 * genuinely neglected work sinks to the bottom and stays there.
 */

export type QueuePriority = 'urgent' | 'high' | 'normal' | 'low';

export type QueueItemKind =
  | 'new_lead'
  | 'lead_uncontacted'
  | 'client_review_due'
  | 'coverage_change'
  | 'verification_blocked'
  | 'failed_job'
  | 'draft_communication'
  | 'compliance_action';

export type QueueItem = {
  id: string;
  kind: QueueItemKind;
  priority: QueuePriority;
  /** Primary line: who or what this is about. */
  title: string;
  /** Secondary line: why it is here. */
  subtitle: string;
  /** Where the information came from, shown so Eric can judge it. */
  source: string;
  /** Hours since the clock started on this item. Drives the age column. */
  ageHours: number;
  lastUpdated: string;
  status: string;
  owner: string | null;
  /**
   * Exactly one action per row. The brief's instruction to avoid ten competing
   * primary buttons is enforced structurally rather than by convention: the
   * type simply has no room for a second one.
   */
  action: { label: string; href: string };
};

const PRIORITY_RANK: Record<QueuePriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

/** Hours a website lead may sit unanswered before it escalates. */
export const LEAD_SLA_HOURS = 4;

function hoursBetween(from: string, now: Date): number {
  const start = new Date(from).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, (now.getTime() - start) / 36e5);
}

function personName(first: string | null, last: string | null): string {
  const name = `${first ?? ''} ${last ?? ''}`.trim();
  return name.length > 0 ? name : 'Unnamed record';
}

// ── Input shapes ────────────────────────────────────────────────────────────
// Deliberately narrow: each is the subset of a table this file actually reads,
// so a schema change that does not touch these fields cannot break the queue.

export type QueueLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  status: string;
  assigned_to: string | null;
  first_response_at: string | null;
  submitted_at: string;
  do_not_contact: boolean;
  preferred_contact: string;
  source_page: string | null;
};

export type QueueClient = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  next_review_at: string | null;
  last_verified_at: string | null;
};

export type QueueDiff = {
  id: string;
  client_id: string;
  target_field: string;
  current_value: string | null;
  incoming_value: string | null;
  source: string;
  observed_at: string;
  confidence: string;
  status: string;
};

export type QueueTask = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  priority: QueuePriority;
  status: string;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  assigned_to: string | null;
  client_id: string | null;
  source: string;
};

export type WorkQueueInput = {
  leads: QueueLead[];
  clients: QueueClient[];
  diffs: QueueDiff[];
  tasks: QueueTask[];
};

// ── Builders ────────────────────────────────────────────────────────────────

function leadItems(leads: QueueLead[], now: Date): QueueItem[] {
  return leads
    // A do-not-contact lead is a closed matter, not a pending one. Leaving it
    // in the queue invites exactly the outreach the flag exists to prevent.
    .filter((lead) => !lead.do_not_contact)
    .filter((lead) => !['closed', 'enrolled', 'do_not_contact'].includes(lead.status))
    .map((lead) => {
      const ageHours = hoursBetween(lead.submitted_at, now);
      const answered = lead.first_response_at !== null;
      const breached = !answered && ageHours >= LEAD_SLA_HOURS;

      return {
        id: `lead:${lead.id}`,
        kind: answered ? ('lead_uncontacted' as const) : ('new_lead' as const),
        // An unanswered enquiry past its SLA outranks everything else in the
        // room: it is the only item where the cost of delay is losing the
        // person entirely.
        priority: breached ? ('urgent' as const) : answered ? ('normal' as const) : ('high' as const),
        title: personName(lead.first_name, lead.last_name),
        subtitle: breached
          ? `No reply after ${Math.floor(ageHours)}h — prefers ${lead.preferred_contact}`
          : answered
            ? `Awaiting follow-up — prefers ${lead.preferred_contact}`
            : `New enquiry — prefers ${lead.preferred_contact}`,
        source: lead.source_page ? `website · ${lead.source_page}` : 'website',
        ageHours,
        lastUpdated: lead.submitted_at,
        status: lead.status,
        owner: lead.assigned_to,
        action: { label: answered ? 'Follow up' : 'Respond', href: `/dashboard/rooms/medicare/leads#${lead.id}` },
      };
    });
}

function reviewItems(clients: QueueClient[], now: Date): QueueItem[] {
  return clients
    .filter((client) => client.next_review_at !== null)
    .filter((client) => new Date(client.next_review_at as string).getTime() <= now.getTime())
    .map((client) => {
      const dueAt = client.next_review_at as string;
      const overdueHours = hoursBetween(dueAt, now);
      return {
        id: `review:${client.id}`,
        kind: 'client_review_due' as const,
        // A review a week late is materially different from one due this
        // morning, so the band escalates rather than the sort order alone.
        priority: overdueHours > 24 * 7 ? ('high' as const) : ('normal' as const),
        title: personName(client.first_name, client.last_name),
        subtitle: client.last_verified_at
          ? `Review due — last verified ${new Date(client.last_verified_at).toISOString().slice(0, 10)}`
          : 'Review due — never verified',
        source: 'crm',
        ageHours: overdueHours,
        lastUpdated: dueAt,
        status: 'due',
        owner: null,
        action: { label: 'Open client', href: `/dashboard/rooms/medicare/clients/${client.id}` },
      };
    });
}

function diffItems(diffs: QueueDiff[], clients: QueueClient[], now: Date): QueueItem[] {
  const nameById = new Map(clients.map((c) => [c.id, personName(c.first_name, c.last_name)]));

  return diffs
    .filter((diff) => diff.status === 'pending')
    .map((diff) => ({
      id: `diff:${diff.id}`,
      kind: 'coverage_change' as const,
      // Confidence drives urgency: a contract-PBP mismatch read off the CMS
      // record is actionable, a reformatted marketing name is not.
      priority: diff.confidence === 'high' ? ('high' as const) : ('normal' as const),
      title: nameById.get(diff.client_id) ?? 'Unknown client',
      subtitle: `${diff.target_field}: ${diff.current_value ?? '—'} → ${diff.incoming_value ?? '—'}`,
      source: diff.source,
      ageHours: hoursBetween(diff.observed_at, now),
      lastUpdated: diff.observed_at,
      status: 'awaiting approval',
      owner: null,
      action: { label: 'Review change', href: `/dashboard/rooms/medicare/coverage#${diff.id}` },
    }));
}

/** Task kinds that are compliance-sensitive and must route to Eric personally. */
const COMPLIANCE_KINDS = new Set([
  'compliance_action',
  'ambiguous_match',
  'consent_review',
  'plan_recommendation_review',
]);

const BLOCKED_KINDS = new Set(['verification_blocked', 'verification_failing']);
const FAILED_KINDS = new Set(['import_failed', 'job_failed', 'sync_failed']);
const DRAFT_KINDS = new Set(['draft_communication', 'draft_review']);

function taskKind(kind: string): QueueItemKind {
  if (COMPLIANCE_KINDS.has(kind)) return 'compliance_action';
  if (BLOCKED_KINDS.has(kind)) return 'verification_blocked';
  if (FAILED_KINDS.has(kind)) return 'failed_job';
  if (DRAFT_KINDS.has(kind)) return 'draft_communication';
  return 'compliance_action';
}

function taskItems(tasks: QueueTask[], now: Date): QueueItem[] {
  return tasks
    .filter((task) => {
      if (task.status === 'open') return true;
      // A snoozed task rejoins the queue the moment its timer expires.
      if (task.status === 'snoozed') {
        return task.due_at !== null && new Date(task.due_at).getTime() <= now.getTime();
      }
      return false;
    })
    .map((task) => ({
      id: `task:${task.id}`,
      kind: taskKind(task.kind),
      priority: task.priority,
      title: task.title,
      subtitle: task.detail,
      source: task.source,
      ageHours: hoursBetween(task.created_at, now),
      lastUpdated: task.updated_at,
      status: task.status,
      owner: task.assigned_to,
      action: {
        label: 'Open task',
        href: task.client_id
          ? `/dashboard/rooms/medicare/clients/${task.client_id}`
          : `/dashboard/rooms/medicare/tasks#${task.id}`,
      },
    }));
}

/**
 * Assemble and order the queue.
 *
 * Sort is priority band first, then oldest-first inside the band. Ties break on
 * id so the order is stable across refreshes — a queue that reshuffles under
 * the cursor is one that gets misclicked.
 */
export function buildWorkQueue(input: WorkQueueInput, now: Date = new Date()): QueueItem[] {
  const items = [
    ...leadItems(input.leads, now),
    ...reviewItems(input.clients, now),
    ...diffItems(input.diffs, input.clients, now),
    ...taskItems(input.tasks, now),
  ];

  return items.sort((a, b) => {
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (byPriority !== 0) return byPriority;
    const byAge = b.ageHours - a.ageHours;
    if (byAge !== 0) return byAge;
    return a.id.localeCompare(b.id);
  });
}

/** Counts per kind, for the section headers above the queue. */
export function summarizeQueue(items: QueueItem[]): Record<QueueItemKind, number> {
  const empty: Record<QueueItemKind, number> = {
    new_lead: 0,
    lead_uncontacted: 0,
    client_review_due: 0,
    coverage_change: 0,
    verification_blocked: 0,
    failed_job: 0,
    draft_communication: 0,
    compliance_action: 0,
  };
  for (const item of items) empty[item.kind] += 1;
  return empty;
}
