import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { priceFromOffers, priceFromText } from '../ingest/lib/utils.mjs';
import { LIST, addDetailsFromEventPages, applyEventDetails, detailsFromEventPage, fetchAllEvents } from '../ingest/sources/allevents.mjs';
import { mergeAndWrite } from '../ingest/merge.mjs';
import { priceLabel } from '../src/lib/sources.mjs';
import { inTempDir } from './helpers.mjs';

const fixture = (name) => fs.readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const GHOSTED = 'https://allevents.in/dehradun/ghosted/4100030884279649';
const DANDIYA = 'https://allevents.in/dehradun/dandiya-night-dehradun-by-hindustan/3900030829381530';
const ZUMBA = 'https://allevents.in/dehradun/zumba-instructor-training-with-steve-frank-in-dehra-dun-uttarakhand-in/200030777510326';
const CRIMSON = 'https://allevents.in/dehradun/framed-in-crimson-halloween-rock-night/3900030867000008';
const CRIMSON_ABOUT = 'This Halloween, Framed In Crimson brings you a high-energy live rock experience packed with the anthems that defined the 2000s rock era.';
const ldPage = (objects) => `<script type="application/ld+json">${JSON.stringify(objects)}</script>`;
// The event as the listing gives it (a date, no description) and as its own page gives it.
const crimsonListing = { '@type': 'Event', name: 'Framed In Crimson: Halloween Rock Night', startDate: '2026-10-31', url: CRIMSON,
  location: { name: 'Hotel Vishranti: Dehradun', address: { streetAddress: 'Canal Road, Gangotri Vihar, Dehradun, Uttarakhand 248013, India', addressLocality: 'Dehradun' } } };
const crimsonPage = ldPage([{ ...crimsonListing, '@type': 'MusicEvent', startDate: '2026-10-31T20:30:00+05:30', endDate: '2026-10-31T22:30:00+05:30',
  description: CRIMSON_ABOUT, offers: [{ '@type': 'AggregateOffer', priceCurrency: 'USD', url: CRIMSON }] }]);
const pages = async () => ({
  [GHOSTED]: await fixture('allevents-event-price-range.html'),
  [DANDIYA]: await fixture('allevents-event-offer-no-price.html'),
  [ZUMBA]: await fixture('allevents-event-no-offers.html')
});

test('offers give the lowest real price, the top of the range, and free only when everything is 0', () => {
  assert.deepEqual(priceFromOffers([{ '@type': 'AggregateOffer', priceCurrency: 'INR', lowPrice: '1500.00', highPrice: '4000.00', price: '1500.00' }]),
    { type: 'paid', minPrice: 1500, maxPrice: 4000, currency: 'INR' });
  assert.deepEqual(priceFromOffers({ price: '0', priceCurrency: 'INR' }), { type: 'free', currency: 'INR' });
  assert.deepEqual(priceFromOffers([{ price: 0 }, { price: 499 }]), { type: 'paid', minPrice: 499, currency: 'INR' }, 'a free tier beside paid ones is not "free"');
  assert.deepEqual(priceFromOffers({ '@type': 'AggregateOffer', offers: [{ price: '300' }, { price: '700' }] }), { type: 'paid', minPrice: 300, maxPrice: 700, currency: 'INR' });
  assert.equal(priceFromOffers({ priceCurrency: 'USD', price: '25' }), null, 'never shown as rupees');
  assert.equal(priceFromOffers({ priceCurrency: 'INR', price: '' }), null, 'an empty price is not 0');
  assert.equal(priceFromOffers(undefined), null);
  assert.equal(priceFromOffers({ price: 'TBA', priceCurrency: 'INR' }), null, 'a word is not a price, and not free');
  assert.equal(priceFromOffers({ price: 'Check website' }), null);
  assert.equal(priceFromOffers({ price: 'Rs. 500' }).minPrice, 500);
  assert.equal(priceFromOffers({ price: '500 - 1000' }).minPrice, 500);
  assert.deepEqual(priceFromOffers({ '@type': 'AggregateOffer', lowPrice: 0, highPrice: 500 }), { type: 'paid', minPrice: 500, currency: 'INR' }, 'a free tier beside a paid one');
  assert.equal(priceFromOffers({ '@type': 'AggregateOffer', priceCurrency: 'USD', offers: [{ price: 10 }] }), null, 'nested offers take the parent currency');
  assert.equal(priceFromOffers({ price: 0.4 }).minPrice, 1, 'never a paid price of 0');
  assert.equal(priceFromOffers({ '@type': 'AggregateOffer', lowPrice: 0, highPrice: 'TBA' }), null, 'not free when a price is unreadable');
  assert.equal(priceFromOffers({ price: 'Starts 2 Nov, ₹499' }).minPrice, 499, 'the amount after ₹ wins');
});

