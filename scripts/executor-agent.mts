// Executor Agent — the ONLY process that ever calls a Robinhood MCP tool.
// Run with: npx tsx scripts/executor-agent.mts
//
// Polls `orders` for rows the loop engine queued via BridgeAdapter
// (status='intent'), claims one, drives review_equity_order then
// place_equity_order over a real MCP connection, and writes the result back
// onto that same row. It never decides WHETHER to trade — the loop engine's
// risk gate already cleared this intent before it ever reached the orders
// table; this process only ever asks "can this be placed right now" (kill
// switch / halt, checked again here as defense in depth).
//
// IMPORTANT — the one real dependency this needs from the operator:
// the `mcp__849e0f0c-...` Robinhood connector available inside an
// interactive Claude Code session is bound to THAT session/connector graph,
// not to arbitrary Node processes. This script cannot silently reuse it. It
// needs its own MCP connection, configured via EITHER:
//   EXECUTOR_ROBINHOOD_MCP_URL      — a Streamable-HTTP/SSE MCP endpoint, or
//   EXECUTOR_ROBINHOOD_MCP_COMMAND  — a local stdio MCP server command
// Until one of those is set, this process still runs its poll loop (so
// queued intents are visible on the dashboard) but explicitly logs
// "not configured" and releases its claim instead of fabricating a fill.
import { config } from 'dotenv';
config({ path: '.env.local' });

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { notify } from '@/lib/comms/transport';
import type { OrderRow } from '@/lib/types/database.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const TICK_MS = Number(process.env.EXECUTOR_TICK_MS ?? 5000);
const CLAIM_PREFIX = 'claiming:';

let mcpClient: Client | null = null;
let mcpConfigured = false;

async function connectMcp(): Promise<Client | null> {
  if (mcpClient) return mcpClient;
  const url = process.env.EXECUTOR_ROBINHOOD_MCP_URL?.trim();
  const command = process.env.EXECUTOR_ROBINHOOD_MCP_COMMAND?.trim();
  if (!url && !command) return null;

  const client = new Client({ name: 'my-agent-factory-executor', version: '1.0.0' });
  if (url) {
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  } else if (command) {
    const [cmd, ...args] = command.split(' ');
    await client.connect(new StdioClientTransport({ command: cmd, args }));
  }
  mcpClient = client;
  mcpConfigured = true;
  return client;
}

async function isKillSwitchOrHalted(): Promise<{ blocked: boolean; reason?: string }> {
  if (process.env.KILL_SWITCH === 'true') return { blocked: true, reason: 'kill switch engaged (env)' };
  const { data } = await db().from('risk_state').select('kill_switch, halted, halt_reason').eq('id', 1).maybeSingle();
  if (data?.kill_switch) return { blocked: true, reason: 'kill switch engaged' };
  if (data?.halted) return { blocked: true, reason: `trading halted: ${data.halt_reason ?? 'unspecified'}` };
  return { blocked: false };
}

/** Optimistic claim: only one executor wins a given intent row. broker_id
 *  doubles as the claim marker before it holds a real broker order id. */
async function claimIntent(order: OrderRow): Promise<boolean> {
  const { data } = await db()
    .from('orders')
    .update({ broker_id: `${CLAIM_PREFIX}${process.pid}`, updated_at: new Date().toISOString() })
    .eq('id', order.id)
    .eq('status', 'intent')
    .is('broker_id', null)
    .select('id')
    .maybeSingle();
  return Boolean(data);
}

async function releaseIntent(orderId: string): Promise<void> {
  await db().from('orders').update({ broker_id: null }).eq('id', orderId);
}

async function processIntent(order: OrderRow): Promise<void> {
  const gate = await isKillSwitchOrHalted();
  if (gate.blocked) {
    await db().from('orders').update({ status: 'risk_blocked', reason: gate.reason, updated_at: new Date().toISOString() }).eq('id', order.id);
    await hermesLog('warn', `[EXECUTOR] blocked ${order.symbol}: ${gate.reason}`);
    return;
  }

  const client = await connectMcp();
  if (!client) {
    if (!mcpConfigured) {
      await hermesLog('warn', '[EXECUTOR] Robinhood MCP not configured (EXECUTOR_ROBINHOOD_MCP_URL / _COMMAND unset) — leaving intent queued');
    }
    await releaseIntent(order.id); // don't fabricate a fill — try again next cycle
    return;
  }

  try {
    const args = {
      symbol: order.symbol,
      side: order.side,
      quantity: order.qty ?? undefined,
      order_type: order.type,
      limit_price: order.limit_price ?? undefined,
    };
    // Review before placing — matches the operator's mandated MCP sequence.
    await client.callTool({ name: 'review_equity_order', arguments: args });
    const placed = await client.callTool({ name: 'place_equity_order', arguments: args });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = placed.content as any;
    const text = Array.isArray(content) ? content.find((c: { type: string }) => c.type === 'text')?.text : undefined;
    let parsed: { id?: string; state?: string; average_price?: string } = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      /* MCP returned non-JSON text — record raw text as the reason below */
    }

    const status = parsed.state === 'filled' ? 'filled' : parsed.id ? 'submitted' : 'rejected';
    await db()
      .from('orders')
      .update({
        status,
        broker_id: parsed.id ?? null,
        fill_price: parsed.average_price ? Number(parsed.average_price) : null,
        reason: text?.slice(0, 300) ?? order.reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id);
    await hermesLog(status === 'rejected' ? 'error' : 'success', `[EXECUTOR] ${order.side} ${order.symbol} → ${status}`);
    if (status !== 'rejected') {
      await notify(`Order ${order.side.toUpperCase()} ${order.symbol} → ${status}`);
    }
  } catch (err) {
    const line = String(err).replace(/\s+/g, ' ').slice(0, 200);
    await db().from('orders').update({ status: 'rejected', reason: line, updated_at: new Date().toISOString() }).eq('id', order.id);
    await hermesLog('error', `[EXECUTOR] ${order.symbol} failed: ${line}`);
  }
}

async function cycle(): Promise<void> {
  const { data, error } = await db().from('orders').select('*').eq('status', 'intent').is('broker_id', null).limit(10);
  if (error) {
    console.error('[executor-agent] scan failed:', error.message);
    return;
  }
  for (const order of (data ?? []) as OrderRow[]) {
    if (await claimIntent(order)) await processIntent(order);
  }
}

async function main() {
  console.log(`[executor-agent] starting — tick interval ${TICK_MS}ms`);
  await hermesLog('info', `[EXECUTOR] started (tick=${TICK_MS}ms, mcp=${process.env.EXECUTOR_ROBINHOOD_MCP_URL || process.env.EXECUTOR_ROBINHOOD_MCP_COMMAND ? 'configured' : 'NOT configured'})`).catch(() => {});

  const interval = setInterval(() => void cycle().catch((e) => console.error('[executor-agent] cycle error:', e)), TICK_MS);
  void cycle();

  const shutdown = (signal: string) => {
    console.log(`[executor-agent] ${signal} received — shutting down`);
    clearInterval(interval);
    void mcpClient?.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
