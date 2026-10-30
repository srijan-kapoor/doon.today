import { fetchText } from '../lib/http.mjs';
import { eventLikeObjects, extractJsonLd, flattenObjects } from '../lib/jsonld.mjs';
import { stableId, slugify, priceFromOffers, priceFromText, categoryFromText, isLikelyDehradunEvent, stripHtml, nowIso, sleep, geoFrom } from '../lib/utils.mjs';
import { istDay, toInstant, DATE_ONLY } from '../../src/lib/dates.mjs';

// The full upcoming list. The plain city page (allevents.in/dehradun) shows only about half of it.
export const LIST = 'https://allevents.in/dehradun/all';
// The city listing gives a date but rarely a time, price or description; each event's own page has them.
// Fetched one at a time, and capped.
const MAX_EVENT_PAGES = 30;
const EVENT_PAGE_DELAY_MS = 700;
const EVENT_PAGE_TIMEOUT_MS = 10000;
// After this many blocked or rate-limited answers in a row, stop asking for more pages this run.
const MAX_BLOCKED_IN_A_ROW = 2;
// ...or after this many failures of any kind in a row (timeouts, errors).
const MAX_FAILED_IN_A_ROW = 3;
// An event that started this long ago is dropped by the merge anyway, so its page isn't worth a fetch.
const STARTED_GRACE_MS = 6 * 3600_000;
// A listing that says almost nothing about itself (a few words and no category) stays on the site, but also
// goes to the review queue, so a person can check it and remove it if it isn't an event. A start time doesn't
// count as detail: nearly every event page gives one.
const THIN_DESCRIPTION_CHARS = 60;
export function isThinListing(e) {
  return stripHtml(e.description || '').length < THIN_DESCRIPTION_CHARS
    && (e.categories || []).length === 1 && e.categories[0] === 'Other';
}
const startTime = (v = '') => Date.parse(DATE_ONLY.test(v) ? `${v}T23:59:59+05:30` : v);
const validTime = (v) => typeof v === 'string' && Number.isFinite(toInstant(v).getTime());

function toEvent(o, url = LIST) {
  const loc = o.location || o.venue || {};
  const addr = typeof loc.address === 'string'
    ? loc.address
    : [loc.address?.streetAddress, loc.address?.addressLocality].filter(Boolean).join(' ');
  const title = stripHtml(o.name || o.title || '');
  const description = stripHtml(o.description || '');
  const start = o.startDate || o.start_time || o.startAt;
  const venueName = stripHtml(loc.name || o.locationName || 'Venue TBA');

  if (!title || !start || !isLikelyDehradunEvent({
    title,
    description,
    venueName,
    address: stripHtml(addr || ''),
    city: o.city || loc.address?.addressLocality || ''
  })) return null;

  const checkedAt = nowIso();
  const text = [title, description, venueName, addr, o.city].filter(Boolean).join(' ');
  const geo = geoFrom(loc);

  return {
    id: stableId('allevents', o.url || o.id || title, start),
    slug: slugify(title),
    title,
    description,
    startAt: start,
    endAt: o.endDate || o.end_at,
    venue: { name: venueName, address: stripHtml(addr || ''), city: 'Dehradun', ...(geo && { geo }) },
    categories: categoryFromText(text),
    pricing: priceFromOffers(o.offers) || priceFromText(`${title} ${description}`),
    sources: [{ provider: 'allevents', url: o.url || url, externalId: String(o.id || '') || undefined, checkedAt, confidence: 0.75 }],
    verificationStatus: 'review',
    curation: { status: 'published', score: 4 },
    firstSeenAt: checkedAt,
    lastSeenAt: checkedAt,
    lastCheckedAt: checkedAt
  };
}

const pagePath = (value = '') => { try { return new URL(value).pathname.replace(/\/+$/, '').toLowerCase(); } catch { return ''; } };
const isEventType = (t) => [].concat(t || []).some((x) => /Event$/.test(String(x)));

/**
 * The description as the page shows it. The structured data carries only its first 300 characters, cut mid-word.
 * The page's own block ends with AllEvents' "Also check out other ... events" links, which are not the organiser's text.
 */
export function pageDescription(html) {
  const open = /<div\b[^>]*\bevent-description-html\b[^>]*>/i.exec(html);
  if (!open) return '';
  const from = open.index + open[0].length;
  const end = html.indexOf('</div>', from);
  if (end < 0) return '';
  const block = html.slice(from, end).replace(/<p\b[^>]*>\s*<br\s*\/?>\s*<\/p>/gi, '');
  return stripHtml(block.replace(/<p\b[^>]*>\s*(?:<br\s*\/?>\s*)?Also check out other[\s\S]*$/i, '').replace(/<\/p>|<br\s*\/?>/gi, ' '));
}

// The two texts are the same description when the shorter one, ignoring spaces, is the start of the longer one.
const squash = (text) => text.replace(/\s+/g, '');
// A structured-data text too short to tell descriptions apart (or missing) proves nothing, so it keeps the structured data's.
const continues = (full, cut) => squash(cut).length >= 20 && squash(full).startsWith(squash(cut));

/**
 * What an event's own AllEvents page says about it: price (null when none), start, end and description.
 * Null when the page has no structured data for this event. Only this event's own structured data counts,
 * matched by its link or title, so a "similar events" block can't lend its details.
 * Throws when the page can't be fetched, so the caller can tell missing details from a blocked page.
 */
