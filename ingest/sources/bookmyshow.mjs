// BookMyShow's Dehradun events. BookMyShow refuses plain requests, so pages are fetched through Bright Data's
// Web Unlocker (BRIGHTDATA_API_TOKEN and BRIGHTDATA_UNLOCKER_ZONE):
// - the city listing builds its list of events in the browser, so the listing is asked for once its event
//   cards have appeared (the zone needs "manual expect" on), and only the cards at a Dehradun venue are kept;
// - each event's own page carries the event as structured data.
// Without these settings the source fetches nothing and its stored events stay as they are.
import { extractJsonLd, flattenObjects } from '../lib/jsonld.mjs';
import { stableId, slugify, priceFromOffers, categoryFromText, isDehradunText, isAreaVenue, stripHtml, nowIso, geoFrom } from '../lib/utils.mjs';

export const LIST = 'https://in.bookmyshow.com/explore/events-dehradun?cat=CT';
const UNLOCKER = 'https://api.brightdata.com/request';
const MAX_EVENT_PAGES = 25;
const PAGE_TIMEOUT_MS = 60_000;
// The whole source stays well inside the refresh job's 15 minutes; pages not reached by then wait for the next run.
const RUN_BUDGET_MS = 6 * 60_000;
// An attraction open every day for months (a gaming zone, an amusement park) is listed as one long "event".
const MAX_RUN_DAYS = 31;
// BookMyShow's own one-line summary says nothing the title doesn't.
const BOILERPLATE = /^Book online tickets for /i;
// Only the event cards say "₹ 499 onwards"; the page's own text around them doesn't.
const CARDS_LOADED = { text: 'onwards' };

/** The listing's event cards as { href, lines }: title, venue, genre and price, in that order. */
export function listingCards(html) {
  return [...html.matchAll(/<a\b[^>]*href=["']([^"']*\/events\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(([, href, inner]) => ({ href: new URL(href, LIST).href, lines: inner.split(/<[^>]+>/).map(stripHtml).filter(Boolean) }));
}

/**
 * The cards worth following, as { url, genre }: those at a venue in the area ("IRDT Auditorium: Dehradun").
 * A card whose genre is only "Entertainment" is an attraction open every day (a gaming zone, a play area).
 */
export function dehradunLinks(cards) {
  const out = new Map();
  for (const { href = '', lines = [] } of cards) {
    const url = href.match(/^https:\/\/in\.bookmyshow\.com\/events\/[a-z0-9-]+\/ET\d+/i)?.[0];
    const [, venue = '', genre = ''] = lines;
    if (url && /:\s*(dehradun|mussoorie|landour)$/i.test(venue) && !/^entertainment$/i.test(genre)) out.set(url, { url, genre });
  }
  return [...out.values()];
}

/** The page's "About The Event" text, which its page data carries as escaped HTML. */
export function aboutText(html) {
  const m = html.match(/"styleId":"desktop-about-the-event-description-text","text":"((?:[^"\\]|\\.)*)"/);
  if (!m) return '';
  try { return stripHtml(JSON.parse(`"${m[1]}"`).replace(/<\/p>|<br\s*\/?>/gi, ' ')); } catch { return ''; }
}

/**
 * The shows an event page lists in the area, one event each. A tour's page lists its shows in every city, so
 * only those at a venue in the area are kept.
 */
export function eventsFromPage(html, url, genre = '') {
  // Typed by kind: EducationEvent, ComedyEvent, MusicEvent...
  const shows = flattenObjects(extractJsonLd(html)).filter((x) => [].concat(x?.['@type'] || []).some((t) => /Event$/.test(t)) && x.startDate && x.name);
  const about = aboutText(html);
  return shows.map((o) => showEvent(o, url, about, genre)).filter(Boolean);
}

function showEvent(o, url, about, genre) {
  const loc = o.location || {};
  const a = loc.address || {};
  const address = stripHtml(typeof a === 'string' ? a : a.streetAddress || a.addressLocality || '');
  const venueName = stripHtml(loc.name || '').replace(/:\s*(Dehradun|Mussoorie)$/i, '') || 'Venue TBA';
  const where = `${loc.name || ''} ${address} ${a.addressLocality || ''}`;
  if (!isDehradunText(where) && !isAreaVenue(where)) return null;
  const start = Date.parse(o.startDate);
  if (o.endDate && Date.parse(o.endDate) - start > MAX_RUN_DAYS * 86400_000) return null;
  const title = stripHtml(o.name);
  const summary = BOILERPLATE.test(o.description || '') ? '' : stripHtml(o.description || '');
  const description = about || summary;
  const geo = geoFrom(loc);
  const checkedAt = nowIso();
  return {
    id: stableId('bookmyshow', o.url || url, o.startDate),
    slug: slugify(title),
    title,
    description,
    startAt: o.startDate,
    ...(o.endDate ? { endAt: o.endDate } : {}),
    venue: { name: venueName, address, city: 'Dehradun', ...(geo && { geo }) },
    categories: categoryFromText([title, genre, description, o.educationalLevel, venueName].filter(Boolean).join(' ')),
    pricing: priceFromOffers(o.offers) || { type: 'unknown', currency: 'INR' },
    sources: [{ provider: 'bookmyshow', url, externalId: (url.match(/ET\d+/) || [])[0], checkedAt, confidence: 0.95 }],
    verificationStatus: 'review',
    curation: { status: 'published', score: 8 },
    firstSeenAt: checkedAt,
    lastSeenAt: checkedAt,
    lastCheckedAt: checkedAt
  };
}

function unlocker(token, zone) {
  return async (url, { expect } = {}) => {
    const res = await fetch(UNLOCKER, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone, url, format: 'raw', country: 'in', ...(expect && { headers: { 'x-unblock-expect': JSON.stringify(expect) } }) }),
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS)
    });
    const text = await res.text();
    const refused = res.headers.get('x-brd-error');
    if (!res.ok || refused || !text) throw new Error(`Web Unlocker ${res.status} for ${url}: ${refused || 'empty page'}`);
    return text;
  };
}

