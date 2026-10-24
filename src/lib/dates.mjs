// Source timestamps may be UTC, offset-bearing, or bare Dehradun local dates/times.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;
const DAY_MS = 24 * 3600_000;

export function toInstant(value) {
  if (DATE_ONLY.test(value)) return new Date(`${value}T00:00:00+05:30`);
  return new Date(HAS_ZONE.test(value) ? value : `${value}+05:30`);
}

/** Calendar day in Dehradun, including instants written with a different offset. */
export function istDay(value = '') {
  if (DATE_ONLY.test(value)) return value;
  const time = toInstant(value).getTime();
  return Number.isFinite(time) ? new Date(time + 5.5 * 3600_000).toISOString().slice(0, 10) : value.slice(0, 10);
}

export const compareEventStarts = (a, b) => toInstant(a.startAt).getTime() - toInstant(b.startAt).getTime();

/** Date-only end dates are inclusive, as in the calendar feeds. */
export function isUnexpiredEvent(event, now = Date.now()) {
  const start = toInstant(event.startAt).getTime();
  if (!Number.isFinite(start)) return false;
  if (DATE_ONLY.test(event.startAt)) {
    const last = DATE_ONLY.test(event.endAt) && event.endAt > event.startAt ? event.endAt : event.startAt;
    return toInstant(last).getTime() + DAY_MS > now;
  }
  // Preserve the six-hour grace after a timed start, and keep longer events until they end.
  const end = event.endAt ? toInstant(event.endAt).getTime() : NaN;
  return Math.max(start + 6 * 3600_000, Number.isFinite(end) ? end : start) > now;
}
