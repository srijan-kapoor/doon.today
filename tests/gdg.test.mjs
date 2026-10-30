import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTERS, eventUrl, fetchGdg, listUrl, priceFromTickets, toEvent } from '../ingest/sources/gdg.mjs';
import { detailsLinkLabel } from '../src/lib/sources.mjs';
import { inTempDir } from './helpers.mjs';

// The shape of a real event record (GDG Dehradun's "Build with AI", 22 Aug 2026), moved into the future.
const record = (over = {}) => ({
  id: 128384, title: 'Build with AI', status: 'Published', audience_type: 'IN_PERSON', is_virtual_event: false,
  start_date: '2030-08-22T04:00:00Z', end_date: '2030-08-22T10:30:00Z', event_timezone: 'Asia/Calcutta',
  description: '<p>Build with AI is a global event series aimed at enabling developers across the world to build with Google\'s latest models.</p>',
  description_short: 'Build with AI is a global event series aimed at enabling developers across the world to build using Google\'s l...',
  url: 'https://gdg.community.dev/events/details/google-gdg-dehradun-presents-build-with-ai-1/',
  venue_name: 'Graphic Era Hill University', venue_address: 'Road Society Area', venue_city: 'Dehradun', venue_zip_code: '248002',
  venue_latitude: 30.2723733, venue_longitude: 78.0010035,
  chapter: { title: 'GDG Dehradun', city: 'Dehradun' },
  tickets: [{ price: 0, currency: 'USD', title: 'General Admission' }],
  ...over
});

test('an in-person Dehradun event becomes a verified, free community event', () => {
  const e = toEvent(record());
  assert.equal(e.title, 'Build with AI');
  assert.equal(e.startAt, '2030-08-22T04:00:00Z');
  assert.equal(e.endAt, '2030-08-22T10:30:00Z');
  assert.equal(e.description, "Build with AI is a global event series aimed at enabling developers across the world to build with Google's latest models.", 'the full description, not the cut-off short one');
  assert.equal(toEvent(record({ description: '' })).description.endsWith('...'), true, 'the short one only when there is no other');
  assert.deepEqual(e.venue, { name: 'Graphic Era Hill University', address: 'Road Society Area, Dehradun, 248002', city: 'Dehradun', geo: { lat: 30.27237, lng: 78.001 } });
  assert.equal('geo' in toEvent(record({ venue_latitude: null, venue_longitude: null })).venue, false, 'no coordinates, no key');
  assert.deepEqual(e.pricing, { type: 'free', currency: 'INR' });
  assert.deepEqual(e.categories, ['Community'], 'a developer meetup that names no other category');
  assert.equal(e.verificationStatus, 'verified');
  assert.equal(e.sources[0].provider, 'gdg');
  assert.equal(e.sources[0].externalId, '128384');
  assert.equal(detailsLinkLabel(e.sources[0]), 'Tickets and details on Google Developer Groups');
  assert.deepEqual(toEvent(record({ title: 'Flutter Workshop' })).categories, ['Workshop']);
});

test('online, cancelled, undated and out-of-town events are left out', () => {
  assert.equal(toEvent(record({ audience_type: 'VIRTUAL' })), null);
  assert.equal(toEvent(record({ is_virtual_event: true })), null);
  assert.equal(toEvent(record({ status: 'Canceled' })), null);
  assert.equal(toEvent(record({ start_date: 'soon' })), null);
  assert.equal(toEvent(record({ venue_name: 'Google Office', venue_address: 'Connaught Place', venue_city: 'New Delhi', venue_zip_code: '110001', chapter: { city: 'New Delhi' } })), null);
  assert.notEqual(toEvent(record({ audience_type: 'HYBRID' })), null, 'a hybrid event still happens in Dehradun');
  assert.notEqual(toEvent(record({ venue_name: 'UPES', venue_address: 'Energy Acres', venue_city: 'Bidholi', venue_zip_code: '248007' })), null, 'Bidholi is the UPES campus, in Dehradun');
  assert.equal(toEvent(record({ venue_name: '', venue_address: '', venue_city: '' })).venue.name, 'GDG Dehradun', 'a venue to be announced falls back to the chapter');
});

