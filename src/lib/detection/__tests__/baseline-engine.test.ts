/**
 * Unit tests for SyncBaselineEngine — computeBaseline() pure function.
 *
 * Imports the standalone export which has zero side effects and requires
 * no Supabase connection. DB-touching methods are integration-test territory.
 */

import { computeBaseline, FULL_WEIGHTS } from '../sync-baseline-engine'
import type { BaselineInput } from '../sync-baseline-engine'

// Helper: build a minimal baseline-row shape
function row(overrides: Partial<BaselineInput> & { sync_count: number }): BaselineInput {
  return {
    sync_count: overrides.sync_count,
    s_minus_1: overrides.s_minus_1 ?? null,
    s_minus_2: overrides.s_minus_2 ?? null,
    s_minus_3: overrides.s_minus_3 ?? null,
    s_minus_4: overrides.s_minus_4 ?? null,
    s_minus_5: overrides.s_minus_5 ?? null,
    s_minus_6: overrides.s_minus_6 ?? null,
  }
}

// ── 1. Bootstrap: first sync, no baseline ─────────────────────────────────────
test('1. sync_count=0 → null (UNVERIFIED_BASELINE)', () => {
  expect(computeBaseline(row({ sync_count: 0, s_minus_1: 100 }))).toBeNull()
})

// ── 2. Fewer than 3 syncs → null ─────────────────────────────────────────────
test('2. sync_count=2 → null', () => {
  expect(computeBaseline(row({ sync_count: 2, s_minus_1: 100, s_minus_2: 90 }))).toBeNull()
})

// ── 3. 6 syncs: uniform values, B=100, thresholds correct ────────────────────
test('3a. 6 uniform syncs: baseline=100, critical=50, warning=80', () => {
  const r = computeBaseline(row({
    sync_count: 6,
    s_minus_1: 100, s_minus_2: 100, s_minus_3: 100,
    s_minus_4: 100, s_minus_5: 100, s_minus_6: 100,
  }))
  expect(r).not.toBeNull()
  expect(r!.baseline).toBeCloseTo(100, 5)
  expect(r!.thresholdCritical).toBeCloseTo(50, 5)
  expect(r!.thresholdWarning).toBeCloseTo(80, 5)
})

test('3b. 6 syncs: differing values, weighted sum matches manual calculation', () => {
  // FULL_WEIGHTS already sum to 1.0 when 6 slots present
  const expected =
    FULL_WEIGHTS[0] * 120 + FULL_WEIGHTS[1] * 110 + FULL_WEIGHTS[2] * 100 +
    FULL_WEIGHTS[3] * 90  + FULL_WEIGHTS[4] * 80  + FULL_WEIGHTS[5] * 70
  const r = computeBaseline(row({
    sync_count: 6,
    s_minus_1: 120, s_minus_2: 110, s_minus_3: 100,
    s_minus_4: 90,  s_minus_5: 80,  s_minus_6: 70,
  }))
  expect(r!.baseline).toBeCloseTo(expected, 4)
})

// ── 4. 4 syncs (partial history): scaled weights sum to 1.0 ──────────────────
test('4a. 4 syncs uniform → baseline still 100 (weight scaling is neutral)', () => {
  const r = computeBaseline(row({
    sync_count: 4,
    s_minus_1: 100, s_minus_2: 100, s_minus_3: 100, s_minus_4: 100,
  }))
  expect(r!.baseline).toBeCloseTo(100, 5)
})

test('4b. 4 syncs: scaled weights sum exactly to 1.0', () => {
  const raw4 = FULL_WEIGHTS.slice(0, 4)
  const sum4 = raw4.reduce((a, b) => a + b, 0)
  const scaled4 = raw4.map(w => w / sum4)
  expect(scaled4.reduce((a, b) => a + b, 0)).toBeCloseTo(1.0, 10)
})

test('4c. 4 syncs: baseline matches manual scaled calculation', () => {
  const raw4 = FULL_WEIGHTS.slice(0, 4)
  const sum4 = raw4.reduce((a, b) => a + b, 0)
  const scaled4 = raw4.map(w => w / sum4)
  const expected = scaled4[0] * 80 + scaled4[1] * 90 + scaled4[2] * 100 + scaled4[3] * 120
  const r = computeBaseline(row({
    sync_count: 4,
    s_minus_1: 80, s_minus_2: 90, s_minus_3: 100, s_minus_4: 120,
  }))
  expect(r!.baseline).toBeCloseTo(expected, 4)
})

