// Pure date and filter logic for the home page's Month view. All days are IST calendar days as
// YYYY-MM-DD strings and all arithmetic is done in UTC on those strings, so the visitor's timezone never matters.
import { toInstant, istDay } from './dates.mjs';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 3600_000;
// A timed end before this hour (IST) belongs to the night before: a 9pm show ending at 1am is one evening.
const NIGHT_ENDS_BEFORE_HOUR = 6;

export const STRIP_DAYS = 14;
export const DOT_LIMIT = { strip: 4, grid: 8 };

const utc = (day) => Date.parse(`${day}T00:00:00Z`);
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (day, n) => fromUtc(utc(day) + n * DAY_MS);

/** 0 = Monday … 6 = Sunday. */
export const mondayIndex = (day) => (new Date(utc(day)).getUTCDay() + 6) % 7;

/**
 * The inclusive IST days an event runs. Date-only ends are inclusive, timed ends are exclusive, and a timed end
 * before 6am counts as the night before. This mirrors eventDayRange() in open PR #34 (#22); once that lands,
 * import it from dates.mjs instead and delete this copy.
 */
export function eventDayRange(event) {
  const start = istDay(event.startAt);
  const endTime = event.endAt ? toInstant(event.endAt).getTime() : NaN;
  if (!Number.isFinite(endTime) || !Number.isFinite(toInstant(event.startAt).getTime())) return { start, end: start };
  let end;
  if (DATE_ONLY.test(event.endAt)) end = event.endAt;
  else {
    const local = new Date(endTime + 5.5 * 3600_000);
    end = istDay(new Date(endTime).toISOString());
    if (local.getUTCHours() < NIGHT_ENDS_BEFORE_HOUR) end = addDays(end, -1);
  }
  return { start, end: end > start ? end : start };
}

export const runsOn = (range, day) => range.start <= day && day <= range.end;

/** Today plus the next 13 days. */
export const stripDays = (today) => Array.from({ length: STRIP_DAYS }, (_, i) => addDays(today, i));

export const monthOf = (day) => day.slice(0, 7);
export const shiftMonth = (month, n) => {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
};

/** Weeks of 7 cells, Monday first; cells outside the month are null. */
export function monthGrid(month) {
  const first = `${month}-01`;
  const nextFirst = `${shiftMonth(month, 1)}-01`;
  const length = Math.round((utc(nextFirst) - utc(first)) / DAY_MS);
  const cells = [...Array(mondayIndex(first)).fill(null), ...Array.from({ length }, (_, i) => addDays(first, i))];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** Dots for a day: one per event up to the limit, then a "+". */
export const dotsFor = (count, limit) => ({ dots: Math.min(count, limit), overflow: count > limit });

export function dayLabel(day, count) {
  const date = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${day}T12:00:00Z`)).replace(',', '');
  return { date, text: `${date}, ${count === 0 ? 'no events' : count === 1 ? '1 event' : `${count} events`}` };
}

/** Category, Free only and Area, the filters that stay on in Month view. `item` has categories[], price, area. */
export const matchesFilters = (item, state) =>
  (!state.category || item.categories.includes(state.category))
  && (!state.price || item.price === state.price)
  && (!state.area || item.area === state.area);

/** Events running on `day` that pass the filters. `items` are { range, categories, price, area }. */
export const eventsOn = (items, day, state) => items.filter((item) => runsOn(item.range, day) && matchesFilters(item, state));

/** The last month the grid can show: the latest month with an event, never before this month. */
export const monthBounds = (items, today) => ({
  min: monthOf(today),
  max: items.reduce((max, item) => (monthOf(item.range.end) > max ? monthOf(item.range.end) : max), monthOf(today)),
});

/** `?view=month&date=…`. A missing, malformed, past or out-of-range date falls back to today. */
export function parseMonthState(search, today, bounds) {
  const params = new URLSearchParams(search);
  if (params.get('view') !== 'month') return { view: 'list', date: today };
  const date = params.get('date') ?? '';
  const valid = DATE_ONLY.test(date) && fromUtc(utc(date)) === date && date >= today && monthOf(date) <= bounds.max;
  return { view: 'month', date: valid ? date : today };
}

/** Writes the view and day into an existing query, leaving the other filters alone. */
export function withMonthState(search, view, date) {
  const params = new URLSearchParams(search);
  params.delete('view');
  params.delete('date');
  if (view === 'month') {
    params.set('view', 'month');
    params.set('date', date);
  }
  return params.toString();
}
