import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { changelogByMonth, changelogErrors, dayLabel } from '../src/lib/changelog.mjs';

const entries = JSON.parse(await readFile(new URL('../src/data/changelog.json', import.meta.url), 'utf8'));

test('every changelog entry has a real date, a known tag and some text, newest first', () => {
  assert.ok(entries.length > 0);
  assert.deepEqual(changelogErrors(entries), []);
});

test('bad entries are reported', () => {
  const errors = changelogErrors([
    { date: '2026-10-01', tag: 'New', text: 'ok' },
    { date: '2026-10-05', tag: 'New', text: 'newer than the one above' },
    { date: '2026-02-30', tag: 'Fixed', text: 'no such day' },
    { date: '2026-01-01', tag: 'Misc', text: '  ' }
  ]);
  assert.deepEqual(errors, [
    'entry 2: newer than the entry above it',
    'entry 3: date must be a real YYYY-MM-DD day',
    'entry 4: tag must be one of New, Improved, Fixed, Source, Removed',
    'entry 4: text is empty'
  ]);
});

test('entries group by month in their own order, with labels that ignore the timezone', (t) => {
  const previous = process.env.TZ;
  t.after(() => { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; });
  process.env.TZ = 'America/Los_Angeles';
  const groups = changelogByMonth([
    { date: '2026-11-01', tag: 'New', text: 'a' },
    { date: '2026-10-31', tag: 'Fixed', text: 'b' },
    { date: '2026-10-01', tag: 'Fixed', text: 'c' }
  ]);
  assert.deepEqual(groups.map((g) => [g.month, g.label, g.entries.map((e) => e.text).join('')]), [
    ['2026-11', 'November 2026', 'a'],
    ['2026-10', 'October 2026', 'bc']
  ]);
  assert.equal(dayLabel('2026-10-01'), '1 Oct');
});
