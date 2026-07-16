import { getAdminClient } from '@/lib/supabase/admin';
import { hermesLog } from '@/lib/hermes/hermes-logger';
import { notify } from '@/lib/comms/transport';
import { publishBusEvent } from '@/lib/bus/system-bus';
import type { EventSeverity } from '@/lib/types/database.types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

const DEFAULT_SYMBOLS = ['SPY', 'QQQ', 'NVDA'];
const DEFAULT_MIN_CONTRACTS = 1000;
const DEFAULT_MIN_PREMIUM_USD = 1_000_000;
const DEFAULT_MAX_AGE_MINUTES = 30;
const DEFAULT_MAX_ALERTS_PER_SCAN = 25;
const DEDUPE_WINDOW_MS = 12 * 60 * 60_000;

type OptionsFlowProvider = 'disabled' | 'intrinio' | 'mock';

export interface OptionsFlowThresholds {
  minContracts: number;
  minPremiumUsd: number;
  symbols: string[];
  provider: OptionsFlowProvider;
  configured: boolean;
  notify: boolean;
  maxAgeMinutes: number;
  maxAlertsPerScan: number;
}

export interface OptionsFlowTrade {
  source: string;
  underlying: string;
  contractSymbol: string;
  contracts: number;
  premiumUsd: number;
  averagePrice: number | null;
  tradeType: string | null;
  sideHint: string | null;
  timestamp: string;
  expiration: string | null;
  strike: number | null;
  optionType: 'CALL' | 'PUT' | null;
  dte: number | null;
  raw?: Record<string, unknown>;
}

export interface OptionsFlowAlert extends OptionsFlowTrade {
  id?: string;
  severity: EventSeverity;
  reason: string;
  dedupeKey: string;
  score: number;
  labels: string[];
  action: 'watch' | 'review' | 'urgent_review';
  validatorBrief: string;
  createdAt?: string;
}

export interface OptionsFlowScanResult {
  provider: OptionsFlowProvider;
  configured: boolean;
  scanned: number;
  candidates: number;
  inserted: number;
  skippedDuplicates: number;
  alerts: OptionsFlowAlert[];
  reason?: string;
}

function envBool(name: string, fallback = true): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseSymbols(): string[] {
  const raw = process.env.OPTIONS_FLOW_SYMBOLS ?? process.env.SYMBOL_ALLOWLIST ?? DEFAULT_SYMBOLS.join(',');
  const symbols = raw
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z]{1,6}$/.test(symbol));
  return [...new Set(symbols)].slice(0, 50);
}

function configuredProvider(): OptionsFlowProvider {
  const provider = (process.env.OPTIONS_FLOW_PROVIDER ?? 'disabled').trim().toLowerCase();
  if (provider === 'intrinio') return 'intrinio';
  if (provider === 'mock') return 'mock';
  return 'disabled';
}

export function getOptionsFlowThresholds(): OptionsFlowThresholds {
  const provider = configuredProvider();
  return {
    provider,
    symbols: parseSymbols(),
    minContracts: envNumber('OPTIONS_FLOW_MIN_CONTRACTS', DEFAULT_MIN_CONTRACTS),
    minPremiumUsd: envNumber('OPTIONS_FLOW_MIN_PREMIUM_USD', DEFAULT_MIN_PREMIUM_USD),
    configured: provider === 'intrinio' ? Boolean(process.env.INTRINIO_API_KEY?.trim()) : provider !== 'disabled',
    notify: envBool('OPTIONS_FLOW_NOTIFY', true),
    maxAgeMinutes: envNumber('OPTIONS_FLOW_MAX_AGE_MINUTES', DEFAULT_MAX_AGE_MINUTES),
    maxAlertsPerScan: Math.min(envNumber('OPTIONS_FLOW_MAX_ALERTS_PER_SCAN', DEFAULT_MAX_ALERTS_PER_SCAN), 100),
  };
}

