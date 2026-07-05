import { randomUUID } from 'crypto';
import { getAdminClient } from '@/lib/supabase/admin';

/**
 * Concurrency stress-test runner — Phase 2 (server-side testing utility).
 *
 * Verifies the Compare-And-Set approval predicate under high-density
 * concurrent fire: seeds ONE PENDING staged order, then launches N
 * simultaneous decision mutations (alternating APPROVED/DENIED) against it.
 * The invariant under test: EXACTLY ONE mutation wins; every other returns
 * zero rows (the CAS `.eq('human_approval_status','PENDING')` predicate).
 *
 * SANDBOX-scoped: the seeded row is tagged source='SANDBOX' with a test
 * marker in the underlying pipeline_id and is deleted in the finally block.
 * Never points at live rows. Run via a dev-only script or route — not
 * shipped into any production path.
 */

export interface StressTestResult {
  concurrency: number;
  winners: number;
  conflicts: number;
  errors: number;
  passed: boolean;
  winningAction: string | null;
  elapsedMs: number;
}

export async function runApprovalConcurrencyStressTest(
  concurrency = 50,
): Promise<StressTestResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getAdminClient() as any;
  const testPipelineId = randomUUID();
  const started = Date.now();

  // Seed the contested row.
  const { data: seeded, error: seedError } = await db
    .from('staged_orders')
    .insert({
      underlying: 'SPY',
      option_type: 'CALL',
      strike: 450,
      expiration: '2026-08-21',
      limit_price: 1.25,
      calculated_position_size_usd: 2000,
      kelly_fraction: 0.02,
      expectancy: 0.705,
      win_rate: 0.55,
      r_multiple: 2.1,
      source: 'SANDBOX',
      pipeline_id: testPipelineId,
    })
    .select('id')
    .single();
  if (seedError || !seeded) {
    throw new Error(`stress seed failed: ${seedError?.message ?? 'no row'}`);
  }
  const orderId = (seeded as { id: string }).id;

  try {
    // Fire N simultaneous CAS mutations at the same row.
    const attempts = await Promise.all(
      Array.from({ length: concurrency }, (_, i) => {
        const action = i % 2 === 0 ? 'APPROVED' : 'DENIED';
        return db
          .from('staged_orders')
          .update({ human_approval_status: action })
          .eq('id', orderId)
          .eq('human_approval_status', 'PENDING') // the CAS predicate under test
          .select('human_approval_status')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .then((res: any) => ({
            won: !res.error && Array.isArray(res.data) && res.data.length > 0,
            action,
            errored: Boolean(res.error),
          }))
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .catch(() => ({ won: false, action, errored: true }));
      }),
    );

    const winners = attempts.filter((a) => a.won);
    const errors = attempts.filter((a) => a.errored).length;

    return {
      concurrency,
      winners: winners.length,
      conflicts: concurrency - winners.length - errors,
      errors,
      passed: winners.length === 1 && errors === 0,
      winningAction: winners[0]?.action ?? null,
      elapsedMs: Date.now() - started,
    };
  } finally {
    // Evict the test artifact regardless of outcome.
    await db.from('staged_orders').delete().eq('id', orderId);
  }
}
