// node --test omnigent/wrapper/market-hours.test.mjs
// Real Intl, real IANA zone, fixed instants — no mocked clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nyseSession, isMarketOpen, etClock } from './market-hours.mjs';

const at = (iso) => new Date(iso);

test('summer (EDT, UTC-4) session boundaries — Fri 2026-07-10', () => {
  assert.equal(isMarketOpen(at('2026-07-10T13:29:00Z')), false, '09:29 ET → closed');
  assert.equal(isMarketOpen(at('2026-07-10T13:30:00Z')), true, '09:30 ET → open');
  assert.equal(isMarketOpen(at('2026-07-10T17:00:00Z')), true, '13:00 ET → open');
  assert.equal(isMarketOpen(at('2026-07-10T19:59:00Z')), true, '15:59 ET → open');
  assert.equal(isMarketOpen(at('2026-07-10T20:00:00Z')), false, '16:00 ET → closed (half-open interval)');
});

test('winter (EST, UTC-5) session boundaries — Mon 2026-01-05', () => {
  assert.equal(isMarketOpen(at('2026-01-05T14:29:00Z')), false, '09:29 ET → closed');
  assert.equal(isMarketOpen(at('2026-01-05T14:30:00Z')), true, '09:30 ET → open');
  assert.equal(isMarketOpen(at('2026-01-05T21:00:00Z')), false, '16:00 ET → closed');
});

test('weekends are always closed', () => {
  assert.equal(isMarketOpen(at('2026-07-11T17:00:00Z')), false, 'Saturday midday');
  assert.equal(isMarketOpen(at('2026-07-12T17:00:00Z')), false, 'Sunday midday');
});

test('overnight / pre-market is closed', () => {
  assert.equal(isMarketOpen(at('2026-07-10T04:00:00Z')), false, '00:00 ET');
  assert.equal(isMarketOpen(at('2026-07-10T11:00:00Z')), false, '07:00 ET pre-market');
});

test('session metadata + clock formatting', () => {
  const s = nyseSession(at('2026-07-10T17:05:00Z'));
  assert.equal(s.weekday, 'Fri');
  assert.equal(s.etMinutes, 13 * 60 + 5);
  assert.equal(etClock(at('2026-07-10T17:05:00Z')), '13:05 ET');
  assert.equal(etClock(at('2026-07-10T04:00:00Z')), '00:00 ET', 'midnight is 00:00 not 24:00');
});