function numberFrom(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stringFrom(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseOccSymbol(symbol: string): Pick<OptionsFlowTrade, 'expiration' | 'strike' | 'optionType' | 'dte'> {
  const match = symbol.replace(/\s+/g, '').match(/^([A-Z]{1,6})(\d{6})([CP])(\d{8})$/);
  if (!match) return { expiration: null, strike: null, optionType: null, dte: null };

  const [, , yymmdd, cp, strikeRaw] = match;
  const year = Number(`20${yymmdd.slice(0, 2)}`);
  const month = Number(yymmdd.slice(2, 4));
  const day = Number(yymmdd.slice(4, 6));
  const expiration = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const strike = Number(strikeRaw) / 1000;
  const expiryTime = Date.UTC(year, month - 1, day, 20, 0, 0);
  const dte = Math.max(0, Math.ceil((expiryTime - Date.now()) / 86_400_000));
  return { expiration, strike, optionType: cp === 'C' ? 'CALL' : 'PUT', dte };
}

function normalizeIntrinioTrade(underlying: string, row: Record<string, unknown>): OptionsFlowTrade | null {
  const contractSymbol =
    stringFrom(row.option_symbol) ??
    stringFrom(row.optionSymbol) ??
    stringFrom(row.contract_symbol) ??
    stringFrom(row.contract) ??
    stringFrom(row.symbol) ??
    underlying;
  const contracts = numberFrom(row.total_size) ?? numberFrom(row.totalSize) ?? numberFrom(row.size) ?? numberFrom(row.contracts) ?? 0;
  const premiumUsd = numberFrom(row.total_value) ?? numberFrom(row.totalValue) ?? numberFrom(row.premium) ?? 0;
  const averagePrice = numberFrom(row.average_price) ?? numberFrom(row.averagePrice) ?? numberFrom(row.price);
  if (!Number.isFinite(contracts) || contracts <= 0) return null;

  const parsed = parseOccSymbol(contractSymbol);
  return {
    source: 'intrinio',
    underlying,
    contractSymbol,
    contracts,
    premiumUsd: Number.isFinite(premiumUsd) ? premiumUsd : contracts * (averagePrice ?? 0) * 100,
    averagePrice,
    tradeType: stringFrom(row.type) ?? stringFrom(row.trade_type),
    sideHint: stringFrom(row.sentiment) ?? stringFrom(row.side) ?? null,
    timestamp: stringFrom(row.timestamp) ?? new Date().toISOString(),
    ...parsed,
    raw: row,
  };
}

async function fetchIntrinioTrades(symbols: string[]): Promise<OptionsFlowTrade[]> {
  const apiKey = process.env.INTRINIO_API_KEY?.trim();
  if (!apiKey) return [];

  const trades: OptionsFlowTrade[] = [];
  for (const symbol of symbols) {
    const url = new URL(`https://api-v2.intrinio.com/options/unusual_activity/${encodeURIComponent(symbol)}`);
    url.searchParams.set('source', 'realtime');
    url.searchParams.set('api_key', apiKey);

    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`Intrinio options flow ${symbol} failed: ${res.status}`);
    const json = (await res.json()) as { trades?: unknown[] };
    const rows = Array.isArray(json.trades) ? json.trades : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const trade = normalizeIntrinioTrade(symbol, row as Record<string, unknown>);
      if (trade) trades.push(trade);
    }
  }
  return trades;
}

function mockTrade(symbol = 'NVDA'): OptionsFlowTrade {
  const expiration = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  return {
    source: 'mock',
    underlying: symbol,
    contractSymbol: `${symbol} ${expiration} CALL`,
    contracts: 1250,
    premiumUsd: 1_125_000,
    averagePrice: 9,
    tradeType: 'BLOCK',
    sideHint: 'aggressive_call_buy',
    timestamp: new Date().toISOString(),
    expiration,
    strike: null,
    optionType: 'CALL',
    dte: 7,
  };
}

