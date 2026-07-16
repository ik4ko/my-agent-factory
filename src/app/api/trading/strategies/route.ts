import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import type { LoopRow, LoopTrigger } from '@/lib/types/database.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const STRATEGY_TYPES = ['momentum', 'breakout', 'mean_reversion', 'news_catalyst', 'follow_the_money', 'custom'] as const;

const CreateStrategySchema = z.object({
  name: z.string().trim().min(1).max(120),
  objective: z.string().trim().min(20).max(4000),
  strategyType: z.enum(STRATEGY_TYPES).optional().default('custom'),
  symbols: z
    .union([
      z.string().max(300),
      z.array(z.string().trim().regex(/^[A-Z]{1,6}$/)).max(40),
    ])
    .optional()
    .default([]),
  timeframe: z.enum(['intraday', 'swing', 'position']).optional().default('intraday'),
  maxTradeUsd: z.number().positive().max(100_000).optional(),
  maxOpenPositions: z.number().int().positive().max(50).optional(),
  confidenceThreshold: z.number().min(0.5).max(0.95).optional().default(0.65),
  cadence_seconds: z.number().int().min(30).max(86_400).nullable().optional().default(null),
  notes: z.string().max(2000).optional().default(''),
  status: z.enum(['armed', 'paused']).optional().default('paused'),
});

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseSymbols(input: string | string[] | undefined): string[] {
  const values = Array.isArray(input) ? input : String(input ?? '').split(',');
  return [...new Set(values.map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z]{1,6}$/.test(s)))];
}

function strategyConfig(input: z.infer<typeof CreateStrategySchema>) {
  return {
    autonomousMandate: true,
    strategyType: input.strategyType,
    timeframe: input.timeframe,
    symbolAllowlist: parseSymbols(input.symbols),
    maxTradeUsd: input.maxTradeUsd ?? envNumber('MAX_TRADE_USD', 250),
    maxOpenPositions: input.maxOpenPositions ?? envNumber('MAX_OPEN_POSITIONS', 5),
    confidenceThreshold: input.confidenceThreshold,
    requireContraryEvidence: true,
    notes: input.notes,
  };
}

function strategyObjective(input: z.infer<typeof CreateStrategySchema>, symbols: string[]): string {
  return [
    input.objective.trim(),
    '',
    `Strategy type: ${input.strategyType}. Timeframe: ${input.timeframe}.`,
    symbols.length ? `Allowed symbols: ${symbols.join(', ')}.` : 'Allowed symbols: use the global SYMBOL_ALLOWLIST only.',
    `Minimum confidence threshold: ${(input.confidenceThreshold * 100).toFixed(0)}%.`,
    'Before emitting ORDER_INTENT, evaluate supporting evidence, opposing evidence, liquidity, current regime, risk/reward, and invalidation.',
    'If the setup is not clearly inside this mandate, hold. Do not force a trade.',
    input.notes ? `Operator strategy notes: ${input.notes.trim()}` : '',
    'Options-flow alerts above the configured threshold may wake this strategy immediately; still hold unless the signal survives chart/news/risk review.',
  ]
    .filter(Boolean)
    .join('\n');
}

function isOperatorDirectLoop(loop: LoopRow): boolean {
  return (loop.config as { directOperator?: boolean } | null)?.directOperator === true;
}

export async function GET() {
  const { data, error } = await db()
    .from('loops')
    .select('*')
    .eq('kind', 'trade')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    strategies: ((data ?? []) as LoopRow[]).filter((loop) => !isOperatorDirectLoop(loop)),
  });
}

export async function POST(req: NextRequest) {
  const parsed = CreateStrategySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid strategy payload' },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const config = strategyConfig(body);
  const objective = strategyObjective(body, config.symbolAllowlist);
  const flowTriggers: LoopTrigger[] =
    config.symbolAllowlist.length > 0
      ? config.symbolAllowlist.map((symbol) => ({ type: 'price', symbol, minSeverity: 'high' }))
      : [{ type: 'price', minSeverity: 'high' }];
  const { data, error } = await db()
    .from('loops')
    .insert({
      name: body.name,
      kind: 'trade',
      objective,
      status: body.status,
      cadence_seconds: body.cadence_seconds,
      triggers: [
        { type: 'manual' },
        ...config.symbolAllowlist.map((symbol) => ({ type: 'news' as const, symbol, minSeverity: 'high' as const })),
        ...flowTriggers,
      ],
      config,
      brain: 'claude',
      next_tick_at: body.status === 'armed' ? new Date().toISOString() : null,
    })
    .select()
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'strategy create failed' }, { status: 500 });

  const strategy = data as LoopRow;
  await hermesLog('info', `[TRADING] strategy created "${strategy.name}" (${strategy.status})`);
  return NextResponse.json({ strategy });
}
