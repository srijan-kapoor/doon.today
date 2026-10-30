import fs from 'node:fs/promises';
import { slugify, eventPassesGeo, areaFromText, isPlaceholderVenue, isPlaceholderDescription, currentCategories, withAddedCategories } from './lib/utils.mjs';
import { readJson, CURATED_PATH, DECISIONS_PATH, QUEUE_PATH, pendingCandidates } from './lib/review.mjs';
import { istDay, compareEventStarts, isUnexpiredEvent, occurrencesOf, toInstant } from '../src/lib/dates.mjs';
export { istDay } from '../src/lib/dates.mjs';

const SOURCE_RANK = {
  manual: 100,
  district: 95,
  virasat: 90,
  thrillzone: 90,
  literaturefestival: 90,
  meetup: 85,
  gdg: 85,
  allevents: 75,
  reddit: 50
};

function norm(s='') { return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function tokens(s='') { return new Set(norm(s).split(' ').filter(Boolean)); }
function similarity(a='', b='') {
  const A=tokens(a), B=tokens(b);
  if (!A.size || !B.size) return 0;
  let common=0; for (const t of A) if (B.has(t)) common++;
  return common / Math.max(A.size, B.size);
}
// Venue names differ in verbosity between sources ("J P Plaza & Garden" vs "J P Plaza & Garden wedding
// point and party lawn"), so a shorter name fully contained in a longer one counts as a match.
function venueSimilarity(a='', b='') {
  const A=tokens(a), B=tokens(b);
  const base=similarity(a,b);
  const smaller=Math.min(A.size,B.size);
  if (smaller < 2) return base;
  let common=0; for (const t of A) if (B.has(t)) common++;
  return Math.max(base, common / smaller);
}
function sourceRank(e) {
  return Math.max(0, ...(e.sources || []).map(s => SOURCE_RANK[s.provider] || 0));
}
function eventTimestamp(e) {
  return Math.max(
    ...[e.lastCheckedAt, e.lastSeenAt, e.firstSeenAt]
      .map(value => Date.parse(value || ''))
      .filter(Number.isFinite),
    0
  );
}
// A hand-checked entry sent in by someone other than the organizer (`community: true`) doesn't verify an event
// on its own; a ticketing platform or organizer page listing the same event still does.
function verificationStatus(sources=[]) {
  const community=sources.some(source => source.provider === 'manual' && source.community);
  const providers=new Set(sources.filter(source => !(source.provider === 'manual' && source.community)).map(source => source.provider));
  if (['manual','district','virasat','thrillzone','literaturefestival','meetup','gdg'].some(provider => providers.has(provider))) return 'verified';
  if (community || (providers.size === 1 && providers.has('reddit'))) return 'community-reported';
  return 'review';
}
export function sameEvent(a,b) {
  if (!a?.startAt || !b?.startAt) return false;
  if (istDay(a.startAt) !== istDay(b.startAt)) return false;
  const titleScore=similarity(a.title,b.title);
  const venueScore=venueSimilarity(a.venue?.name,b.venue?.name);
  const venueMatches=venueScore >= 0.5 || isPlaceholderVenue(a.venue?.name) || isPlaceholderVenue(b.venue?.name);
  if (titleScore >= 0.72 && venueMatches) return true;
  // Two posts about one event are often titled differently ("Melophile Session 02: Daft Punk's Random Access
  // Memories" and "Melophile - Daft Punk Random Access Memories Album Listening Meet"). Starting at the same
  // minute at the same venue, half the words and at least three of them in common is enough, unless they end on
  // different days or their titles name different numbers (a 100-hour and a 200-hour course).
  return venueScore >= 0.5 && sameMinute(a.startAt,b.startAt) && titleScore >= 0.5 && commonWords(a.title,b.title) >= 3
    && !(a.endAt && b.endAt && istDay(a.endAt) !== istDay(b.endAt)) && !conflictingNumbers(a.title,b.title);
}
const sameMinute=(a,b)=>/T\d/.test(a) && /T\d/.test(b) && Math.floor(toInstant(a).getTime()/60000) === Math.floor(toInstant(b).getTime()/60000);
function commonWords(a='',b='') { const B=tokens(b); let n=0; for (const t of tokens(a)) if (B.has(t)) n++; return n; }
// Numbers that only one title has, when both have some: "100 Hour" against "200 Hour". A number on one side only
// ("Session 02") is not a conflict.
function conflictingNumbers(a='',b='') {
  const nums=(t)=>new Set([...tokens(t)].filter(w=>/^\d+$/.test(w)).map(Number));
  const A=nums(a), B=nums(b);
  return A.size > 0 && B.size > 0 && ([...A].some(n=>!B.has(n)) || [...B].some(n=>!A.has(n)));
}
function sourceKey(s){ return `${s.provider}|${s.url}`; }

// The fields a calendar subscriber would notice changing.
function fingerprint(e) {
  return JSON.stringify([e.title, e.startAt, e.endAt||null, e.venue?.name, e.venue?.address||'', e.occurrences||null]);
}

// Hand-checked venues (data/venues.json): a venue whose name contains one of a known venue's phrases, as whole
// words, gets that venue's coordinates and area when its source gave none. Virasat's programme page, for one,
// names its venue but gives no coordinates. Coordinates from the table are marked `geoFrom: 'table'` and worked
// out again on every run, so a corrected or removed entry takes effect instead of sticking to stored events.
const VENUES_PATH = 'data/venues.json';
export function knownVenueFor(venue, venues = []) {
  const name = ` ${norm(venue?.name)} `;
  return venues.find(v => v && (v.match || []).some(phrase => name.includes(` ${norm(phrase)} `)));
}
function withKnownVenue(e, venues) {
  const fromTable = e.venue?.geoFrom === 'table';
  if (e.venue?.geo && !fromTable && e.venue?.area) return e;
  const known = knownVenueFor(e.venue, venues);
  if (!known && !fromTable) return e;
  const venue = { ...e.venue };
  if (fromTable) { delete venue.geo; delete venue.geoFrom; }
  if (!venue.geo && known?.geo) { venue.geo = known.geo; venue.geoFrom = 'table'; }
  if (!venue.area && known?.area) venue.area = known.area;
  return { ...e, venue };
}

// Venue keys are written in one order, whichever step added them. Without this, a run that re-derives an
// event's table coordinates writes area before geo and a run that adds them fresh writes geo first, so
// events.json changed on every refresh with no change to any event.
const VENUE_KEYS = ['name', 'address', 'city', 'area', 'geo', 'geoFrom'];
function withOrderedVenue(e) {
  if (!e.venue) return e;
  const venue = {};
  for (const key of VENUE_KEYS) if (key in e.venue) venue[key] = e.venue[key];
  return { ...e, venue: { ...venue, ...e.venue } };
}

// Events that start together are ordered by id, so their order doesn't depend on which sources ran.
// A plain comparison, not localeCompare, so the order is the same on every machine that runs a refresh.
const compareText = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
const compareForOutput = (a, b) => compareEventStarts(a, b) || compareText(String(a.id), String(b.id));

// An event a person checked by hand: approved from the review queue or added to curated-events.json.
const isHandChecked = (e) => (e.sources || []).some((s) => s.provider === 'manual');

// Fill in venue.area from the address or venue name when a source did not provide one.
function withArea(e) {
  if (e.venue?.area) return e;
  const area=areaFromText(`${e.venue?.address||''} ${e.venue?.name||''}`);
  return area ? {...e, venue:{...e.venue, area}} : e;
}

// An event is dropped after this many successful runs of all of its sources without it appearing.
export const MISSED_RUNS_LIMIT = 3;

function normalizeUrl(value='') {
  try { const u=new URL(value); return `${u.origin}${u.pathname}`.replace(/\/+$/,'').toLowerCase(); }
  catch { return String(value).toLowerCase(); }
}
// What a source calls this event: its external id, else its page URL. Used to recognise the same event
// after it was rescheduled upstream, when title, day and venue no longer line up.
export function sourceIdentities(e) {
  return (e.sources||[]).flatMap(s => {
    if (s.externalId) return [`${s.provider}|id|${s.externalId}`];
    return s.url ? [`${s.provider}|url|${normalizeUrl(s.url)}`] : [];
  });
}
// An identity shared by several events in one list (a listing page used as the URL of many events, or a
// recurring series on one page) says nothing about which one is which, so it is never used to match.
function ambiguousIdentities(list) {
  const counts=new Map();
  for (const e of list) for (const id of new Set(sourceIdentities(e))) counts.set(id,(counts.get(id)||0)+1);
  return new Set([...counts].filter(([,n])=>n>1).map(([id])=>id));
}
function sharesSource(a,b,ambiguous) {
  const ids=new Set(sourceIdentities(a));
  return sourceIdentities(b).some(id => ids.has(id) && !ambiguous.has(id));
}
// Misses only count when every source of the event answered this run; otherwise the count is left alone.
// A source that returned nothing proves nothing, unless it says its answer was complete (`complete: true`):
// a small source whose one upcoming event was cancelled really does have nothing.
function missedRunsAfter(e, answered) {
  const before=e.missedRuns||0;
  const providers=[...new Set((e.sources||[]).map(s=>s.provider))];
  if (providers.length === 0) return before;
  return providers.every(p => answered.has(p)) ? before+1 : before;
}
// Prices from two sources of one event. A known price beats an unknown one. With `combine` (two sources in
// the same run), two paid prices make one range, so "From ₹..." is never above the real minimum. Without
// it (this run against the stored copy), the preferred side's price stands, so a stale price can't stick.
// A hand-checked price is never changed by another source, and free against paid goes to the preferred.
function mergePricing(preferred={type:'unknown'}, secondary={type:'unknown'}, {combine=false, handChecked=false}={}) {
  // "Paid" with no amount says less than another source's amount, so it is treated like unknown.
  const known = (p) => p.type === 'free' || (p.type === 'paid' && p.minPrice > 0);
  if (!known(preferred)) return known(secondary) ? secondary : preferred;
  if (!combine || handChecked) return preferred;
  if (preferred.type !== 'paid' || secondary.type !== 'paid' || !preferred.minPrice || !secondary.minPrice) return preferred;
  const minPrice = Math.min(preferred.minPrice, secondary.minPrice);
  const maxPrice = Math.max(preferred.maxPrice || preferred.minPrice, secondary.maxPrice || secondary.minPrice);
  return { ...preferred, minPrice, ...(maxPrice > minPrice ? { maxPrice } : {}) };
}
// A start time beats a bare date on the same IST day, so a run where a source could only give the date (its
// event page was blocked, say) doesn't take a known time, and the end that goes with it, off the event.
function timing(preferred, secondary) {
  const bare = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  if (bare(preferred.startAt) && secondary.startAt && !bare(secondary.startAt) && istDay(secondary.startAt) === preferred.startAt) {
    return { startAt: secondary.startAt, endAt: secondary.endAt };
  }
  return { startAt: preferred.startAt, endAt: preferred.endAt };
}
// Coordinates come from whichever copy has them, so a run or a source without them doesn't drop a known
// location; but only from a copy at the same venue, so an event that moved never keeps the old pin. Coordinates
// the venue table filled in are never carried over: the table step works them out again.
function venueOf(preferred, secondary) {
  const venue = isPlaceholderVenue(preferred.venue?.name) && !isPlaceholderVenue(secondary.venue?.name) ? secondary.venue : preferred.venue;
  const sameVenue = (other) => other === venue || venueSimilarity(other?.name, venue?.name) >= 0.5;
  const geo = venue?.geo || [preferred.venue, secondary.venue].find((other) => other?.geo && other.geoFrom !== 'table' && sameVenue(other))?.geo;
  return geo && venue ? { ...venue, geo } : venue;
}
// The dates an event runs on come from the preferred copy. A copy without them (a run where the source's event
// page could not be read) does not take them off, but only the other copy's list with the same span is kept:
// one that no longer fits startAt..endAt is stale, and a list not starting at the merged startAt is not valid.
function occurrencesFor(preferred, secondary, timed) {
  const sameSpan = secondary.startAt === preferred.startAt && (secondary.endAt||null) === (preferred.endAt||null);
  const list = preferred.occurrences || (sameSpan ? secondary.occurrences : undefined);
  return list && occurrencesOf({ ...timed, occurrences: list }) ? list : undefined;
}
function mergePair(a,b,{combinePrices=false}={}) {
  const preferred = sourceRank(b) > sourceRank(a) || (sourceRank(b) === sourceRank(a) && eventTimestamp(b) >= eventTimestamp(a)) ? b : a;
  const secondary = preferred === a ? b : a;
  const sources=[...(a.sources||[]),...(b.sources||[])];
  const unique=[...new Map(sources.map(s=>[sourceKey(s),s])).values()]
    .sort((x,y)=>(SOURCE_RANK[y.provider]||0)-(SOURCE_RANK[x.provider]||0));
  const merged = {
    ...secondary,
    ...preferred,
    id: a.id || b.id,
    slug: a.slug || b.slug || slugify(preferred.title),
    sources: unique,
    verificationStatus: verificationStatus(unique),
    firstSeenAt: [a.firstSeenAt,b.firstSeenAt].filter(Boolean).sort()[0],
    lastSeenAt: [a.lastSeenAt,b.lastSeenAt].filter(Boolean).sort().at(-1),
    lastCheckedAt: [a.lastCheckedAt,b.lastCheckedAt].filter(Boolean).sort().at(-1),
    curation: preferred.curation?.status === 'published' ? preferred.curation : secondary.curation,
    // The preferred source wins, except where it only has a stand-in and the other source knows better:
    // Thrill Zone's listing has no venue, but AllEvents gives the same run's venue and address.
    venue: venueOf(preferred, secondary),
    description: isPlaceholderDescription(preferred.description) && !isPlaceholderDescription(secondary.description) ? secondary.description : preferred.description,
    pricing: mergePricing(preferred.pricing, secondary.pricing, { combine: combinePrices, handChecked: isHandChecked(preferred) }),
    ...timing(preferred, secondary)
  };
  const occurrences = occurrencesFor(preferred, secondary, merged);
  if (occurrences) merged.occurrences = occurrences; else delete merged.occurrences;
  return merged;
}

export async function mergeAndWrite(sourceResults) {
  // Events a person checked by hand always take part, like another source that returned them.
  const curated=await readJson(CURATED_PATH,[]);
  const table=await readJson(VENUES_PATH,[]);
  const venues=Array.isArray(table) ? table : [];
  const results=curated.length ? [...sourceResults,{source:'manual',events:curated}] : sourceResults;
  let previous=[];
  try { previous=JSON.parse(await fs.readFile('data/events.json','utf8')); } catch {}

  previous = previous.filter(eventPassesGeo);

  const current=[];
  for (const r of results) {
    for (const incoming of r.events || []) {
      if (!eventPassesGeo(incoming)) continue;
      const idx=current.findIndex(existing => sameEvent(existing,incoming));
      if (idx >= 0) current[idx]=mergePair(current[idx],incoming,{combinePrices:true});
      else current.push({...incoming, verificationStatus: verificationStatus(incoming.sources)});
    }
  }

  const ambiguous=new Set([...ambiguousIdentities(current),...ambiguousIdentities(previous)]);
  const same=(a,b)=>sameEvent(a,b) || sharesSource(a,b,ambiguous);
  // Sources that ran successfully this run (failed adapters are not in `results`) and returned events, or said
  // their empty answer was complete.
  const answered=new Set(results.filter(r => (r.events||[]).length > 0 || r.complete === true).map(r => r.source));

  const merged=[];
  for (const incoming of current) {
    // A stored event keeps its id and slug when its source moves it to another day, so calendar UIDs stay put.
    const old=previous.find(e => same(e,incoming));
    const event=old ? mergePair(old,incoming) : incoming;
    delete event.missedRuns;
    // Subscribed calendars only re-read an event when SEQUENCE goes up, so bump it on a real change.
    if (old && fingerprint(old) !== fingerprint(event)) {
      event.sequence=(old.sequence||0)+1;
      event.modifiedAt=new Date().toISOString();
    }
    merged.push(event);
  }

  const now=Date.now();
  const retained=[];
  let dropped=0;
  for (const e of previous) {
    if (!isUnexpiredEvent(e,now)) continue;
    if (merged.some(x => same(x,e))) continue;
    // Previously stored duplicates collapse here instead of both being kept.
    const dup=retained.findIndex(x => same(x,e));
    if (dup >= 0) { retained[dup]=mergePair(retained[dup],e); continue; }
    // Stored events their sources no longer list (removed or moved) go after a few successful runs.
    const missed=missedRunsAfter(e,answered);
    if (missed >= MISSED_RUNS_LIMIT) { dropped++; continue; }
    const kept={...e, verificationStatus: verificationStatus(e.sources)};
    if (missed > 0) kept.missedRuns=missed; else delete kept.missedRuns;
    retained.push(kept);
  }
  merged.push(...retained);

  // A listing someone rejected in review (by closing its lead issue) comes off the site, matched by its link.
  // A hand-checked event is never removed this way, and a link several events share (a listing site's city
  // page used as a fallback) identifies none of them.
  const linkCount=new Map();
  for (const e of merged) for (const u of new Set((e.sources||[]).map(s=>normalizeUrl(s.url)))) linkCount.set(u,(linkCount.get(u)||0)+1);
  const rejectedLinks=new Set(Object.values(await readJson(DECISIONS_PATH,{}))
    .filter(d=>d?.decision==='rejected' && d.sourceUrl).map(d=>normalizeUrl(d.sourceUrl))
    .filter(u=>(linkCount.get(u)||0)<=1));
  const rejected=e=>!isHandChecked(e) && (e.sources||[]).some(s=>rejectedLinks.has(normalizeUrl(s.url)));
  const out=merged
    .filter(e => !rejected(e))
    .filter(eventPassesGeo)
    .filter(e => e.curation?.status === 'published')
    .filter(e => isUnexpiredEvent(e,now))
    .map(e => withKnownVenue(e, venues))
    .map(withArea)
    .map(withOrderedVenue)
    .map(e => ({...e, categories: isHandChecked(e) ? withAddedCategories(e.categories, `${e.title} ${e.description || ''}`) : currentCategories(e.categories)}))
    .sort(compareForOutput);

  await fs.mkdir('data',{recursive:true});
  await fs.writeFile('data/events.json',JSON.stringify(out,null,2)+'\n');

  // The review queue holds candidates from several sources (Reddit posts, thin AllEvents listings). Each
  // source that ran replaces its own candidates; a source that didn't run (a District-only run, a failed
  // adapter) keeps the ones it had. Leads someone already approved or rejected stay out of the queue.
  const ran=new Set(results.map(r=>r.source));
  const decisions=await readJson(DECISIONS_PATH,{});
  await fs.mkdir('data/review',{recursive:true});
  // Candidates queued before other sources could add any were all Reddit posts.
  const kept=(await readJson(QUEUE_PATH,[])).filter(c=>!ran.has(c.sources?.[0]?.provider || 'reddit'));
  const queued=[...new Map([...kept,...results.flatMap(r=>r.reviewCandidates||[])].map((c,i)=>[c.id ?? `#${i}`,c])).values()];
  const review=pendingCandidates(queued,decisions);
  await fs.writeFile(QUEUE_PATH,JSON.stringify(review,null,2)+'\n');
  const reviewCount=review.length;
  return {published:out.length,review:reviewCount,dropped};
}