function alertSeverity(trade: OptionsFlowTrade, thresholds: OptionsFlowThresholds): EventSeverity {
  const signal = scoreTrade(trade, thresholds);
  if (signal.score >= 80 || trade.premiumUsd >= thresholds.minPremiumUsd * 2 || trade.contracts >= thresholds.minContracts * 5) return 'critical';
  return 'high';
}

function optionDirection(trade: OptionsFlowTrade): string {
  const side = trade.sideHint?.toLowerCase() ?? '';
  if (side.includes('bear') || side.includes('put_buy') || side.includes('sell_call')) return 'bearish pressure';
  if (side.includes('bull') || side.includes('call_buy') || side.includes('sell_put')) return 'bullish pressure';
  if (trade.optionType === 'CALL') return 'call-side pressure';
  if (trade.optionType === 'PUT') return 'put-side pressure';
  return 'direction unknown';
}

function scoreTrade(trade: OptionsFlowTrade, thresholds: OptionsFlowThresholds): {
  score: number;
  labels: string[];
  action: OptionsFlowAlert['action'];
} {
  const labels: string[] = [];
  let score = 0;

  const contractRatio = thresholds.minContracts > 0 ? trade.contracts / thresholds.minContracts : 0;
  const premiumRatio = thresholds.minPremiumUsd > 0 ? trade.premiumUsd / thresholds.minPremiumUsd : 0;
  score += Math.min(35, contractRatio * 18);
  score += Math.min(35, premiumRatio * 22);

  if (trade.contracts >= thresholds.minContracts) labels.push(`${thresholds.minContracts.toLocaleString()}+ contracts`);
  if (trade.premiumUsd >= thresholds.minPremiumUsd) labels.push(`$${Math.round(thresholds.minPremiumUsd).toLocaleString()}+ premium`);

  if (trade.dte === 0) {
    labels.push('0DTE');
    score += 12;
  } else if (trade.dte !== null && trade.dte <= 7) {
    labels.push('short-dated');
    score += 8;
  } else if (trade.dte !== null && trade.dte >= 90) {
    labels.push('long-dated');
    score += 4;
  }

  const type = trade.tradeType?.toLowerCase() ?? '';
  if (type.includes('sweep')) {
    labels.push('sweep');
    score += 10;
  } else if (type.includes('block')) {
    labels.push('block');
    score += 8;
  }

  const side = trade.sideHint?.toLowerCase() ?? '';
  if (side.includes('aggressive') || side.includes('bull') || side.includes('bear')) {
    labels.push('aggressor hint');
    score += 8;
  }

  if ((trade.underlying === 'SPY' || trade.underlying === 'QQQ') && trade.optionType === 'PUT' && trade.premiumUsd >= thresholds.minPremiumUsd) {
    labels.push('possible hedge');
  }

  if (trade.optionType) labels.push(trade.optionType);

  const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: normalizedScore,
    labels: [...new Set(labels)],
    action: normalizedScore >= 80 ? 'urgent_review' : normalizedScore >= 55 ? 'review' : 'watch',
  };
}

function alertReason(trade: OptionsFlowTrade): string {
  const premium = trade.premiumUsd > 0 ? ` · ~$${Math.round(trade.premiumUsd).toLocaleString()} premium` : '';
  const option = [trade.expiration, trade.optionType, trade.strike ? `$${trade.strike}` : null].filter(Boolean).join(' ');
  const dte = trade.dte === null ? '' : ` · ${trade.dte}DTE`;
  return `${trade.underlying} ${trade.tradeType ?? 'OPTION'} flow: ${trade.contracts.toLocaleString()} contracts ${trade.contractSymbol}${premium}${option ? ` · ${option}` : ''}${dte}`;
}

