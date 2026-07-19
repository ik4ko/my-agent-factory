// Live local-AI backend verification — proves one REAL round-trip through
// AgentRegistry.CODEX.think() against a running local server (not a stub),
// then reads the telemetry row back to show the provider=local tag landed.
//
// Run with your local server up:
//   AI_LOCAL_BASE_URL=http://127.0.0.1:11434/v1 AI_LOCAL_MODEL=<served-model> npx tsx scripts/test-local-ai.mts
// (or set both in .env.local and just `npx tsx scripts/test-local-ai.mts`)
import { config } from 'dotenv';
config({ path: '.env.local' });

import { resolveChatBackend } from '@/lib/agents/backend-config';
import { AgentRegistry } from '@/lib/agents/registry';
import { getAdminClient } from '@/lib/supabase/admin';

async function main(): Promise<void> {
  const backend = resolveChatBackend();
  if (backend.provider !== 'local') {
    console.error(
      'AI_LOCAL_BASE_URL is not set — this script verifies the LOCAL backend only.\n' +
        'Example: AI_LOCAL_BASE_URL=http://127.0.0.1:11434/v1 AI_LOCAL_MODEL=llama3.2 npx tsx scripts/test-local-ai.mts',
    );
    process.exit(1);
  }

  console.log(`Backend: ${backend.provider} @ ${backend.baseUrl}`);
  console.log(`Model:   ${backend.resolveModel('openai/gpt-4o-mini')} (lane slug openai/gpt-4o-mini)`);

  // Preflight: is anything actually listening?
  try {
    const probe = await fetch(`${backend.baseUrl}/models`, { signal: AbortSignal.timeout(5_000) });
    console.log(`Preflight GET /models -> ${probe.status}`);
  } catch {
    console.error(`Nothing answering at ${backend.baseUrl} — start your local server first.`);
    process.exit(1);
  }

  // The REAL call — ledger mode 'auto' so the telemetry write happens too.
  const t0 = Date.now();
  const result = await AgentRegistry.CODEX.think({
    system: 'You are a connectivity test. Reply in one short sentence.',
    prompt: 'Confirm you received this by naming one prime number.',
    maxTokens: 128,
    ledger: { mode: 'auto', detail: 'local-ai-live-verification' },
  });

  console.log('\n--- LIVE COMPLETION ---');
  console.log(result.text);
  console.log('-----------------------');
  console.log(`provider=${result.provider} model=${result.model} in=${result.inputTokens} out=${result.outputTokens} latency=${result.latencyMs}ms`);

  if (result.provider !== 'local') {
    console.error(`FAIL: expected provider=local, got ${result.provider} (fallback ran?)`);
    process.exit(1);
  }

  // Read the telemetry row back — the provider=local tag must be persisted.
  try {
    const db = getAdminClient();
    const { data, error } = await db
      .from('metrics')
      .select('model, detail, input_tokens, output_tokens, created_at')
      .gte('created_at', new Date(t0 - 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(3);
    if (error) throw new Error(error.message);
    const row = (data ?? []).find((r) => r.detail?.includes('provider=local'));
    if (row) {
      console.log(`\nTelemetry row: model=${row.model} · ${row.detail}`);
      console.log('\nPASS — real completion received and provider=local recorded in telemetry.');
    } else {
      console.error('\nPARTIAL — completion succeeded but no provider=local metrics row found (check supabase env).');
      process.exit(1);
    }
  } catch (err) {
    console.error(`\nPARTIAL — completion succeeded but telemetry readback failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

void main();
