import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { eventPassesGeo, hasForeignAddress, hasForeignVenue, hasOutsidePin } from '../ingest/lib/utils.mjs';
import { LIST, isThinListing, fetchAllEvents } from '../ingest/sources/allevents.mjs';
import { mergeAndWrite } from '../ingest/merge.mjs';
import { reject } from '../ingest/lib/review.mjs';
import { sourceLead, leadIssue, parseLeadIssue, leadKey, leadToEvent, leadSourceUrl } from '../ingest/lib/leads.mjs';
import { inTempDir } from './helpers.mjs';

const event = (over = {}) => ({
  id: 'x', slug: 'x', title: 'Doon Music Night', description: 'An evening of live music in town, with three local bands and food stalls.',
  startAt: '2030-11-21T18:00:00+05:30', venue: { name: 'Rajpur Road Hall', address: 'Rajpur Road, Dehradun 248001', city: 'Dehradun' },
  categories: ['Music'], pricing: { type: 'unknown', currency: 'INR' },
  sources: [{ provider: 'allevents', url: 'https://allevents.in/dehradun/x/1' }],
  curation: { status: 'published', score: 4 }, firstSeenAt: '2030-01-01T00:00:00Z', lastSeenAt: '2030-01-01T00:00:00Z', lastCheckedAt: '2030-01-01T00:00:00Z',
  ...over
});

const read = async (file = 'data/events.json') => JSON.parse(await fs.readFile(file, 'utf8'));

test('a listing whose own description gives a foreign address is not a Dehradun event', () => {
  const frankenmuth = event({
    title: "'MERRY & BRIGHT' HOLIDAY MARKET FRANKENMUTH", startAt: '2026-11-21',
    description: 'Time & Location Nov 21st, 2026 10:00 AM – 4:00 PM Kern Pavilion Frankenmuth , 599 Weiss St, Frankenmuth, MI 48734, About the Event',
    venue: { name: 'Traveling Vintage Market', address: 'Friends Travelling Agents, Pant Road, Indira Market, Race Course, Dehradun 248001, India Dehradun', city: 'Dehradun' }
  });
  assert.equal(eventPassesGeo(frankenmuth), false, 'the Dehradun address the listing site attached does not save it');
  assert.equal(hasForeignVenue('Toronto, Canada'), true);
  assert.equal(hasForeignVenue('Chicago, USA'), true);
  assert.equal(eventPassesGeo(event({ venue: { name: 'Convention Centre', address: '255 Front St W, Toronto, Canada', city: 'Dehradun' } })), false, 'a country in the venue address counts');
});

test('Dehradun addresses and ordinary mentions of other countries still pass', () => {
  for (const address of ['The Creative Hub, Nehru Colony, Dehra Dun, Uttarakhand, IN 248001', 'Rajpur Road, Dehradun UK 248001', 'Mall Road, Mussoorie 248179', 'Race Course, Dehradun']) {
    assert.equal(eventPassesGeo(event({ venue: { name: 'Hall', address, city: 'Dehradun' } })), true, address);
  }
  assert.equal(eventPassesGeo(event({ description: 'A talk by a visiting speaker from the USA, followed by questions from the audience.' })), true);
  assert.equal(eventPassesGeo(event({ description: 'Ships to USA too, and the band plays classic rock covers all evening long.' })), true);
  assert.equal(eventPassesGeo(event({ description: 'Study abroad fair: USA, Canada, Germany. Meet universities from Canada, Australia, UK.' })), true, 'countries in a description are not an address');
  assert.equal(hasForeignAddress('Musicians from India, USA and Canada play together'), false);
});

test('a venue address with only a PIN code outside Dehradun is rejected', () => {
  assert.equal(hasOutsidePin('Connaught Place, New Delhi 110001'), true);
  assert.equal(hasOutsidePin('Rajpur Road, Dehradun 248001'), false);
  assert.equal(hasOutsidePin('Near Doon University Road, Mothrowala, Dehradun 248121'), false);
  assert.equal(hasOutsidePin('Race Course, Dehradun'), false, 'no PIN code, nothing to judge');
  assert.equal(hasOutsidePin('Plot 123456, Sahastradhara Road, Dehradun'), false, 'a plot number is not a PIN');
  assert.equal(hasOutsidePin('Rajpur Road, Dehradun, Ph: 0135-272345'), false, 'a phone fragment is not a PIN');
  assert.equal(hasOutsidePin('Survey Chowk, Race Course, Dehradun, Uttarakhand 248001, India Dehradun'), false, "AllEvents' address style");
  assert.equal(hasOutsidePin('Connaught Place, New Delhi 110001, India'), true);
  assert.equal(eventPassesGeo(event({ venue: { name: 'Hall', address: 'Sector 18, Noida 201301', city: 'Dehradun' } })), false);
});