function validatorBrief(trade: OptionsFlowTrade, signal: ReturnType<typeof scoreTrade>): string {
  return [
    `Options-flow signal ${signal.score}/100 on ${trade.underlying}: ${alertReason(trade)}.`,
    `Interpretation: ${optionDirection(trade)}; labels=${signal.labels.join(', ') || 'none'}.`,
    'Validator task: cross-check live chart trend, VWAP/RSI/MACD, market/news context, earnings/calendar risk, spread/liquidity, and whether this could be a hedge before any strategy emits an order.',
  ].join(' ');
}

function isFreshEnough(trade: OptionsFlowTrade, thresholds: OptionsFlowThresholds): boolean {
  const timestamp = Date.parse(trade.timestamp);
  if (!Number.isFinite(timestamp)) return true;
  return Date.now() - timestamp <= thresholds.maxAgeMinutes * 60_000;
}

function toAlert(trade: OptionsFlowTrade, thresholds: OptionsFlowThresholds): OptionsFlowAlert | null {
  const qualifies = trade.contracts >= thresholds.minContracts || trade.premiumUsd >= thresholds.minPremiumUsd;
  if (!qualifies) return null;
  if (!isFreshEnough(trade, thresholds)) return null;
  const signal = scoreTrade(trade, thresholds);
  const dedupeKey = [
    trade.source,
    trade.contractSymbol,
    trade.timestamp,
    Math.round(trade.contracts),
    Math.round(trade.premiumUsd),
  ].join(':');
  return {
    ...trade,
    severity: alertSeverity(trade, thresholds),
    reason: alertReason(trade),
    dedupeKey,
    score: signal.score,
    labels: signal.labels,
    action: signal.action,
    validatorBrief: validatorBrief(trade, signal),
  };
}