test('a price in the text counts only when it is stated, never guessed from a stray "free"', () => {
  assert.deepEqual(priceFromText('Tickets ₹1,200 at the door'), { type: 'paid', minPrice: 1200, currency: 'INR' });
  assert.deepEqual(priceFromText("It's a FREE event! Bring friends."), { type: 'free', currency: 'INR' });
  assert.deepEqual(priceFromText('Free entry for all'), { type: 'free', currency: 'INR' });
  assert.equal(priceFromText('Free parking available at the venue').type, 'unknown');
  assert.equal(priceFromText('Feel free to bring a friend').type, 'unknown');
  for (const t of ['Doors 6:30 PM', 'ages 12 years 18 above', 'Hours 10am-5pm', 'Gates open at 5', 'Rs 5 off']) assert.equal(priceFromText(t).type, 'unknown', t);
  assert.equal(priceFromText('Tickets Rs500').minPrice, 500);
  assert.equal(priceFromText('Entry INR 1,200').minPrice, 1200);
});

test('event pages fill in missing prices: a range, an offer without a price, and no offers', async () => {
  const html = await pages();
  const fetchPage = async (url) => { if (!html[url]) throw new Error(`unexpected ${url}`); return html[url]; };
  const priceOf = async (url, title) => (await detailsFromEventPage(url, { title, fetchPage }))?.pricing ?? null;
  assert.deepEqual(await priceOf(GHOSTED, 'Ghosted'), { type: 'paid', minPrice: 1500, maxPrice: 4000, currency: 'INR' });
  assert.equal(await priceOf(DANDIYA), null, 'its only offer is in USD with no price');
  assert.equal(await priceOf(ZUMBA), null);
  await assert.rejects(detailsFromEventPage('https://allevents.in/broken', { fetchPage: async () => { throw new Error('403'); } }));
});

test("only this event's own structured data counts, not a similar event on the same page", async () => {
  const page = ldPage;
  const priceOf = async (fetchPage) => (await detailsFromEventPage(GHOSTED, { title: 'Ghosted', fetchPage }))?.pricing ?? null;
  const other = { '@type': 'Event', name: 'Some Other Night', url: 'https://allevents.in/dehradun/other/1', offers: { price: '99', priceCurrency: 'INR' } };
  const own = { '@type': 'MusicEvent', name: 'Ghosted', url: GHOSTED, offers: { price: '1500', priceCurrency: 'INR' } };
  assert.equal((await priceOf(async () => page([other, own]))).minPrice, 1500, 'matched by link; Event subtypes count');
  assert.equal(await priceOf(async () => page([other, { ...other, name: 'Third' }])), null, 'neither is this event');
  assert.equal((await priceOf(async () => page([{ ...own, url: undefined }]))).minPrice, 1500, 'a single event on the page is this one');
});

test('every AllEvents page is fetched, soonest first and capped, and a known price is kept', async () => {
  const html = await pages();
  const fetched = [];
  const fetchPage = async (url) => { fetched.push(url); return html[url] || ''; };
  const ev = (url, startAt, pricing = { type: 'unknown', currency: 'INR' }) => ({ title: 'x', startAt, pricing, description: '', venue: { name: 'Venue' }, sources: [{ provider: 'allevents', url }] });
  const events = [ev(DANDIYA, '2030-11-02'), ev(GHOSTED, '2030-10-31', { type: 'paid', minPrice: 900, currency: 'INR' }), ev(ZUMBA, '2030-10-01'), ev('https://example.com/elsewhere', '2030-10-01')];
  const result = await addDetailsFromEventPages(events, { fetchPage, delayMs: 0 });
  assert.deepEqual(result, { eventPagesFetched: 3, pricesFound: 0, timesFound: 0, eventPagesFailed: 0 });
  assert.deepEqual(fetched, [ZUMBA, GHOSTED, DANDIYA], 'soonest first, priced or not; non-AllEvents links are skipped');
  assert.deepEqual(events[1].pricing, { type: 'paid', minPrice: 900, currency: 'INR' }, 'the listing price stands');
  fetched.length = 0;
  await addDetailsFromEventPages([ev(GHOSTED, '2030-10-31'), ev(DANDIYA, '2030-11-02')], { fetchPage, delayMs: 0, max: 1 });
  assert.equal(fetched.length, 1);
});

