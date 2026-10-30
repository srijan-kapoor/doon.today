import test from 'node:test';
import assert from 'node:assert/strict';
import { geoFrom, isInDehradun } from '../ingest/lib/utils.mjs';
import { fetchDistrict } from '../ingest/sources/district.mjs';
import { fetchAllEvents, LIST } from '../ingest/sources/allevents.mjs';
import { inTempDir } from './helpers.mjs';

const ldPage = (objects) => `<html><script type="application/ld+json">${JSON.stringify(objects)}</script></html>`;

test('coordinates are read as numbers from either source shape, and only kept inside Dehradun', () => {
  assert.deepEqual(geoFrom({ geo: { '@type': 'GeoCoordinates', latitude: 30.3129, longitude: 78.0534 } }), { lat: 30.3129, lng: 78.0534 }, 'District gives numbers');
  assert.deepEqual(geoFrom({ geo: { latitude: '30.323900', longitude: '78.051003' } }), { lat: 30.3239, lng: 78.051 }, 'AllEvents gives strings');
  assert.deepEqual(geoFrom({ geo: { latitude: 30.45989123, longitude: 78.06641987 } }), { lat: 30.45989, lng: 78.06642 }, 'Mussoorie is in; rounded to about a metre');
  assert.equal(geoFrom({ geo: { latitude: 28.6139, longitude: 77.209 } }), undefined, 'Delhi is out');
  assert.equal(geoFrom({ geo: { latitude: 43.3256, longitude: -83.7385 } }), undefined, 'Frankenmuth is out');
  assert.equal(geoFrom({ geo: { latitude: 0, longitude: 0 } }), undefined, '0,0 is a placeholder');
  assert.equal(geoFrom({ geo: { latitude: '', longitude: '' } }), undefined, 'empty strings are not 0');
  assert.equal(geoFrom({ geo: { latitude: 'n/a', longitude: 78 } }), undefined);
  assert.equal(geoFrom({ geo: { latitude: 30.3 } }), undefined, 'half a point is no point');
  assert.equal(geoFrom({ geo: 'Dehradun' }), undefined);
  assert.equal(geoFrom({}), undefined);
  assert.equal(geoFrom(undefined), undefined);
  assert.equal(isInDehradun({ lat: 30.3, lng: 78.0 }), true);
  assert.equal(isInDehradun({ lat: '30.3', lng: '78.0' }), false, 'stored coordinates must be numbers');
});

test('District and AllEvents events carry their venue coordinates', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const place = (name, geo) => ({ name, address: { addressLocality: 'Dehradun' }, ...(geo && { geo }) });
  globalThis.fetch = async (url) => Object.defineProperty(new Response(ldPage([
    { '@type': 'Event', name: 'Doon Music Night', startDate: '2030-11-01T18:00:00+05:30', url: 'https://www.district.in/events/a', location: place('Rajpur Road Hall', { latitude: 30.3431, longitude: 78.0482 }) },
    { '@type': 'Event', name: 'Doon Poetry Night', startDate: '2030-11-02T18:00:00+05:30', url: 'https://www.district.in/events/b', location: place('Cafe Dehradun') }
  ]), { status: 200 }), 'url', { value: url });
  const district = await fetchDistrict();
  assert.deepEqual(district.events.find((e) => e.title === 'Doon Music Night').venue.geo, { lat: 30.3431, lng: 78.0482 });
  assert.equal('geo' in district.events.find((e) => e.title === 'Doon Poetry Night').venue, false, 'no key at all when there are no coordinates');

  const listing = ldPage([{ '@type': 'Event', name: 'Framed In Crimson', startDate: '2030-10-31', url: 'https://allevents.in/dehradun/framed/1',
    location: { ...place('Hotel Vishranti: Dehradun'), geo: { '@type': 'GeoCoordinates', latitude: '30.360300', longitude: '78.071999' } } }]);
  const allevents = await fetchAllEvents({ fetchPage: async (url) => (url === LIST ? listing : ''), delayMs: 0 });
  assert.deepEqual(allevents.events[0].venue.geo, { lat: 30.3603, lng: 78.072 });
});

