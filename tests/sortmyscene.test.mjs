import test from 'node:test';
import assert from 'node:assert/strict';
import { API, fetchSortMyScene, istTime, toEvent } from '../ingest/sources/sortmyscene.mjs';
import { isCommunityEvent } from '../src/lib/community.mjs';

// The shape of one listed event, as the endpoint gives it.
const listed = (over = {}) => ({
  _id: '6ae8315cfeb5014936bd8df9', currency: 'INR', event_category: ['Bollywood', 'House'], displayEvent: true,
  event_name: 'Diwali Night', club: 'Romeo Lane - DEHRADUN', location: 'Dehradun', event_url: 'diwali-night-nov-06-2026',
  rawStartTime: Date.parse('2026-11-06T18:00:00+05:30'), rawEndTime: Date.parse('2026-11-06T23:30:00+05:30'),
  l_price: 399, priceLabel: 'From ₹399', ...over
});
const page = (events, hasMore = false) => JSON.stringify({ events, pastEvents: [], hasMore });

test('a listed event becomes an aggregator listing, not a community pick', () => {
  const e = toEvent(listed());
  assert.equal(e.startAt, '2026-11-06T18:00:00+05:30');
  assert.equal(e.endAt, '2026-11-06T23:30:00+05:30');
  assert.equal(e.venue.name, 'Romeo Lane', 'the city suffix is left off the venue');
  assert.deepEqual(e.pricing, { type: 'paid', minPrice: 399, currency: 'INR' });
  assert.deepEqual(e.categories, ['Music'], 'a party with music genres is a music night');
  assert.equal(e.sources[0].url, 'https://sortmyscene.com/events/diwali-night-nov-06-2026');
  assert.equal(isCommunityEvent(e), false);
  assert.equal(istTime(Date.parse('2026-11-06T20:00:00Z')), '2026-11-07T01:30:00+05:30');
});

test('free, RSVP and hidden or out-of-town listings', () => {
  assert.equal(toEvent(listed({ priceLabel: 'Free', l_price: 0 })).pricing.type, 'free');
  assert.equal(toEvent(listed({ priceLabel: 'RSVP', l_price: 0 })).pricing.type, 'unknown');
  assert.equal(toEvent(listed({ event_name: 'Mall Run', event_category: [] })).categories.includes('Music'), false);
  assert.equal(toEvent(listed({ displayEvent: false })), null);
  assert.equal(toEvent(listed({ location: 'Chandigarh' })), null);
  assert.equal(toEvent(listed({ club: '' })).venue.name, 'Venue TBA');
});

test('every page of the list is read', async () => {
  const asked = [];
  const fetchPage = async (url) => { asked.push(url); return url.includes('page=0') ? page([listed()], true) : page([listed({ event_url: 'b', _id: 'b' })]); };
  const r = await fetchSortMyScene({ fetchPage });
  assert.equal(asked[0], `${API}?page=0&city=Dehradun`);
  assert.deepEqual([asked.length, r.events.length, r.complete, r.partial], [2, 2, true, false]);
});

test('without settings it fetches nothing; an answer without a list is an error', async () => {
  const saved = { ...process.env };
  delete process.env.BRIGHTDATA_API_TOKEN; delete process.env.BRIGHTDATA_UNLOCKER_ZONE;
  try {
    assert.deepEqual((await fetchSortMyScene()).diagnostics, { configured: false });
  } finally { Object.assign(process.env, saved); }
  await assert.rejects(fetchSortMyScene({ fetchPage: async () => '{"message":"blocked"}' }), /without an event list/);
});