test("an event's own page adds its time, end and description, but never moves or overwrites the listing", () => {
  const listed = (over) => ({ title: 'Framed In Crimson: Halloween Rock Night', startAt: '2026-10-31', description: '', categories: ['Other'],
    venue: { name: 'Hotel Vishranti: Dehradun', address: 'Canal Road, Dehradun' }, pricing: { type: 'unknown', currency: 'INR' }, ...over });
  const page = { pricing: null, startAt: '2026-10-31T20:30:00+05:30', endAt: '2026-10-31T22:30:00+05:30', description: CRIMSON_ABOUT };

  const e = listed();
  assert.deepEqual(applyEventDetails(e, page), { price: false, time: true });
  assert.equal(e.startAt, '2026-10-31T20:30:00+05:30');
  assert.equal(e.endAt, '2026-10-31T22:30:00+05:30');
  assert.equal(e.description, CRIMSON_ABOUT);
  assert.deepEqual(e.categories, ['Music'], 'categories are read again with the description');

  const course = listed({ startAt: '2026-11-02', endAt: '2026-11-13' });
  applyEventDetails(course, { ...page, startAt: '2026-11-02T07:00:00+05:30', endAt: '2026-11-13T20:00:00+05:30' });
  assert.equal(course.endAt, '2026-11-13T20:00:00+05:30', "the page's end time replaces the listing's bare end date");
  const otherEnd = listed({ startAt: '2026-11-02', endAt: '2026-11-13' });
  applyEventDetails(otherEnd, { ...page, startAt: '2026-11-02T07:00:00+05:30', endAt: '2026-11-20T20:00:00+05:30' });
  assert.deepEqual([otherEnd.startAt, otherEnd.endAt], ['2026-11-02', '2026-11-13'], 'an end time on another day leaves both as dates');
  const sameDay = listed({ endAt: '2026-10-31' });
  applyEventDetails(sameDay, { ...page, endAt: undefined });
  assert.deepEqual([sameDay.startAt, sameDay.endAt], ['2026-10-31', '2026-10-31'], 'never a time with a bare end date');

  const moved = listed();
  applyEventDetails(moved, { ...page, startAt: '2026-11-01T20:30:00+05:30', endAt: '2026-11-01T22:30:00+05:30' });
  assert.equal(moved.startAt, '2026-10-31', 'a time on another day is ignored');
  assert.equal(moved.endAt, undefined, 'and a timed end does not go with a date-only start');
  const utc = listed();
  applyEventDetails(utc, { ...page, startAt: '2026-10-30T19:00:00Z', endAt: undefined });
  assert.equal(utc.startAt, '2026-10-30T19:00:00Z', '00:30 IST on the 31st, written in UTC, is on the listing day');

  const timed = listed({ startAt: '2026-10-31T21:00:00+05:30' });
  applyEventDetails(timed, { ...page, endAt: '2026-10-31T20:00:00+05:30' });
  assert.equal(timed.startAt, '2026-10-31T21:00:00+05:30', "the listing's own time stands");
  assert.equal(timed.endAt, undefined, 'an end before the start is ignored');

  const described = listed({ description: 'A long description the listing already had, longer than the page gives.'.repeat(3), categories: ['Comedy'] });
  applyEventDetails(described, page);
  assert.notEqual(described.description, CRIMSON_ABOUT, 'a shorter description does not replace a longer one');
  assert.deepEqual(described.categories, ['Comedy']);

  const free = listed();
  applyEventDetails(free, { ...page, pricing: null, description: `${CRIMSON_ABOUT} Free entry for all.` });
  assert.equal(free.pricing.type, 'free', 'a price stated in the new description counts');
  assert.deepEqual(applyEventDetails(listed(), null), { price: false, time: false });
});

test('fetching stops after two blocked pages in a row, and failures keep prices unknown', async () => {
  const blocked = Object.assign(new Error('403 Forbidden'), { diagnostics: { status: 403 } });
  let calls = 0;
  const fetchPage = async () => { calls++; throw blocked; };
  const events = [1, 2, 3, 4].map((n) => ({ title: `e${n}`, startAt: `2030-10-0${n}`, pricing: { type: 'unknown', currency: 'INR' }, sources: [{ provider: 'allevents', url: `https://allevents.in/dehradun/e${n}/1` }] }));
  const result = await addDetailsFromEventPages(events, { fetchPage, delayMs: 0 });
  assert.equal(calls, 2);
  assert.deepEqual(result, { eventPagesFetched: 2, pricesFound: 0, timesFound: 0, eventPagesFailed: 2, eventPagesStoppedEarly: true });
  assert.ok(events.every((e) => e.pricing.type === 'unknown'));
});