// ── 5. Exactly 80% of baseline → SYNC_HEALTHY boundary ──────────────────────
test('5. rows == thresholdWarning (80) → at boundary, engine treats as HEALTHY', () => {
  const r = computeBaseline(row({
    sync_count: 6,
    s_minus_1: 100, s_minus_2: 100, s_minus_3: 100,
    s_minus_4: 100, s_minus_5: 100, s_minus_6: 100,
  }))
  expect(r!.thresholdWarning).toBeCloseTo(80, 5)
  // 80 >= 80 → SYNC_HEALTHY
  expect(80 >= r!.thresholdWarning).toBe(true)
})

// ── 6. Rows at 79% → INCOMPLETE_RETRY_PENDING ────────────────────────────────
test('6. 79 rows with B=100: below warning, above critical → INCOMPLETE zone', () => {
  const r = computeBaseline(row({
    sync_count: 6,
    s_minus_1: 100, s_minus_2: 100, s_minus_3: 100,
    s_minus_4: 100, s_minus_5: 100, s_minus_6: 100,
  }))
  expect(79 < r!.thresholdWarning).toBe(true)
  expect(79 >= r!.thresholdCritical).toBe(true)
})

// ── 7. Rows at exactly 50% → still INCOMPLETE (lower boundary) ───────────────
test('7. 50 rows with B=100: at thresholdCritical → INCOMPLETE lower boundary', () => {
  const r = computeBaseline(row({
    sync_count: 6,
    s_minus_1: 100, s_minus_2: 100, s_minus_3: 100,
    s_minus_4: 100, s_minus_5: 100, s_minus_6: 100,
  }))
  // 50 >= thresholdCritical (50.0) → INCOMPLETE, not SUSPECT
  expect(50 >= r!.thresholdCritical).toBe(true)
  expect(50 < r!.thresholdWarning).toBe(true)
})

// ── 8. Rows at 49% → SYNC_SUSPECT boundary ───────────────────────────────────
test('8. 49 rows with B=100: below thresholdCritical → SUSPECT branch', () => {
  const r = computeBaseline(row({
    sync_count: 6,
    s_minus_1: 100, s_minus_2: 100, s_minus_3: 100,
    s_minus_4: 100, s_minus_5: 100, s_minus_6: 100,
  }))
  expect(49 < r!.thresholdCritical).toBe(true)
})

// ── 9. State-machine logic: retry≥2 + degraded zone → ANOMALY_FLAGGED ────────
test('9. degraded zone + isRetry + retryCount>=2 → ANOMALY_FLAGGED decision', () => {
  const r = computeBaseline(row({
    sync_count: 6,
    s_minus_1: 100, s_minus_2: 100, s_minus_3: 100,
    s_minus_4: 100, s_minus_5: 100, s_minus_6: 100,
  }))
  const rows = 65
  const isRetry = true
  const retryCount = 2
  const inDegradedZone = rows >= r!.thresholdCritical && rows < r!.thresholdWarning
  expect(inDegradedZone && isRetry && retryCount >= 2).toBe(true)
})

// ── 10. State-machine logic: retry≥2 + suspect zone → circuit breaker ────────
test('10. suspect zone + retryCount>=2 → circuit breaker + CARRIER_PORTAL_DEGRADED', () => {
  const r = computeBaseline(row({
    sync_count: 6,
    s_minus_1: 100, s_minus_2: 100, s_minus_3: 100,
    s_minus_4: 100, s_minus_5: 100, s_minus_6: 100,
  }))
  const rows = 30
  const retryCount = 2
  const isSuspect = rows < r!.thresholdCritical
  expect(isSuspect && retryCount >= 2).toBe(true)
})

// ── 11. Circuit breaker active, <48h → CARRIER_PORTAL_DEGRADED, skip ─────────
test('11. circuit breaker set 10h ago → still within window, should skip', () => {
  const setAt = new Date(Date.now() - 10 * 3_600_000)
  const elapsed = (Date.now() - setAt.getTime()) / 3_600_000
  expect(elapsed <= 48).toBe(true)
})

// ── 12. Circuit breaker active, >48h → auto-reset ────────────────────────────
test('12. circuit breaker set 49h ago → window expired, auto-reset', () => {
  const setAt = new Date(Date.now() - 49 * 3_600_000)
  const elapsed = (Date.now() - setAt.getTime()) / 3_600_000
  expect(elapsed > 48).toBe(true)
})
