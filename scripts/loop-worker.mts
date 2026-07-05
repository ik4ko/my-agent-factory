// Always-on Loop Worker — the process that actually keeps loops moving.
// Run with: npx tsx scripts/loop-worker.mts
//
// This is a plain long-lived Node process (NOT a serverless function): it
// polls the event bus, then sweeps due loops, on a fixed interval. Vercel
// Cron hitting /api/loops/tick is only a lightweight heartbeat backup for
// when this process isn't running — it can't hold state or do sub-minute
// cadence, so treat this script as the source of truth while it's up.
import { config } from 'dotenv';
config({ path: '.env.local' });
import { tick, dispatchEvents } from '@/lib/loops/engine';
import { runNewsIngestCycle } from '@/lib/events/ingest';
import { hermesLog } from '@/lib/hermes/hermes-logger';

const TICK_MS = Number(process.env.LOOP_TICK_MS ?? 5000);
const NEWS_POLL_MS = Number(process.env.NEWS_POLL_MS ?? 45_000);

let shuttingDown = false;
let inFlight = false;
let newsInFlight = false;

async function cycle(): Promise<void> {
  if (inFlight) return; // previous cycle still running (slow brain call) — skip, don't stack
  inFlight = true;
  try {
    const events = await dispatchEvents();
    const ticked = await tick();
    if (events.matched > 0 || ticked.ran > 0) {
      console.log(
        `[loop-worker] events=${events.events}/${events.matched} matched · loops scanned=${ticked.scanned} ran=${ticked.ran} cleared=${ticked.cleared}`
      );
    }
  } catch (err) {
    console.error('[loop-worker] cycle failed:', err);
  } finally {
    inFlight = false;
  }
}

// Separate cadence from the loop tick — news ingest is its own external
// dependency (Finnhub) with its own rate limits and failure mode. A slow or
// failing feed must never stall the loop tick/event-dispatch cycle above.
async function newsCycle(): Promise<void> {
  if (newsInFlight) return;
  newsInFlight = true;
  try {
    const result = await runNewsIngestCycle();
    if (result.degraded || result.inserted > 0) {
      console.log(
        `[loop-worker] news: fetched=${result.fetched} inserted=${result.inserted} degraded=${result.degraded} regime=${result.regime.regime}`
      );
    }
  } catch (err) {
    console.error('[loop-worker] news cycle failed:', err);
  } finally {
    newsInFlight = false;
  }
}

async function main() {
  console.log(`[loop-worker] starting — tick interval ${TICK_MS}ms · news poll ${NEWS_POLL_MS}ms`);
  await hermesLog('info', `[LOOP-WORKER] started (tick=${TICK_MS}ms, news=${NEWS_POLL_MS}ms)`).catch(() => {});

  const interval = setInterval(() => void cycle(), TICK_MS);
  const newsInterval = setInterval(() => void newsCycle(), NEWS_POLL_MS);
  void cycle(); // run immediately on boot, don't wait for the first interval
  void newsCycle();

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[loop-worker] ${signal} received — shutting down`);
    clearInterval(interval);
    clearInterval(newsInterval);
    void hermesLog('info', '[LOOP-WORKER] stopped').finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