test('known venues fill in coordinates and area only where a source gave none', async (t) => {
  const { default: fs } = await import('node:fs/promises');
  const { default: os } = await import('node:os');
  const { default: path } = await import('node:path');
  const { knownVenueFor, mergeAndWrite } = await import('../ingest/merge.mjs');
  const venues = JSON.parse(await fs.readFile(new URL('../data/venues.json', import.meta.url), 'utf8'));
  for (const v of venues) {
    assert.ok(isInDehradun(v.geo), `${v.name} is near Dehradun`);
    assert.equal(knownVenueFor({ name: v.name }, venues), v, `${v.name} matches its own name`);
  }
  const named = (name) => knownVenueFor({ name }, venues)?.name;
  assert.equal(named('Himalayan Cultural Centre — Auditorium'), 'Himalayan Cultural Centre', "Virasat's venue");
  assert.equal(named('Graphic Era Deemed to be University'), 'Graphic Era (Deemed to be) University');
  assert.equal(named('Graphic Era Hill University'), undefined, 'a different campus');
  assert.equal(named('BLAAZE - Mall of Dehradun'), 'Mall of Dehradun');
  assert.equal(named('Smallmall of Dehradunia'), undefined, 'whole words only');

  await inTempDir(t);
  await fs.writeFile('data/venues.json', JSON.stringify(venues));
  const ev = (id, venue) => ({ id, slug: id, title: `Virasat ${id}`, startAt: '2030-11-01T19:00:00+05:30', venue: { city: 'Dehradun', ...venue },
    categories: ['Culture'], pricing: { type: 'unknown', currency: 'INR' }, sources: [{ provider: 'virasat', url: `https://example.test/${id}` }],
    curation: { status: 'published', score: 8 }, firstSeenAt: '2030-01-01T00:00:00Z', lastSeenAt: '2030-01-01T00:00:00Z', lastCheckedAt: '2030-01-01T00:00:00Z' });
  await mergeAndWrite([{ source: 'virasat', events: [
    ev('a', { name: 'Himalayan Cultural Centre — Auditorium' }),
    ev('b', { name: 'Himalayan Cultural Centre — Lawn', geo: { lat: 30.355, lng: 78.012 } }),
    ev('c', { name: 'Somewhere New' })
  ] }]);
  const out = Object.fromEntries(JSON.parse(await fs.readFile('data/events.json', 'utf8')).map((e) => [e.id, e.venue]));
  assert.deepEqual(out.a.geo, { lat: 30.35473, lng: 78.01122 });
  assert.equal(out.a.geoFrom, 'table');
  assert.equal(out.b.geoFrom, undefined, "a source's own coordinates are not marked");
  assert.equal(out.a.area, 'Garhi Cantt');
  assert.deepEqual(out.b.geo, { lat: 30.355, lng: 78.012 }, "a source's own coordinates stand");
  assert.equal(out.c.geo, undefined, 'unknown venues stay without');
});

test('a corrected or removed venue-table entry takes effect on events already stored', async (t) => {
  const { default: fs } = await import('node:fs/promises');
  const { default: os } = await import('node:os');
  const { default: path } = await import('node:path');
  const { mergeAndWrite } = await import('../ingest/merge.mjs');
  await inTempDir(t);
  const entry = (geo) => [{ name: 'Himalayan Cultural Centre', match: ['himalayan cultural centre'], geo, source: 'https://example.test/' }];
  const event = { id: 'v', slug: 'v', title: 'Virasat evening', startAt: '2030-11-01T19:00:00+05:30', venue: { name: 'Himalayan Cultural Centre — Auditorium', city: 'Dehradun' },
    categories: ['Culture'], pricing: { type: 'unknown', currency: 'INR' }, sources: [{ provider: 'virasat', url: 'https://example.test/v' }],
    curation: { status: 'published', score: 8 }, firstSeenAt: '2030-01-01T00:00:00Z', lastSeenAt: '2030-01-01T00:00:00Z', lastCheckedAt: '2030-01-01T00:00:00Z' };
  const run = async (table) => {
    await fs.writeFile('data/venues.json', JSON.stringify(table));
    await mergeAndWrite([{ source: 'virasat', events: [structuredClone(event)] }]);
    return JSON.parse(await fs.readFile('data/events.json', 'utf8'))[0].venue;
  };
  assert.deepEqual((await run(entry({ lat: 30.1, lng: 78.1 }))).geo, { lat: 30.1, lng: 78.1 });
  assert.deepEqual((await run(entry({ lat: 30.35473, lng: 78.01122 }))).geo, { lat: 30.35473, lng: 78.01122 }, 'a corrected pin replaces the old one');
  const gone = await run([]);
  assert.equal(gone.geo, undefined, 'a removed entry takes its pin with it');
  assert.equal(gone.geoFrom, undefined);
  await fs.writeFile('data/venues.json', '{}');
  await mergeAndWrite([{ source: 'virasat', events: [structuredClone(event)] }]);
  assert.equal(JSON.parse(await fs.readFile('data/events.json', 'utf8')).length, 1, 'a table that is not a list is ignored, not a crash');
});
