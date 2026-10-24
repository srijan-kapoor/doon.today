import fs from 'node:fs/promises';
import { slugify, eventPassesGeo, areaFromText } from './lib/utils.mjs';
import { readJson, CURATED_PATH, DECISIONS_PATH, QUEUE_PATH, pendingCandidates } from './lib/review.mjs';
import { istDay, compareEventStarts, isUnexpiredEvent } from '../src/lib/dates.mjs';
export { istDay } from '../src/lib/dates.mjs';

const SOURCE_RANK = {
  manual: 100,
  district: 95,
  bookmyshow: 75,
  townscript: 85,
  virasat: 90,
  thrillzone: 90,
  literaturefestival: 90,
  meetup: 85,
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
function verificationStatus(sources=[]) {
  const providers=new Set(sources.map(source => source.provider));
  if (['manual','district','townscript','virasat','thrillzone','literaturefestival','meetup'].some(provider => providers.has(provider))) return 'verified';
  if (providers.size === 1 && providers.has('reddit')) return 'community-reported';
  return 'review';
}
export function sameEvent(a,b) {
  if (!a?.startAt || !b?.startAt) return false;
  if (istDay(a.startAt) !== istDay(b.startAt)) return false;
  const titleScore=similarity(a.title,b.title);
  const venueScore=venueSimilarity(a.venue?.name,b.venue?.name);
  return titleScore >= 0.72 && (venueScore >= 0.5 || /venue tba/i.test(a.venue?.name||'') || /venue tba/i.test(b.venue?.name||''));
}
function sourceKey(s){ return `${s.provider}|${s.url}`; }

// The fields a calendar subscriber would notice changing.
function fingerprint(e) {
  return JSON.stringify([e.title, e.startAt, e.endAt||null, e.venue?.name, e.venue?.address||'']);
}

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
// Misses only count when every source of the event ran successfully and returned events this run;
// otherwise the count is left alone. A source that answered with nothing proves nothing.
function missedRunsAfter(e, returned) {
  const before=e.missedRuns||0;
  const providers=[...new Set((e.sources||[]).map(s=>s.provider))];
  if (providers.length === 0) return before;
  return providers.every(p => (returned.get(p)||0) > 0) ? before+1 : before;
}
function mergePair(a,b) {
  const preferred = sourceRank(b) > sourceRank(a) || (sourceRank(b) === sourceRank(a) && eventTimestamp(b) >= eventTimestamp(a)) ? b : a;
  const secondary = preferred === a ? b : a;
  const sources=[...(a.sources||[]),...(b.sources||[])];
  const unique=[...new Map(sources.map(s=>[sourceKey(s),s])).values()]
    .sort((x,y)=>(SOURCE_RANK[y.provider]||0)-(SOURCE_RANK[x.provider]||0));
  return {
    ...secondary,
    ...preferred,
    id: a.id || b.id,
    slug: a.slug || b.slug || slugify(preferred.title),
    sources: unique,
    verificationStatus: verificationStatus(unique),
    firstSeenAt: [a.firstSeenAt,b.firstSeenAt].filter(Boolean).sort()[0],
    lastSeenAt: [a.lastSeenAt,b.lastSeenAt].filter(Boolean).sort().at(-1),
    lastCheckedAt: [a.lastCheckedAt,b.lastCheckedAt].filter(Boolean).sort().at(-1),
    curation: preferred.curation?.status === 'published' ? preferred.curation : secondary.curation
  };
}

export async function mergeAndWrite(sourceResults) {
  // Events a person checked by hand always take part, like another source that returned them.
  const curated=await readJson(CURATED_PATH,[]);
  const results=curated.length ? [...sourceResults,{source:'manual',events:curated}] : sourceResults;
  let previous=[];
  try { previous=JSON.parse(await fs.readFile('data/events.json','utf8')); } catch {}

  previous = previous.filter(eventPassesGeo);

  const current=[];
  for (const r of results) {
    for (const incoming of r.events || []) {
      if (!eventPassesGeo(incoming)) continue;
      const idx=current.findIndex(existing => sameEvent(existing,incoming));
      if (idx >= 0) current[idx]=mergePair(current[idx],incoming);
      else current.push({...incoming, verificationStatus: verificationStatus(incoming.sources)});
    }
  }

  const ambiguous=new Set([...ambiguousIdentities(current),...ambiguousIdentities(previous)]);
  const same=(a,b)=>sameEvent(a,b) || sharesSource(a,b,ambiguous);
  // Sources that ran successfully this run (failed adapters are not in `results`), and how many events each returned.
  const returned=new Map(results.map(r => [r.source,(r.events||[]).length]));

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
    const missed=missedRunsAfter(e,returned);
    if (missed >= MISSED_RUNS_LIMIT) { dropped++; continue; }
    const kept={...e, verificationStatus: verificationStatus(e.sources)};
    if (missed > 0) kept.missedRuns=missed; else delete kept.missedRuns;
    retained.push(kept);
  }
  merged.push(...retained);

  const out=merged
    .filter(eventPassesGeo)
    .filter(e => e.curation?.status === 'published')
    .filter(e => isUnexpiredEvent(e,now))
    .map(withArea)
    .sort(compareEventStarts);

  await fs.mkdir('data',{recursive:true});
  await fs.writeFile('data/events.json',JSON.stringify(out,null,2)+'\n');

  // A partial run (e.g. a District-only run) must not wipe the Reddit review queue.
  // Leads someone already approved or rejected stay out of the queue.
  const redditRan=results.some(r=>r.source==='reddit');
  const decisions=await readJson(DECISIONS_PATH,{});
  await fs.mkdir('data/review',{recursive:true});
  const review=pendingCandidates(redditRan ? results.flatMap(r=>r.reviewCandidates||[]) : await readJson(QUEUE_PATH,[]),decisions);
  await fs.writeFile(QUEUE_PATH,JSON.stringify(review,null,2)+'\n');
  const reviewCount=review.length;
  return {published:out.length,review:reviewCount,dropped};
}
