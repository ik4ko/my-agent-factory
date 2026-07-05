// Coherent dry-run demo — seeds a couple of armed 'trade' loops on allowlist
// symbols with news triggers so that with loop-worker.mts running, the whole
// chain is watchable end to end: news ingest -> regime flags -> loop re-run
// -> dry_run orders at real quotes -> notifications in /dashboard/comms.
// No external APIs beyond Finnhub, no money, TRADING_ENABLED stays false.
//
// Run with: npx tsx scripts/demo-seed.mts
import { config } from 'dotenv';
config({ path: '.env.local' });

import { getAdminClient } from '@/lib/supabase/admin';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const DEMO_LOOPS = [
  {
    name: 'Demo: NVDA news-reactive',
    kind: 'trade' as const,
    objective:
      'Watch NVDA for momentum. On a bearish or high-severity news trigger, consider a small directional trade; otherwise hold. Always end with either an ORDER_INTENT line or none.',
    cadence_seconds: 60,
    triggers: [{ type: 'news', symbol: 'NVDA', minSeverity: 'high' }],
    config: { symbolAllowlist: ['NVDA'], maxTradeUsd: 250 },
  },
  {
    name: 'Demo: SPY macro watch',
    kind: 'trade' as const,
    objective:
      'Watch SPY for macro-driven moves. React to medium+ severity macro/regulatory news; otherwise hold and just report your read on sentiment.',
    cadence_seconds: 90,
    triggers: [{ type: 'news', symbol: 'SPY', minSeverity: 'med' }],
    config: { symbolAllowlist: ['SPY'], maxTradeUsd: 250 },
  },
];

async function main() {
  console.log('[demo-seed] seeding dry-run demo loops…');
  for (const loop of DEMO_LOOPS) {
    const { data: existing } = await db().from('loops').select('id').eq('name', loop.name).maybeSingle();
    if (existing) {
      await db()
        .from('loops')
        .update({ status: 'armed', next_tick_at: new Date().toISOString(), triggers: loop.triggers, config: loop.config })
        .eq('id', existing.id);
      console.log(`[demo-seed] re-armed existing "${loop.name}"`);
      continue;
    }
    const { error } = await db().from('loops').insert({
      name: loop.name,
      kind: loop.kind,
      objective: loop.objective,
      status: 'armed',
      cadence_seconds: loop.cadence_seconds,
      triggers: loop.triggers,
      config: loop.config,
      brain: 'claude',
      next_tick_at: new Date().toISOString(),
    });
    if (error) {
      console.error(`[demo-seed] failed to create "${loop.name}":`, error.message);
      continue;
    }
    console.log(`[demo-seed] created + armed "${loop.name}"`);
  }

  console.log(`
[demo-seed] done. To watch it run:
  1. npm run loop-worker        (ticks loops + polls news + runs the regime controller)
  2. open /dashboard/results    (live P&L/positions/orders/loop-runs feed)
  3. open /dashboard/comms      (notification feed — every dry_run order and regime shift lands here)
  4. open /dashboard/loops      (pause/stop these demo loops any time)

Everything stays dry_run — TRADING_ENABLED is untouched by this script.
`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