test('fetching also stops after three failures of any kind, and skips events that already started', async () => {
  let calls = 0;
  const flaky = async () => { calls++; throw (calls % 2 ? Object.assign(new Error('403'), { diagnostics: { status: 403 } }) : new Error('timeout')); };
  const ev = (n, startAt) => ({ title: `e${n}`, startAt, pricing: { type: 'unknown', currency: 'INR' }, sources: [{ provider: 'allevents', url: `https://allevents.in/dehradun/e${n}/1` }] });
  const now = Date.parse('2030-10-10T12:00:00+05:30');
  const result = await addDetailsFromEventPages([1, 2, 3, 4, 5].map((n) => ev(n, `2030-10-2${n}`)), { fetchPage: flaky, delayMs: 0, now });
  assert.equal(calls, 3, 'a 403, a timeout and a 403 in a row');
  assert.equal(result.eventPagesStoppedEarly, true);
  const fetched = [];
  await addDetailsFromEventPages([ev(1, '2030-10-09'), ev(2, '2030-10-10T05:00:00+05:30'), ev(3, '2030-10-10'), ev(4, '2030-10-12')], { fetchPage: async (u) => { fetched.push(u); return ''; }, delayMs: 0, now });
  assert.deepEqual(fetched.map((u) => u.split('/')[4]), ['e3', 'e4'], 'yesterday and this morning are skipped; today (date only) and later are fetched');
});

test('fetchAllEvents reads the listing, then details from event pages', async () => {
  const html = await pages();
  const listing = `<script type="application/ld+json">${JSON.stringify([
    { '@type': 'Event', name: 'Ghosted', startDate: '2026-10-31', url: GHOSTED, location: { name: 'BLAAZE - Mall of Dehradun', address: { addressLocality: 'Dehradun' } } },
    { '@type': 'Event', name: 'Dandiya Night Dehradun', startDate: '2026-10-25', url: DANDIYA, location: { name: 'Dehradun', address: { addressLocality: 'Dehradun' } } }
  ])}</script>`;
  const fetchPage = async (url) => (url === LIST ? listing : html[url] || '');
  const { events, diagnostics } = await fetchAllEvents({ fetchPage, delayMs: 0 });
  assert.equal(events.find((e) => e.title === 'Ghosted').pricing.minPrice, 1500);
  assert.equal(events.find((e) => e.title === 'Dandiya Night Dehradun').pricing.type, 'unknown');
  assert.equal(diagnostics.pricesFound, 1);
});

test('the full upcoming list is read, and a bare listing becomes a full event from its own page', async () => {
  assert.equal(LIST, 'https://allevents.in/dehradun/all', 'the plain city page shows only about half the events');
  const fetchPage = async (url) => ({ [LIST]: ldPage([crimsonListing]), [CRIMSON]: crimsonPage })[url] ?? '';
  const { events, reviewCandidates, diagnostics } = await fetchAllEvents({ fetchPage, delayMs: 0 });
  assert.equal(events.length, 1);
  assert.equal(events[0].startAt, '2026-10-31T20:30:00+05:30');
  assert.equal(events[0].endAt, '2026-10-31T22:30:00+05:30');
  assert.equal(events[0].description, CRIMSON_ABOUT);
  assert.deepEqual(events[0].categories, ['Music']);
  assert.equal(events[0].pricing.type, 'unknown', 'a USD offer with no price is not a price');
  assert.equal(reviewCandidates.length, 0, 'with a time and a description it is no longer a thin listing');
  assert.deepEqual(diagnostics, { candidates: 1, flaggedForReview: 0, eventPagesFetched: 1, pricesFound: 0, timesFound: 1, eventPagesFailed: 0 });
});

