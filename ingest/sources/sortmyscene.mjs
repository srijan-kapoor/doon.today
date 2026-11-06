// SortMyScene's Dehradun events: mostly club nights and parties, with the odd run or market. Its own listing
// loads them from a JSON endpoint, which refuses plain requests, so it is fetched through the same Web Unlocker
// zone as BookMyShow (BRIGHTDATA_API_TOKEN and BRIGHTDATA_UNLOCKER_ZONE). Event pages say nothing more without
// signing in, so the list is all there is. Without the settings the source fetches nothing.
import { stableId, slugify, categoryFromText, stripHtml, nowIso } from '../lib/utils.mjs';

export const API = 'https://sortmyscene.com/events/all-v2';
const UNLOCKER = 'https://api.brightdata.com/request';
const TIMEOUT_MS = 60_000;
// The list comes in pages; Dehradun has fit on one so far.
const MAX_PAGES = 3;
const IST_MS = 5.5 * 3600_000;

/** An epoch time as an IST timestamp ("2026-11-06T18:00:00+05:30"). */
export const istTime = (ms) => `${new Date(ms + IST_MS).toISOString().slice(0, 19)}+05:30`;

function pricing(e) {
  if (/^free$/i.test(e.priceLabel || '')) return { type: 'free', currency: 'INR' };
  if (Number(e.l_price) > 0) return { type: 'paid', minPrice: Number(e.l_price), currency: e.currency || 'INR' };
  // "RSVP" or no label: entry terms aren't given.
  return { type: 'unknown', currency: 'INR' };
}

/** One listed event, or null when it isn't a Dehradun event shown on the site. */
export function toEvent(e) {
  if (!e?.event_name || !Number.isFinite(e.rawStartTime) || e.displayEvent === false) return null;
  if (!/dehradun|mussoorie/i.test(e.location || '')) return null;
  const url = `https://sortmyscene.com/events/${e.event_url}`;
  const title = stripHtml(e.event_name);
  const venue = stripHtml(e.club || '').replace(/\s*-\s*dehradun$/i, '') || 'Venue TBA';
  const genres = (e.event_category || []).map(String);
  const found = categoryFromText(`${title} ${genres.join(' ')} ${venue}`);
  // The genre tags are music styles (Bollywood, House, Techno), so a party the rules can't place is a music night.
  const categories = found.length === 1 && found[0] === 'Other' && genres.length ? ['Music'] : found;
  const checkedAt = nowIso();
  return {
    id: stableId('sortmyscene', url, e.rawStartTime),
    slug: slugify(title),
    title,
    description: genres.length ? `Music: ${genres.join(', ')}.` : '',
    startAt: istTime(e.rawStartTime),
    ...(Number.isFinite(e.rawEndTime) && e.rawEndTime > e.rawStartTime ? { endAt: istTime(e.rawEndTime) } : {}),
    venue: { name: venue, address: '', city: 'Dehradun' },
    categories,
    pricing: pricing(e),
    sources: [{ provider: 'sortmyscene', url, externalId: String(e._id || '') || undefined, checkedAt, confidence: 0.85 }],
    verificationStatus: 'review',
    curation: { status: 'published', score: 6 },
    firstSeenAt: checkedAt,
    lastSeenAt: checkedAt,
    lastCheckedAt: checkedAt
  };
}

function unlocker(token, zone) {
  return async (url) => {
    const res = await fetch(UNLOCKER, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone, url, format: 'raw', country: 'in' }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const text = await res.text();
    const refused = res.headers.get('x-brd-error');
    if (!res.ok || refused || !text) throw new Error(`Web Unlocker ${res.status} for ${url}: ${refused || 'empty answer'}`);
    return text;
  };
}

// The option is for tests: a stand-in for the Web Unlocker fetcher.
export async function fetchSortMyScene({ fetchPage } = {}) {
  const { BRIGHTDATA_API_TOKEN: token, BRIGHTDATA_UNLOCKER_ZONE: zone } = process.env;
  if (!fetchPage && !(token && zone)) return { source: 'sortmyscene', events: [], diagnostics: { configured: false } };
  const get = fetchPage || unlocker(token, zone);
  const listed = [];
  let pages = 0, more = true;
  while (more && pages < MAX_PAGES) {
    const answer = JSON.parse(await get(`${API}?${new URLSearchParams({ page: String(pages), city: 'Dehradun' })}`));
    if (!Array.isArray(answer?.events)) {
      const error = new Error('SortMyScene answered without an event list');
      error.diagnostics = { pages, keys: Object.keys(answer || {}).slice(0, 10) };
      throw error;
    }
    listed.push(...answer.events);
    pages++;
    more = answer.hasMore === true;
  }
  const events = listed.map(toEvent).filter(Boolean);
  return {
    source: 'sortmyscene',
    events,
    // The whole list was read, so an empty answer means nothing is on; a list cut off by the page cap isn't.
    complete: !more,
    partial: more,
    diagnostics: { pages, listed: listed.length, eventsParsed: events.length }
  };
}
