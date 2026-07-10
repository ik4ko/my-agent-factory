// NYSE regular-session clock, dependency-free.
//
// Regular hours: Mon–Fri, 09:30–16:00 America/New_York. DST is handled by the
// IANA zone (never by a fixed UTC offset).
//
// KNOWN LIMITS (deliberate, flagged rather than faked): market holidays and
// early-close days (1pm half-days) are NOT modeled — there is no holiday
// calendar in this repo. The heartbeat may therefore ping on a market holiday
// that falls on a weekday. It is notify-only, so the failure mode is one
// unnecessary message, never a trade.

/** Wall-clock ET parts for an instant, via the IANA zone. */
function etParts(now) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  return { weekday: p.weekday, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

const OPEN_MIN = 9 * 60 + 30; // 09:30 ET
const CLOSE_MIN = 16 * 60; // 16:00 ET

/** { open, weekday, etMinutes } for the given instant (defaults to now). */
export function nyseSession(now = new Date()) {
  const { weekday, minutes } = etParts(now);
  const isWeekday = weekday !== 'Sat' && weekday !== 'Sun';
  return {
    open: isWeekday && minutes >= OPEN_MIN && minutes < CLOSE_MIN,
    weekday,
    etMinutes: minutes,
  };
}

/** Convenience: is the NYSE regular session open right now? */
export function isMarketOpen(now = new Date()) {
  return nyseSession(now).open;
}

/** "HH:MM ET" for logs/messages. */
export function etClock(now = new Date()) {
  const { minutes } = etParts(now);
  const h = String(Math.floor(minutes / 60)).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  return `${h}:${m} ET`;
}