export async function detailsFromEventPage(url, { title = '', fetchPage = fetchText } = {}) {
  const html = await fetchPage(url, { timeoutMs: EVENT_PAGE_TIMEOUT_MS });
  const events = flattenObjects(extractJsonLd(html)).filter((o) => isEventType(o?.['@type']));
  const own = events.find((o) => pagePath(o.url) && pagePath(o.url) === pagePath(url))
    || events.find((o) => title && stripHtml(o.name || '').toLowerCase() === title.toLowerCase())
    || (events.length === 1 ? events[0] : null);
  if (!own) return null;
  const cut = stripHtml(own.description || '');
  const full = pageDescription(html);
  // The page's text wins only when it carries on from the structured data's, so a block about something else can't replace it.
  const description = full.length > cut.length && continues(full, cut) ? full : cut;
  return { pricing: priceFromOffers(own.offers), startAt: own.startDate, endAt: own.endDate, description };
}

/**
 * Fills in what the listing left out from the event's own page, never overriding what the listing said.
 * A start time only counts on the listing's own IST day, so a page can't move an event to another date.
 * Returns which details were added.
 */
export function applyEventDetails(e, details) {
  const added = { price: false, time: false };
  if (!details) return added;
  if (details.pricing && e.pricing.type === 'unknown') { e.pricing = details.pricing; added.price = true; }
  // Start and end stay in one form, both dates or both times, with the end not before the start.
  const timedStart = DATE_ONLY.test(e.startAt) && validTime(details.startAt) && !DATE_ONLY.test(details.startAt)
    && istDay(details.startAt) === e.startAt ? details.startAt : null;
  const start = timedStart || e.startAt;
  const pageEnd = validTime(details.endAt) && DATE_ONLY.test(details.endAt) === DATE_ONLY.test(start)
    && toInstant(details.endAt) >= toInstant(start) ? details.endAt : null;
  // With a time, the listing's bare end date must become the page's end time on that day. If the page
  // can't give one, the event keeps its dates rather than mixing a time with a date.
  const bareEnd = timedStart && DATE_ONLY.test(e.endAt || '');
  const endOnDay = pageEnd && istDay(pageEnd) === e.endAt;
  if (timedStart && (!bareEnd || endOnDay)) {
    e.startAt = timedStart;
    added.time = true;
    if (bareEnd) e.endAt = pageEnd;
  }
  if (!e.endAt && pageEnd) e.endAt = pageEnd;
  if (details.description.length > (e.description || '').length) {
    e.description = details.description;
    e.categories = categoryFromText([e.title, e.description, e.venue.name, e.venue.address].filter(Boolean).join(' '));
    if (e.pricing.type === 'unknown') e.pricing = priceFromText(`${e.title} ${e.description}`);
  }
  return added;
}

/**
 * Fills in prices, times and descriptions the listing didn't give, from each event's own page: soonest
 * events first, one page at a time, capped per run, and stopping early if AllEvents starts refusing.
 * A failed page leaves the event as the listing described it.
 */
export async function addDetailsFromEventPages(events, { fetchPage = fetchText, delayMs = EVENT_PAGE_DELAY_MS, max = MAX_EVENT_PAGES, now = Date.now() } = {}) {
  const queue = events
    .filter((e) => /^https:\/\/allevents\.in\//.test(e.sources[0]?.url || ''))
    .filter((e) => !(startTime(e.startAt) < now - STARTED_GRACE_MS))
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)))
    .slice(0, max);
  let fetched = 0, prices = 0, times = 0, failed = 0, blockedInARow = 0, failedInARow = 0;
  const stop = () => blockedInARow >= MAX_BLOCKED_IN_A_ROW || failedInARow >= MAX_FAILED_IN_A_ROW;
  for (const e of queue) {
    if (stop()) break;
    if (fetched > 0 && delayMs) await sleep(delayMs);
    fetched++;
    try {
      const added = applyEventDetails(e, await detailsFromEventPage(e.sources[0].url, { title: e.title, fetchPage }));
      blockedInARow = 0; failedInARow = 0;
      if (added.price) prices++;
      if (added.time) times++;
    } catch (error) {
      failed++; failedInARow++;
      if ([403, 429].includes(error?.diagnostics?.status)) blockedInARow++;
    }
  }
  return { eventPagesFetched: fetched, pricesFound: prices, timesFound: times, eventPagesFailed: failed, ...(stop() ? { eventPagesStoppedEarly: true } : {}) };
}

export async function fetchAllEvents({ fetchPage = fetchText, delayMs } = {}) {
  const html = await fetchPage(LIST);
  const candidates = [...eventLikeObjects(html)];
  const next = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (next) {
    try { candidates.push(...flattenObjects(JSON.parse(next[1]))); } catch {}
  }
  const events = [];
  const seen = new Set();
  for (const o of candidates) {
    const e = toEvent(o);
    if (e && !seen.has(e.id)) { seen.add(e.id); events.push(e); }
  }
  const details = await addDetailsFromEventPages(events, { fetchPage, delayMs });
  const reviewCandidates = events.filter(isThinListing).map((e) => ({ ...e, curation: { status: 'review', score: 2 } }));
  return { source: 'allevents', events, reviewCandidates, diagnostics: { candidates: candidates.length, flaggedForReview: reviewCandidates.length, ...details } };
}
