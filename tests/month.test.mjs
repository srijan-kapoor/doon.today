import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  dayLabel, dotsFor, eventDayRange, eventsOn, monthBounds, monthGrid, parseMonthState, stripDays, withMonthState, DOT_LIMIT, mondayIndex,
} from '../src/lib/month.mjs';

const inZone = (timezone, fn) => (t) => {
  const previous = process.env.TZ;
  t.after(() => { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; });
  process.env.TZ = timezone;
  return fn(t);
};

test('the date strip is today plus 13 days across a month end, whatever the browser timezone', inZone('America/Los_Angeles', () => {
  const days = stripDays('2026-10-27');
  assert.equal(days.length, 14);
  assert.equal(days[0], '2026-10-27');
  assert.equal(days[5], '2026-11-01');
  assert.equal(days.at(-1), '2026-11-09');
}));

test('the month grid starts on Monday, so Saturday and Sunday are the last two columns', inZone('Pacific/Kiritimati', () => {
  const weeks = monthGrid('2026-10');
  assert.ok(weeks.every((week) => week.length === 7));
  assert.deepEqual(weeks[0], [null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  assert.equal(mondayIndex('2026-10-31'), 5);
  assert.equal(weeks.at(-1)[5], '2026-10-31');
  assert.equal(weeks.at(-1)[6], null);
  assert.equal(weeks.flat().filter(Boolean).length, 31);
  assert.equal(monthGrid('2026-02').flat().filter(Boolean).length, 28);
  assert.equal(monthGrid('2026-12').flat().filter(Boolean).at(-1), '2026-12-31');
}));

test('dots: one per event, a "+" after 4 on the strip and 8 on the grid, none on an empty day', () => {
  assert.deepEqual(dotsFor(0, DOT_LIMIT.strip), { dots: 0, overflow: false });
  assert.deepEqual(dotsFor(3, DOT_LIMIT.strip), { dots: 3, overflow: false });
  assert.deepEqual(dotsFor(4, DOT_LIMIT.strip), { dots: 4, overflow: false });
  assert.deepEqual(dotsFor(5, DOT_LIMIT.strip), { dots: 4, overflow: true });
  assert.deepEqual(dotsFor(8, DOT_LIMIT.grid), { dots: 8, overflow: false });
  assert.deepEqual(dotsFor(11, DOT_LIMIT.grid), { dots: 8, overflow: true });
});

test('day labels read like "Sat 31 Oct, 11 events"', () => {
  assert.equal(dayLabel('2026-10-31', 11).text, 'Sat 31 Oct, 11 events');
  assert.equal(dayLabel('2026-10-31', 1).text, 'Sat 31 Oct, 1 event');
  assert.equal(dayLabel('2026-10-31', 0).text, 'Sat 31 Oct, no events');
});

test('event day ranges: date-only ends inclusive, timed ends exclusive, early-morning ends count as the night before', inZone('America/Los_Angeles', () => {
  assert.deepEqual(eventDayRange({ startAt: '2026-11-02', endAt: '2026-11-13' }), { start: '2026-11-02', end: '2026-11-13' });
  assert.deepEqual(eventDayRange({ startAt: '2026-11-02' }), { start: '2026-11-02', end: '2026-11-02' });
  assert.deepEqual(eventDayRange({ startAt: '2026-11-02T10:00:00', endAt: '2026-11-04T18:00:00' }), { start: '2026-11-02', end: '2026-11-04' });
  assert.deepEqual(eventDayRange({ startAt: '2026-11-02T10:00:00', endAt: '2026-11-04T00:00:00' }), { start: '2026-11-02', end: '2026-11-03' });
  assert.deepEqual(eventDayRange({ startAt: '2026-11-02T21:00:00', endAt: '2026-11-03T01:00:00' }), { start: '2026-11-02', end: '2026-11-02' });
  assert.deepEqual(eventDayRange({ startAt: '2026-11-02T21:00:00', endAt: '2026-11-03T06:00:00' }), { start: '2026-11-02', end: '2026-11-03' });
  assert.deepEqual(eventDayRange({ startAt: '2026-11-02T21:00:00+05:30', endAt: '2026-11-03T01:00:00+00:00' }), { start: '2026-11-02', end: '2026-11-03' });
  assert.deepEqual(eventDayRange({ startAt: '2026-11-05', endAt: '2026-11-03' }), { start: '2026-11-05', end: '2026-11-05' });
}));

const make = (start, end, extra = {}) => ({ range: eventDayRange({ startAt: start, endAt: end }), categories: ['music'], price: 'paid', area: 'rajpur', ...extra });

test('a multi-day event shows on each of its days and no others', () => {
  const items = [make('2026-11-02', '2026-11-13'), make('2026-11-05T19:00:00')];
  const count = (day) => eventsOn(items, day, {}).length;
  assert.deepEqual(['2026-11-01', '2026-11-02', '2026-11-05', '2026-11-13', '2026-11-14'].map(count), [0, 1, 2, 1, 0]);
});

test('Category, Free only and Area change which events a day has, and so its dots and list', () => {
  const items = [
    make('2026-11-05T19:00:00', undefined, { categories: ['music'], price: 'free', area: 'rajpur' }),
    make('2026-11-05T20:00:00', undefined, { categories: ['comedy'], price: 'paid', area: 'rajpur' }),
    make('2026-11-05T21:00:00', undefined, { categories: ['music'], price: 'paid', area: 'sahastradhara' }),
  ];
  const n = (state) => eventsOn(items, '2026-11-05', state).length;
  assert.equal(n({}), 3);
  assert.equal(n({ category: 'music' }), 2);
  assert.equal(n({ price: 'free' }), 1);
  assert.equal(n({ area: 'rajpur' }), 2);
  assert.equal(n({ category: 'music', area: 'rajpur', price: 'free' }), 1);
  assert.equal(n({ category: 'comedy', price: 'free' }), 0);
});

test('?view=month&date=… opens that view and day; bad input falls back to today; links keep other filters', () => {
  const today = '2026-10-27';
  const bounds = monthBounds([make('2026-11-02', '2026-12-20')], today);
  assert.deepEqual(bounds, { min: '2026-10', max: '2026-12' });
  assert.deepEqual(parseMonthState('', today, bounds), { view: 'list', date: today });
  assert.deepEqual(parseMonthState('?date=2026-10-31', today, bounds), { view: 'list', date: today });
  assert.deepEqual(parseMonthState('?view=month&date=2026-10-31', today, bounds), { view: 'month', date: '2026-10-31' });
  for (const date of ['', 'nope', '2026-02-30', '2026-10-26', '2027-03-01']) {
    assert.deepEqual(parseMonthState(`?view=month&date=${date}`, today, bounds), { view: 'month', date: today }, date);
  }
  assert.equal(withMonthState('?category=music', 'month', '2026-10-31'), 'category=music&view=month&date=2026-10-31');
  assert.equal(withMonthState('?category=music&view=month&date=2026-10-31', 'list', '2026-10-31'), 'category=music');
});

test('the page wires the switch, hides the date filters in Month view and keeps the view in the URL', async () => {
  const page = await readFile(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
  assert.match(page, /data-view="list"[\s\S]*data-view="month"/);
  assert.match(page, /Nothing listed for this day yet\. Know of something\?/);
  assert.match(page, /More dots, busier day/);
  const css = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  const month = css.slice(css.indexOf('/* List | Month view */'));
  assert.doesNotMatch(month.replace(/var\([^)]*\)/g, ''), /#[0-9a-f]{3,8}\b|rgba?\(/i, 'the Month view uses only CSS tokens');
});