// The option is for tests: a stand-in for the Web Unlocker fetcher.
export async function fetchBookMyShow({ fetchPage, budgetMs = RUN_BUDGET_MS } = {}) {
  const { BRIGHTDATA_API_TOKEN: token, BRIGHTDATA_UNLOCKER_ZONE: zone } = process.env;
  if (!fetchPage && !(token && zone)) return { source: 'bookmyshow', events: [], diagnostics: { configured: false } };
  const get = fetchPage || unlocker(token, zone);
  const deadline = Date.now() + budgetMs;
  const cards = listingCards(await get(LIST, { expect: CARDS_LOADED }));
  const links = dehradunLinks(cards);
  if (!cards.length) {
    const error = new Error('BookMyShow listing showed no event cards');
    error.diagnostics = { cards: 0 };
    throw error;
  }
  const events = [];
  let failed = 0, skipped = Math.max(0, links.length - MAX_EVENT_PAGES);
  for (const { url, genre } of links.slice(0, MAX_EVENT_PAGES)) {
    if (Date.now() > deadline) { skipped++; continue; }
    try {
      events.push(...eventsFromPage(await get(url), url, genre));
    } catch { failed++; }
  }
  // Every page failing says more about the fetcher than about BookMyShow's events.
  if (links.length && failed && failed === Math.min(links.length, MAX_EVENT_PAGES) - skipped) {
    const error = new Error('BookMyShow event pages could not be fetched');
    error.diagnostics = { cards: cards.length, dehradunLinks: links.length, eventPagesFailed: failed };
    throw error;
  }
  return {
    source: 'bookmyshow',
    events,
    // Only a run that read every Dehradun card's page has the whole list. Otherwise (a page failed or wasn't
    // reached, or the listing showed no Dehradun card, which is likelier a half-loaded page than an empty city)
    // stored events it didn't see are kept as they are.
    complete: links.length > 0 && failed === 0 && skipped === 0,
    partial: !(links.length > 0 && failed === 0 && skipped === 0),
    diagnostics: { cards: cards.length, dehradunLinks: links.length, eventPagesFailed: failed, eventPagesSkipped: skipped, eventsParsed: events.length }
  };
}
