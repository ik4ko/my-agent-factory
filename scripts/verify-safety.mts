// CLI wrapper around the go-live safety-verification harness. Run before
// ever considering a live arm, and any time after a code change touching
// the risk gate, kill switch, or daily-loss logic.
//   npx tsx scripts/verify-safety.mts
import { config } from 'dotenv';
config({ path: '.env.local' });

import { runSafetySelftest } from '@/lib/golive/selftest';

async function main() {
  console.log('[verify-safety] running the 4 go-live checks…\n');
  const result = await runSafetySelftest();
  for (const check of result.checks) {
    console.log(`[${check.status.toUpperCase()}] ${check.label}\n        ${check.detail}`);
  }
  console.log(`\n[verify-safety] overall: ${result.overall.toUpperCase()}`);
  process.exit(result.overall === 'pass' ? 0 : 1);
}

main().catch((e) => {
  console.error('[verify-safety] harness crashed:', e);
  process.exit(1);
});