test('a thin listing is a few words and no category, with or without a time', () => {
  const thin = (over) => isThinListing(event({ description: 'Thanks to lord Almighty', startAt: '2027-01-02', categories: ['Other'], ...over }));
  assert.equal(thin({}), true, 'Blessed bible verses');
  assert.equal(thin({ description: '' }), true, 'an empty description is thin too');
  assert.equal(thin({ startAt: '2027-01-02T13:30:00+05:30' }), true, 'a start time from its page is not enough detail');
  assert.equal(thin({ categories: ['Comedy'] }), false);
  assert.equal(thin({ description: 'A full evening of stand-up comedy with three comics, doors open at seven.' }), false);
});

test('a thin listing stays published and is also flagged for review', async () => {
  const BIBLE = 'https://allevents.in/dehradun/blessed-bible-verses/200030774982732';
  const listing = `<script type="application/ld+json">${JSON.stringify([
    { '@type': 'Event', name: 'Blessed bible verses', startDate: '2027-01-02', description: 'Thanks to lord Almighty', url: BIBLE, location: { name: 'Triple aar school campus', address: { addressLocality: 'Dehradun' } } }
  ])}</script>`;
  const { events, reviewCandidates, diagnostics } = await fetchAllEvents({ fetchPage: async (url) => (url === LIST ? listing : ''), delayMs: 0 });
  assert.equal(events.length, 1);
  assert.equal(events[0].curation.status, 'published');
  assert.equal(reviewCandidates.length, 1);
  assert.equal(reviewCandidates[0].id, events[0].id);
  assert.equal(reviewCandidates[0].curation.status, 'review');
  assert.equal(diagnostics.flaggedForReview, 1);
});

test('each source replaces only its own candidates in the review queue', async (t) => {
  await inTempDir(t);
  await fs.writeFile('data/events.json', '[]');
  const reddit = { id: 'r1', title: 'Reddit lead', sources: [{ provider: 'reddit', url: 'https://www.reddit.com/r/Dehradun/comments/r1/' }] };
  const oldListing = { id: 'a1', title: 'Old thin listing', sources: [{ provider: 'allevents', url: 'https://allevents.in/dehradun/a1/1' }] };
  const newListing = { id: 'a2', title: 'New thin listing', sources: [{ provider: 'allevents', url: 'https://allevents.in/dehradun/a2/1' }] };
  await fs.writeFile('data/review/reddit.json', JSON.stringify([reddit, oldListing]));
  await mergeAndWrite([{ source: 'allevents', events: [], reviewCandidates: [newListing] }]);
  assert.deepEqual((await read('data/review/reddit.json')).map((c) => c.id), ['r1', 'a2'], 'the Reddit lead survives a run without Reddit');
  await mergeAndWrite([{ source: 'reddit', events: [], reviewCandidates: [] }]);
  assert.deepEqual((await read('data/review/reddit.json')).map((c) => c.id), ['a2']);
});

test('rejecting a flagged listing records its link, and the merge takes it off the site', async (t) => {
  await inTempDir(t);
  const bible = event({ id: 'b', title: 'Blessed bible verses', description: 'Thanks to lord Almighty', startAt: '2030-01-02', categories: ['Other'],
    sources: [{ provider: 'allevents', url: 'https://allevents.in/dehradun/blessed-bible-verses/200030774982732' }] });
  const keep = event({ id: 'k', title: 'Doon Jazz Evening', sources: [{ provider: 'allevents', url: 'https://allevents.in/dehradun/jazz/2' }] });
  await mergeAndWrite([{ source: 'allevents', events: [bible, keep] }]);
  assert.equal((await read()).length, 2);
  const { decisions } = reject({ decisions: {}, curated: [] }, bible, 'closed on GitHub (#30)');
  assert.equal(decisions.b.sourceUrl, 'https://allevents.in/dehradun/blessed-bible-verses/200030774982732');
  await fs.writeFile('data/review/decisions.json', JSON.stringify(decisions));
  await mergeAndWrite([]);
  assert.deepEqual((await read()).map((e) => e.title), ['Doon Jazz Evening'], 'removed even on a run that did not fetch AllEvents');
  await mergeAndWrite([{ source: 'allevents', events: [bible, keep] }]);
  assert.deepEqual((await read()).map((e) => e.title), ['Doon Jazz Evening'], 'and stays off when AllEvents lists it again');
});

