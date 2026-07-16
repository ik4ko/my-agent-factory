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
import { pollAndCacheQuotes } from '@/lib/market/finnhub-quotes';
import { scanOptionsFlow } from '@/lib/trading/options-flow';
import { hermesLog } from '@/lib/hermes/hermes-logger';

const TICK_MS = Number(process.env.LOOP_TICK_MS ?? 5000);
const NEWS_POLL_MS = Number(process.env.NEWS_POLL_MS ?? 45_000);
const QUOTE_POLL_MS = Number(process.env.QUOTE_POLL_MS ?? 30_000);
const OPTIONS_FLOW_POLL_MS = Number(process.env.OPTIONS_FLOW_POLL_MS ?? 60_000);
const HEARTBEAT_MS = 30_000;

let shuttingDown = false;
let inFlight = false;
let newsInFlight = false;
let quoteInFlight = false;
let optionsFlowInFlight = false;

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

// Separate cadence again — Finnhub quote polling is its own external
// dependency with its own rate limit, independent of news and loop ticks.
async function quoteCycle(): Promise<void> {
  if (quoteInFlight) return;
  quoteInFlight = true;
  try {
    const result = await pollAndCacheQuotes();
    if (result.degraded || result.priceEvents > 0) {
      console.log(`[loop-worker] quotes: polled=${result.polled} updated=${result.updated} priceEvents=${result.priceEvents} degraded=${result.degraded}${result.reason ? ` (${result.reason})` : ''}`);
    }
  } catch (err) {
    console.error('[loop-worker] quote cycle failed:', err);
  } finally {
    quoteInFlight = false;
  }
}

async function optionsFlowCycle(): Promise<void> {
  if (optionsFlowInFlight) return;
  optionsFlowInFlight = true;
  try {
    const result = await scanOptionsFlow();
    if (result.inserted > 0 || result.reason) {
      console.log(
        `[loop-worker] options-flow: provider=${result.provider} scanned=${result.scanned} candidates=${result.candidates} inserted=${result.inserted}${result.reason ? ` (${result.reason})` : ''}`
      );
    }
  } catch (err) {
    console.error('[loop-worker] options-flow cycle failed:', err);
  } finally {
    optionsFlowInFlight = false;
  }
}

async function main() {
  console.log(`[loop-worker] starting — tick interval ${TICK_MS}ms · news poll ${NEWS_POLL_MS}ms · quote poll ${QUOTE_POLL_MS}ms`);
  await hermesLog('info', `[LOOP-WORKER] started (tick=${TICK_MS}ms, news=${NEWS_POLL_MS}ms, quotes=${QUOTE_POLL_MS}ms)`).catch(() => {});

  const interval = setInterval(() => void cycle(), TICK_MS);
  const newsInterval = setInterval(() => void newsCycle(), NEWS_POLL_MS);
  const quoteInterval = setInterval(() => void quoteCycle(), QUOTE_POLL_MS);
  const optionsFlowInterval = setInterval(() => void optionsFlowCycle(), OPTIONS_FLOW_POLL_MS);
  // Distinct from the start/stop lines above — this is the liveness signal
  // /api/golive/preflight checks: a recent "[LOOP-WORKER] alive" line means
  // the process is genuinely still running, not just that it once started.
  const heartbeatInterval = setInterval(() => void hermesLog('info', '[LOOP-WORKER] alive').catch(() => {}), HEARTBEAT_MS);
  void cycle(); // run immediately on boot, don't wait for the first interval
  void newsCycle();
  void quoteCycle();
  void optionsFlowCycle();

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[loop-worker] ${signal} received — shutting down`);
    clearInterval(interval);
    clearInterval(newsInterval);
    clearInterval(quoteInterval);
    clearInterval(optionsFlowInterval);
    clearInterval(heartbeatInterval);
    void hermesLog('info', '[LOOP-WORKER] stopped').finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
