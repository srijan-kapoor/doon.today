import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pastEvents, endedAt, KEEP_DAYS, PAST_PATH } from '../ingest/lib/past.mjs';
import { mergeAndWrite } from '../ingest/merge.mjs';
import { inTempDir } from './helpers.mjs';

const NOW = Date.parse('2026-11-09T12:00:00+05:30');
const event = (over = {}) => ({
  id: 'k', slug: 'kukur-diwas', title: 'Kukur diwas', startAt: '2026-11-07T11:30:00+05:30', endAt: '2026-11-07T14:00:00+05:30',
  venue: { name: 'Samarth NGO', city: 'Dehradun' }, categories: ['Culture'], curation: { status: 'published', score: 5 },
  sources: [{ provider: 'manual', url: 'https://example.test/k' }], ...over
});

test('an event that ended stays as a past event, newest first', () => {
  const older = event({ slug: 'older', startAt: '2026-11-01T10:00:00+05:30', endAt: undefined });
  const past = pastEvents({ previous: [older, event()], now: NOW });
  assert.deepEqual(past.map((e) => e.slug), ['kukur-diwas', 'older']);
  assert.equal(endedAt(event()), Date.parse('2026-11-07T14:00:00+05:30'));
});

test('upcoming, listed again, rejected, out-of-area or long-ended events are not kept', () => {
  const upcoming = event({ slug: 'soon', startAt: '2026-11-20T10:00:00+05:30', endAt: undefined });
  const longAgo = event({ slug: 'old', startAt: '2026-07-01T10:00:00+05:30', endAt: undefined });
  const abroad = event({ slug: 'abroad', venue: { name: 'Market', address: 'Frankenmuth, MI 48734' } });
  const rejectedOne = event({ slug: 'rejected' });
  const past = pastEvents({
    kept: [longAgo, abroad, rejectedOne], previous: [upcoming, event()], listed: [event()],
    rejected: (e) => e.slug === 'rejected', now: NOW
  });
  assert.deepEqual(past, [], 'kukur-diwas is listed again, so it is not a past event');
  assert.ok(KEEP_DAYS >= 30);
});

test('the merge moves an ended event into the past events file', async (t) => {
  await inTempDir(t);
  await fs.writeFile('data/events.json', JSON.stringify([event({ startAt: '2020-11-07T11:30:00+05:30', endAt: '2020-11-07T14:00:00+05:30' })]));
  await mergeAndWrite([]);
  assert.deepEqual(JSON.parse(await fs.readFile('data/events.json', 'utf8')), []);
  assert.deepEqual(JSON.parse(await fs.readFile(PAST_PATH, 'utf8')), [], 'six years ago is past the keep window');
  const recent = new Date(Date.now() - 2 * 86400_000).toISOString();
  await fs.writeFile('data/events.json', JSON.stringify([event({ startAt: recent, endAt: recent })]));
  await mergeAndWrite([]);
  assert.deepEqual(JSON.parse(await fs.readFile(PAST_PATH, 'utf8')).map((e) => e.slug), ['kukur-diwas']);
  await mergeAndWrite([]);
  assert.deepEqual(JSON.parse(await fs.readFile(PAST_PATH, 'utf8')).map((e) => e.slug), ['kukur-diwas'], 'kept on later runs');
});
