import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { mergeAndWrite } from '../ingest/merge.mjs';
import { inTempDir } from './helpers.mjs';
import { LIST, aboutText, dehradunLinks, eventsFromPage, fetchBookMyShow, listingCards } from '../ingest/sources/bookmyshow.mjs';

const PIZZA = 'https://in.bookmyshow.com/events/d9-presents-pizza-making-workshop/ET00524545';
const TOUR = 'https://in.bookmyshow.com/events/big-tour-kolkata/ET00000001';
const card = (href, ...lines) => `<a href="${href}"><div>${lines.map((l) => `<span>${l}</span>`).join('')}</div></a>`;
const listing = [
  card('/events/d9-presents-pizza-making-workshop/ET00524545', 'D9 presents Pizza Making Workshop', 'D9: Dehradun', 'Masterclass', '₹ 299 onwards'),
  card('/events/big-tour-kolkata/ET00000001', 'Big Tour, Kolkata', 'Stadium: Kolkata', 'Concerts', '₹ 1000 onwards')
].join('');
const ld = (o) => `<script type="application/ld+json">${JSON.stringify([o])}</script>`;
const pizza = {
  '@type': 'EducationEvent', name: 'D9 presents Pizza Making Workshop', url: PIZZA,
  description: 'Book online tickets for D9 presents Pizza Making Workshop in Dehradun on BookMyShow which is a workshops event',
  startDate: '2026-11-22T16:00:00+05:30', endDate: '2026-11-22T17:30:00+05:30',
  location: { '@type': 'Place', name: 'D9: Dehradun', address: { addressLocality: 'Dehradun', streetAddress: 'Chakrata Road, Dehradun, Uttarakhand 248015, India' }, geo: { latitude: 30.3446, longitude: 77.9466 } },
  offers: { '@type': 'AggregateOffer', lowPrice: '299', highPrice: '399', priceCurrency: 'INR' }
};
const about = JSON.stringify('<p>Learn to make thin crust pizza with a chef.</p><p><br></p><p>299 per person</p>');
const pizzaPage = ld(pizza) + `<script>{"styleId":"desktop-about-the-event-description-text","text":${about}}</script>`;

test('only cards at a venue in the area are followed', () => {
  const cards = listingCards(listing);
  assert.equal(cards[0].href, PIZZA, 'relative links are made absolute');
  assert.deepEqual(dehradunLinks(cards), [{ url: PIZZA, genre: 'Masterclass' }]);
  const arcade = listingCards(card('/events/arcade/ET00000002', 'Arcade', 'Arcade Mall: Dehradun', 'Entertainment', '₹ 990 onwards'));
  assert.deepEqual(dehradunLinks(arcade), [], 'an everyday attraction is skipped');
});

test('an event page gives the event, with its About text instead of the booking blurb', () => {
  const [e] = eventsFromPage(pizzaPage, PIZZA);
  assert.equal(e.startAt, '2026-11-22T16:00:00+05:30');
  assert.equal(e.venue.name, 'D9', 'the city suffix is left off the venue');
  assert.deepEqual(e.pricing, { type: 'paid', minPrice: 299, maxPrice: 399, currency: 'INR' });
  assert.equal(e.description, 'Learn to make thin crust pizza with a chef. 299 per person');
  assert.equal(e.sources[0].externalId, 'ET00524545');
  assert.equal(aboutText('<p>nothing here</p>'), '');
});

test('an attraction open for months and a tour\'s shows elsewhere are left out', () => {
  assert.deepEqual(eventsFromPage(ld({ ...pizza, endDate: '2027-03-31T22:00:00+05:30' }), PIZZA), []);
  const kolkata = { ...pizza, startDate: '2026-11-29T19:00:00+05:30', endDate: undefined, location: { name: 'Stadium: Kolkata', address: { addressLocality: 'Kolkata' } } };
  const tour = `<script type="application/ld+json">${JSON.stringify([kolkata, pizza])}</script>`;
  assert.deepEqual(eventsFromPage(tour, TOUR).map((e) => e.startAt), ['2026-11-22T16:00:00+05:30'], 'a tour page gives only its show in the area');
});

test('the listing is asked for once its cards are there, then each Dehradun event page', async (t) => {
  const asked = [];
  const fetchPage = async (url, opts = {}) => { asked.push([url, opts.expect]); return url === LIST ? listing : pizzaPage; };
  const r = await fetchBookMyShow({ fetchPage });
  assert.deepEqual(asked, [[LIST, { text: 'onwards' }], [PIZZA, undefined]]);
  assert.equal(r.events.length, 1);
  assert.deepEqual([r.complete, r.partial], [false, true], 'a run never claims the whole list');
});