test('ticket prices: free only when every ticket is 0, and only rupees count as a price', () => {
  assert.deepEqual(priceFromTickets([{ price: 0, currency: 'USD' }, { price: 0, currency: 'USD' }]), { type: 'free', currency: 'INR' });
  assert.deepEqual(priceFromTickets([{ price: 0, currency: 'INR' }, { price: 499, currency: 'INR' }, { price: 999, currency: 'INR' }]), { type: 'paid', minPrice: 499, maxPrice: 999, currency: 'INR' });
  assert.deepEqual(priceFromTickets([{ price: 10, currency: 'USD' }]), { type: 'unknown', currency: 'INR' });
  assert.deepEqual(priceFromTickets([]), { type: 'unknown', currency: 'INR' });
  assert.deepEqual(priceFromTickets(undefined), { type: 'unknown', currency: 'INR' });
});

test('every chapter is read, co-hosted events appear once, and one failing chapter does not stop the rest', async () => {
  const lists = {
    [listUrl(1312)]: { results: [{ id: 1 }, { id: 2 }] },
    [listUrl(1783)]: { results: [{ id: 2 }] },
    [listUrl(1729)]: null
  };
  const records = { [eventUrl(1)]: record({ id: 1, url: 'https://gdg.community.dev/e/one/' }), [eventUrl(2)]: record({ id: 2, title: 'DevFest Dehradun', url: 'https://gdg.community.dev/e/two/' }) };
  const requested = [];
  const fetchPage = async (url) => {
    requested.push(url);
    if (url in lists) { if (!lists[url]) throw new Error('503'); return JSON.stringify(lists[url]); }
    if (url in records) return JSON.stringify(records[url]);
    throw new Error(`unexpected ${url}`);
  };
  const { source, events, complete, diagnostics } = await fetchGdg({ fetchPage });
  assert.equal(source, 'gdg');
  assert.deepEqual(events.map((e) => e.title), ['Build with AI', 'DevFest Dehradun']);
  assert.equal(diagnostics.chapters, 2);
  assert.equal(diagnostics.listed, 3);
  assert.equal(diagnostics.eventsParsed, 2);
  assert.equal(diagnostics.errors.length, 1);
  assert.equal(complete, false, 'a chapter failed, so an empty answer would prove nothing');
  assert.deepEqual(requested.filter((u) => u.includes('for_chapter')), CHAPTERS.map((c) => listUrl(c.id)), 'only upcoming ("Live") events are asked for');
  assert.ok(listUrl(1312).includes('status=Live'));
});

test('an empty answer from every chapter is complete, so a cancelled event is eventually dropped', async (t) => {
  const { default: fs } = await import('node:fs/promises');
  const { default: os } = await import('node:os');
  const { default: path } = await import('node:path');
  const { mergeAndWrite, MISSED_RUNS_LIMIT } = await import('../ingest/merge.mjs');
  const empty = await fetchGdg({ fetchPage: async () => JSON.stringify({ results: [] }) });
  assert.deepEqual([empty.events.length, empty.complete], [0, true]);

  await inTempDir(t);
  const stored = { ...toEvent(record()), curation: { status: 'published', score: 6 } };
  await fs.writeFile('data/events.json', JSON.stringify([stored]));
  const read = async () => JSON.parse(await fs.readFile('data/events.json', 'utf8'));
  await mergeAndWrite([{ ...empty, complete: false }]);
  assert.equal((await read())[0].missedRuns, undefined, 'an incomplete empty answer proves nothing');
  for (let i = 1; i < MISSED_RUNS_LIMIT; i++) await mergeAndWrite([empty]);
  assert.equal((await read())[0].missedRuns, MISSED_RUNS_LIMIT - 1);
  await mergeAndWrite([empty]);
  assert.equal((await read()).length, 0, 'gone after the usual number of missed runs');
});

test('a run where no chapter answers is a failure, not an empty success', async () => {
  await assert.rejects(fetchGdg({ fetchPage: async () => { throw new Error('403'); } }), /No GDG chapter listing/);
});