test('merged sources use the lowest price and the widest range; a known price beats unknown', async (t) => {
  await inTempDir(t);
  const base = (over) => ({
    title: 'Dehradun Half Marathon 2030', startAt: '2030-10-25T05:30:00+05:30', venue: { name: 'Maharana Pratap Sports College', city: 'Dehradun' },
    categories: ['Outdoors'], curation: { status: 'published', score: 7 }, firstSeenAt: '2030-01-01T00:00:00Z', lastSeenAt: '2030-01-01T00:00:00Z', lastCheckedAt: '2030-01-01T00:00:00Z', ...over
  });
  await mergeAndWrite([
    { source: 'thrillzone', events: [base({ id: 'tz', slug: 'hm', pricing: { type: 'paid', minPrice: 699, currency: 'INR' }, sources: [{ provider: 'thrillzone', url: 'https://example.test/tz' }] })] },
    { source: 'allevents', events: [base({ id: 'ae', slug: 'hm', pricing: { type: 'paid', minPrice: 600, maxPrice: 1399, currency: 'INR' }, sources: [{ provider: 'allevents', url: 'https://example.test/ae' }] })] }
  ]);
  const [e] = JSON.parse(await fs.readFile('data/events.json', 'utf8'));
  assert.deepEqual(e.pricing, { type: 'paid', minPrice: 600, maxPrice: 1399, currency: 'INR' });
  assert.equal(e.sources[0].provider, 'thrillzone', 'the higher-ranked source still leads');

  await mergeAndWrite([
    { source: 'district', events: [base({ id: 'd', slug: 'x', title: 'Doon Gig 2030', pricing: { type: 'unknown', currency: 'INR' }, sources: [{ provider: 'district', url: 'https://example.test/d' }] })] },
    { source: 'allevents', events: [base({ id: 'a', slug: 'x', title: 'Doon Gig 2030', pricing: { type: 'paid', minPrice: 500, currency: 'INR' }, sources: [{ provider: 'allevents', url: 'https://example.test/a' }] })] }
  ]);
  const gig = JSON.parse(await fs.readFile('data/events.json', 'utf8')).find((x) => x.title === 'Doon Gig 2030');
  assert.deepEqual(gig.pricing, { type: 'paid', minPrice: 500, currency: 'INR' });
});

test('a stored price is replaced by this run, not widened, and a hand-checked price is never lowered', async (t) => {
  await inTempDir(t);
  const event = (over) => ({
    id: 'g', slug: 'g', title: 'Ghosted 2030', startAt: '2030-10-31', venue: { name: 'BLAAZE', city: 'Dehradun' }, categories: ['Music'],
    curation: { status: 'published', score: 4 }, firstSeenAt: '2030-01-01T00:00:00Z', lastSeenAt: '2030-01-01T00:00:00Z', lastCheckedAt: '2030-01-01T00:00:00Z',
    sources: [{ provider: 'allevents', url: 'https://example.test/g' }], ...over
  });
  const read = async () => JSON.parse(await fs.readFile('data/events.json', 'utf8'))[0];
  await mergeAndWrite([{ source: 'allevents', events: [event({ pricing: { type: 'paid', minPrice: 500, currency: 'INR' } })] }]);
  await mergeAndWrite([{ source: 'allevents', events: [event({ pricing: { type: 'paid', minPrice: 800, maxPrice: 1200, currency: 'INR' } })] }]);
  assert.deepEqual((await read()).pricing, { type: 'paid', minPrice: 800, maxPrice: 1200, currency: 'INR' }, 'an early-bird price does not stick');
  await mergeAndWrite([{ source: 'allevents', events: [event({ pricing: { type: 'unknown', currency: 'INR' } })] }]);
  assert.equal((await read()).pricing.minPrice, 800, 'a run without a price keeps the stored one');

  await fs.rm('data', { recursive: true, force: true });
  await mergeAndWrite([
    { source: 'manual', events: [event({ id: 'm', sources: [{ provider: 'manual', url: 'https://example.test/m' }], pricing: { type: 'paid', minPrice: 699, currency: 'INR' } })] },
    { source: 'allevents', events: [event({ pricing: { type: 'paid', minPrice: 6, currency: 'INR' } })] }
  ]);
  assert.deepEqual((await read()).pricing, { type: 'paid', minPrice: 699, currency: 'INR' }, 'a hand-checked price wins');

  await fs.rm('data', { recursive: true, force: true });
  await mergeAndWrite([{ source: 'district', events: [event({ id: 'd', sources: [{ provider: 'district', url: 'https://example.test/d' }], pricing: { type: 'paid', currency: 'INR' } })] }]);
  await mergeAndWrite([{ source: 'allevents', events: [event({ pricing: { type: 'paid', minPrice: 499, currency: 'INR' } })] }]);
  assert.equal((await read()).pricing.minPrice, 499, '"paid" with no amount gives way to a real amount');
});

test('price labels for the event page and the list', () => {
  assert.equal(priceLabel({ type: 'paid', minPrice: 1500, maxPrice: 4000 }), '₹1,500–4,000');
  assert.equal(priceLabel({ type: 'paid', minPrice: 1500 }), 'From ₹1,500');
  assert.equal(priceLabel({ type: 'paid', minPrice: 1500, maxPrice: 4000 }, 'short'), '₹1,500+');
  assert.equal(priceLabel({ type: 'free' }), 'Free');
  assert.equal(priceLabel({ type: 'free' }, 'short'), 'FREE');
  assert.equal(priceLabel({ type: 'unknown' }), '');
  assert.equal(priceLabel({ type: 'paid', minPrice: 1499.5 }), 'From ₹1,500', 'whole rupees');
});