test('an event missing from a short listing stays on the site', async (t) => {
  await inTempDir(t);
  const stored = eventsFromPage(pizzaPage, PIZZA)[0];
  await mergeAndWrite([{ source: 'bookmyshow', events: [stored], partial: true }]);
  const other = { ...stored, id: 'x', title: 'Another Workshop', startAt: '2026-11-29T16:00:00+05:30', endAt: undefined, sources: [{ ...stored.sources[0], url: TOUR }] };
  for (let run = 0; run < 4; run++) await mergeAndWrite([await fetchBookMyShow({ fetchPage: async (url) => (url === LIST ? listing.replace('D9: Dehradun', 'D9 Dehradun') + card('/events/big-tour-kolkata/ET00000001', 'Another Workshop', 'Hall: Dehradun', 'Masterclass', '₹ 1 onwards') : ld(other)) })]);
  const titles = JSON.parse(await fs.readFile('data/events.json', 'utf8')).map((e) => e.title);
  assert.ok(titles.includes('D9 presents Pizza Making Workshop'), 'four runs without it did not remove it');
});

test('a listing that did not load is tried once more', async () => {
  let tries = 0;
  const fetchPage = async (url) => { if (url !== LIST) return pizzaPage; if (++tries === 1) throw new Error('cards not loaded'); return listing; };
  assert.equal((await fetchBookMyShow({ fetchPage, retryMs: 0 })).events.length, 1);
  assert.equal(tries, 2);
  await assert.rejects(fetchBookMyShow({ fetchPage: async () => { throw new Error('cards not loaded'); }, retryMs: 0 }),
    (e) => /cards not loaded/.test(e.message) && e.diagnostics.listingTries.length === 2);
});

test('the listing gets more time than an event page, and a failed page is tried once more', async () => {
  const timeouts = {};
  let pizzaTries = 0;
  const fetchPage = async (url, opts = {}) => {
    timeouts[url] = opts.timeoutMs;
    if (url === LIST) return listing;
    if (++pizzaTries === 1) throw new Error('timeout');
    return pizzaPage;
  };
  const r = await fetchBookMyShow({ fetchPage, retryMs: 0 });
  assert.ok(timeouts[LIST] > 60_000);
  assert.equal(pizzaTries, 2);
  assert.equal(r.events.length, 1);
});

test('a run that missed pages, or saw no Dehradun card, is partial, so stored events stay', async () => {
  const pages = { [LIST]: listing + card('/events/other/ET00000003', 'Other show', 'Venue: Dehradun', 'Concerts', '₹ 100 onwards') };
  const r = await fetchBookMyShow({ fetchPage: async (url) => { if (pages[url]) return pages[url]; if (url === PIZZA) return pizzaPage; throw new Error('refused'); } });
  assert.equal(r.events.length, 1);
  assert.equal(r.partial, true);
  const out = await fetchBookMyShow({ fetchPage: async (url) => (url === LIST ? listing : pizzaPage), budgetMs: -1 });
  assert.deepEqual([out.events.length, out.partial, out.diagnostics.eventPagesSkipped], [0, true, 1], 'pages past the time budget wait for the next run');
  const elsewhere = await fetchBookMyShow({ fetchPage: async () => card('/events/big-tour-kolkata/ET00000001', 'Big Tour', 'Stadium: Kolkata', 'Concerts', '₹ 1000 onwards') });
  assert.deepEqual([elsewhere.events.length, elsewhere.complete, elsewhere.partial], [0, false, true]);
});

test('without settings it fetches nothing; a listing without cards or failing pages is an error', async () => {
  const saved = { ...process.env };
  delete process.env.BRIGHTDATA_API_TOKEN; delete process.env.BRIGHTDATA_UNLOCKER_ZONE;
  try {
    assert.deepEqual((await fetchBookMyShow()).diagnostics, { configured: false });
  } finally { Object.assign(process.env, saved); }
  await assert.rejects(fetchBookMyShow({ fetchPage: async () => '<p>shell</p>' }), /no event cards/);
  await assert.rejects(fetchBookMyShow({ fetchPage: async (url) => { if (url === LIST) return listing; throw new Error('refused'); } }), /could not be fetched/);
});