async function alreadySeen(dedupeKey: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  const { data } = await db()
    .from('events')
    .select('id')
    .eq('type', 'price')
    .gte('created_at', cutoff)
    .eq('payload->>kind', 'options_flow')
    .eq('payload->>dedupeKey', dedupeKey)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

async function insertAlert(alert: OptionsFlowAlert, thresholds: OptionsFlowThresholds): Promise<string | null> {
  const payload = {
    kind: 'options_flow',
    dedupeKey: alert.dedupeKey,
    source: alert.source,
    underlying: alert.underlying,
    contractSymbol: alert.contractSymbol,
    contracts: alert.contracts,
    premiumUsd: alert.premiumUsd,
    averagePrice: alert.averagePrice,
    tradeType: alert.tradeType,
    sideHint: alert.sideHint,
    timestamp: alert.timestamp,
    expiration: alert.expiration,
    strike: alert.strike,
    optionType: alert.optionType,
    dte: alert.dte,
    reason: alert.reason,
    score: alert.score,
    labels: alert.labels,
    action: alert.action,
    validatorBrief: alert.validatorBrief,
    thresholds: {
      minContracts: thresholds.minContracts,
      minPremiumUsd: thresholds.minPremiumUsd,
      maxAgeMinutes: thresholds.maxAgeMinutes,
    },
  };

  const { data, error } = await db()
    .from('events')
    .insert({
      type: 'price',
      symbol: alert.underlying,
      severity: alert.severity,
      payload,
    })
    .select('id, created_at')
    .single();
  if (error) throw new Error(error.message ?? 'options flow event insert failed');

  const id = (data as { id: string }).id;
  await publishBusEvent({
    topic: 'agent.thought',
    agent: 'options-flow',
    payload: {
      event: 'options_flow.alert',
      preview: alert.reason,
      model: 'deterministic-scanner',
      ...payload,
    },
  });

  await hermesLog('warn', `[OPTIONS-FLOW] ${alert.reason}`);
  if (thresholds.notify) {
    await notify(`⚡ OPTIONS FLOW: ${alert.reason}`);
  }
  return id;
}

export async function scanOptionsFlow(options: { simulate?: boolean } = {}): Promise<OptionsFlowScanResult> {
  const thresholds = getOptionsFlowThresholds();
  if (!options.simulate && (!thresholds.configured || thresholds.provider === 'disabled')) {
    return {
      provider: thresholds.provider,
      configured: thresholds.configured,
      scanned: 0,
      candidates: 0,
      inserted: 0,
      skippedDuplicates: 0,
      alerts: [],
      reason: 'options flow provider disabled or missing credentials',
    };
  }

  try {
    const trades =
      options.simulate || thresholds.provider === 'mock'
        ? [mockTrade(thresholds.symbols[0] ?? 'NVDA')]
        : await fetchIntrinioTrades(thresholds.symbols);
    const candidates = trades
      .map((trade) => toAlert(trade, thresholds))
      .filter((alert): alert is OptionsFlowAlert => Boolean(alert))
      .sort((a, b) => b.score - a.score || b.premiumUsd - a.premiumUsd)
      .slice(0, thresholds.maxAlertsPerScan);
    const inserted: OptionsFlowAlert[] = [];
    let skippedDuplicates = 0;

    for (const alert of candidates) {
      if (await alreadySeen(alert.dedupeKey)) {
        skippedDuplicates++;
        continue;
      }
      const id = await insertAlert(alert, thresholds);
      inserted.push({ ...alert, ...(id ? { id } : {}) });
    }

    return {
      provider: thresholds.provider,
      configured: thresholds.configured,
      scanned: trades.length,
      candidates: candidates.length,
      inserted: inserted.length,
      skippedDuplicates,
      alerts: inserted,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await hermesLog('error', `[OPTIONS-FLOW] scan failed: ${message.replace(/\s+/g, ' ').slice(0, 180)}`);
    return {
      provider: thresholds.provider,
      configured: thresholds.configured,
      scanned: 0,
      candidates: 0,
      inserted: 0,
      skippedDuplicates: 0,
      alerts: [],
      reason: message,
    };
  }
}

export async function getRecentOptionsFlowAlerts(limit = 20): Promise<OptionsFlowAlert[]> {
  const { data, error } = await db()
    .from('events')
    .select('id, symbol, severity, payload, created_at')
    .eq('type', 'price')
    .eq('payload->>kind', 'options_flow')
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error) throw new Error(error.message ?? 'options flow read failed');

  return ((data ?? []) as Array<{ id: string; symbol: string | null; severity: EventSeverity | null; payload: Record<string, unknown>; created_at: string }>).map((row) => {
    const payload = row.payload ?? {};
    return {
      id: row.id,
      source: stringFrom(payload.source) ?? 'unknown',
      underlying: stringFrom(payload.underlying) ?? row.symbol ?? 'UNKNOWN',
      contractSymbol: stringFrom(payload.contractSymbol) ?? 'unknown contract',
      contracts: numberFrom(payload.contracts) ?? 0,
      premiumUsd: numberFrom(payload.premiumUsd) ?? 0,
      averagePrice: numberFrom(payload.averagePrice),
      tradeType: stringFrom(payload.tradeType),
      sideHint: stringFrom(payload.sideHint),
      timestamp: stringFrom(payload.timestamp) ?? row.created_at,
      expiration: stringFrom(payload.expiration),
      strike: numberFrom(payload.strike),
      optionType: payload.optionType === 'CALL' || payload.optionType === 'PUT' ? payload.optionType : null,
      dte: numberFrom(payload.dte),
      severity: row.severity ?? 'high',
      reason: stringFrom(payload.reason) ?? 'options flow alert',
      dedupeKey: stringFrom(payload.dedupeKey) ?? row.id,
      score: numberFrom(payload.score) ?? 0,
      labels: Array.isArray(payload.labels) ? payload.labels.filter((label): label is string => typeof label === 'string') : [],
      action: payload.action === 'urgent_review' || payload.action === 'review' || payload.action === 'watch' ? payload.action : 'review',
      validatorBrief: stringFrom(payload.validatorBrief) ?? stringFrom(payload.reason) ?? 'Review this options-flow signal.',
      createdAt: row.created_at,
    };
  });
}
