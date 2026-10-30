// Pure date and filter logic for the home page's Month view. All days are IST calendar days as
// YYYY-MM-DD strings and all arithmetic is done in UTC on those strings, so the visitor's timezone never matters.
import { eventDayRange, DATE_ONLY } from './dates.mjs';
import { addDays, mondayIndex, runsOn } from './month-dates.mjs';
import { matchesPreferences } from './filters.mjs';
export { eventDayRange };
export { addDays, mondayIndex, runsOn };

const DAY_MS = 24 * 3600_000;

const STRIP_DAYS = 14;
export const DOT_LIMIT = { strip: 4, grid: 8 };

const utc = (day) => Date.parse(`${day}T00:00:00Z`);
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
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
export const matchesFilters = matchesPreferences;

/** Events running on `day` that pass the filters. `items` are { range, categories, price, area, community }. */
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