test('a rejection never removes a hand-checked event, nor several events that share one link', async (t) => {
  await inTempDir(t);
  const url = 'https://allevents.in/dehradun/open-mic/7';
  const approved = event({ id: 'm', title: 'Open Mic Night', startAt: '2030-01-05', sources: [{ provider: 'manual', url }, { provider: 'allevents', url }] });
  const shared = 'https://allevents.in/dehradun';
  const a = event({ id: 'a', title: 'Poetry Evening', sources: [{ provider: 'allevents', url: shared }] });
  const b = event({ id: 'b', title: 'Pottery Workshop', startAt: '2030-11-22T11:00:00+05:30', sources: [{ provider: 'allevents', url: shared }] });
  await fs.writeFile('data/review/decisions.json', JSON.stringify({
    later: { decision: 'rejected', title: 'same listing, new date', sourceUrl: url },
    fallback: { decision: 'rejected', title: 'a listing without its own link', sourceUrl: shared }
  }));
  await mergeAndWrite([{ source: 'manual', events: [approved] }, { source: 'allevents', events: [a, b] }]);
  assert.deepEqual((await read()).map((e) => e.title).sort(), ['Open Mic Night', 'Poetry Evening', 'Pottery Workshop']);
});

test('a rejection remembers the link from the issue when the listing has left the queue', () => {
  const candidate = { sources: [{ url: 'https://allevents.in/dehradun/x/1' }] };
  const parsed = { fields: { listing: 'https://allevents.in/dehradun/y/2', post: '' } };
  assert.equal(leadSourceUrl(parsed, candidate), 'https://allevents.in/dehradun/x/1');
  assert.equal(leadSourceUrl(parsed, undefined), 'https://allevents.in/dehradun/y/2');
  assert.equal(leadSourceUrl({ fields: { listing: '', post: 'https://www.reddit.com/r/Dehradun/comments/z/' } }, undefined), 'https://www.reddit.com/r/Dehradun/comments/z/');
  assert.equal(leadSourceUrl(null, undefined), '');
});

test('a flagged listing becomes a lead issue that reads back and can be approved', () => {
  const candidate = event({ id: '9f2c41', title: 'Blessed bible verses', description: 'Thanks to lord Almighty', startAt: '2030-01-02', categories: ['Other'],
    pricing: { type: 'paid', minPrice: 300, currency: 'INR' }, venue: { name: 'Triple aar school campus', city: 'Dehradun' },
    sources: [{ provider: 'allevents', url: 'https://allevents.in/dehradun/blessed-bible-verses/200030774982732' }], curation: { status: 'review', score: 2 } });
  const lead = sourceLead(candidate);
  assert.equal(lead.kind, 'listing');
  const { body } = leadIssue(lead);
  assert.match(body, /<!-- doon-lead kind=listing id=9f2c41 -->/);
  assert.match(body, /A listing from AllEvents that is on the site/);
  assert.match(body, /Close this issue to remove it from the site/);
  const parsed = parseLeadIssue(body);
  assert.equal(parsed.fields['listing'], 'https://allevents.in/dehradun/blessed-bible-verses/200030774982732');
  assert.equal(parsed.fields.price, '300');
  assert.equal(leadKey(parsed, 30), '9f2c41');
  const e = leadToEvent(parsed, { candidate, issueUrl: 'https://github.com/o/r/issues/30' });
  assert.equal(e.sources[0].url, 'https://allevents.in/dehradun/blessed-bible-verses/200030774982732');
  assert.equal(e.startAt, '2030-01-02', 'a date-only listing stays date-only');
  assert.equal(e.venue.name, 'Triple aar school campus');
  assert.equal(e.curation.status, 'published');
  assert.deepEqual(e.sources.map((s) => s.provider), ['manual', 'allevents']);

  const redditLead = sourceLead({ id: 'r1', title: 'Open mic', startAt: '2030-01-02', sources: [{ provider: 'reddit', url: 'https://www.reddit.com/r/Dehradun/comments/r1/' }] });
  assert.equal(redditLead.kind, 'reddit');
  assert.equal(redditLead.post, 'https://www.reddit.com/r/Dehradun/comments/r1/');
});
