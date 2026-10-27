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

/**
 * Inclusive IST listing days; timed ends before 6am belong to the previous night. An event on specific dates
 * (`occurrences`) also gets `days`, the days it is actually on: start..end is then only its outer span.
 */
export function eventDayRange(event) {
  const days = occurrenceDays(event);
  if (days) return { start: days[0], end: days.at(-1), days };
  const startTime = toInstant(event.startAt).getTime();
  if (!Number.isFinite(startTime)) return { start: '', end: '' };
  const start = istDay(event.startAt);
  const endTime = event.endAt ? toInstant(event.endAt).getTime() : NaN;
  if (!Number.isFinite(endTime)) return { start, end: start };
  const end = DATE_ONLY.test(event.endAt)
    ? event.endAt
    : istDay(new Date(endTime - 6 * 3600_000).toISOString());
  return { start, end: end > start ? end : start };
}

/** Running events belong to today; events that finished on a past day are omitted. */
export function eventDisplayDay(event, today) {
  const { start, end, days } = eventDayRange(event);
  if (days) return days.find((day) => day >= today) ?? null;
  return end < today ? null : start < today ? today : start;
}

/**
 * The start of every session of an event that runs on specific dates rather than continuously (`occurrences`),
 * oldest first, or null for an ordinary event. Anything that does not hold together (fewer than two dates, a bad
 * timestamp, a list that does not begin at startAt, dates mixing bare days and times) counts as no list, so a
 * bad value falls back to start..end rather than to wrong dates. For such an event startAt..endAt is only the
 * outer span: do not read it as a continuous run.
 */
export function occurrencesOf(event) {
  const list = event?.occurrences;
  if (!Array.isArray(list) || list.length < 2 || !event.startAt) return null;
  const bare = DATE_ONLY.test(event.startAt);
  const times = list.map((value) => (typeof value === 'string' && DATE_ONLY.test(value) === bare ? toInstant(value).getTime() : NaN));
  if (times.some((time, i) => !Number.isFinite(time) || (i > 0 && time <= times[i - 1]))) return null;
  return times[0] === toInstant(event.startAt).getTime() ? [...list] : null;
}

/** The first session starting at or after `now`, else the last one; the start itself for an ordinary event. */
export function nextOccurrence(event, now = Date.now()) {
  const list = occurrencesOf(event);
  if (!list) return event.startAt;
  return list.find((value) => toInstant(value).getTime() >= now) ?? list.at(-1);
}

/** The Dehradun calendar days an event with `occurrences` is on, or null for an ordinary event. */
export function occurrenceDays(event) {
  const list = occurrencesOf(event);
  return list ? [...new Set(list.map(istDay))] : null;
}

/** Date-only end dates are inclusive, as in the calendar feeds. */
export function isUnexpiredEvent(event, now = Date.now()) {
  const sessions = occurrencesOf(event);
  // The last session decides when an event on specific dates is over; its end, if known, is endAt.
  const start = toInstant(sessions ? sessions.at(-1) : event.startAt).getTime();
  if (!Number.isFinite(start)) return false;
  if (DATE_ONLY.test(event.startAt)) {
    const lastStart = sessions ? sessions.at(-1) : event.startAt;
    const last = DATE_ONLY.test(event.endAt) && event.endAt > lastStart ? event.endAt : lastStart;
    return toInstant(last).getTime() + DAY_MS > now;
  }
  // Preserve the six-hour grace after a timed start, and keep longer events until they end.
  const end = event.endAt ? toInstant(event.endAt).getTime() : NaN;
  return Math.max(start + 6 * 3600_000, Number.isFinite(end) ? end : start) > now;
}
