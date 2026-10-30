import {fetchText} from '../lib/http.mjs';
import {eventLikeObjects,flattenObjects} from '../lib/jsonld.mjs';
import {istDay,toInstant} from '../../src/lib/dates.mjs';
import {stableId,slugify,parseMoney,categoryFromText,isDehradunText,stripHtml,nowIso,geoFrom} from '../lib/utils.mjs';
const LIST='https://www.district.in/events/upcoming-events-in-dehradun';
// The pages of events listed as a run of days that are read for their own dates; a few at most.
const MAX_SESSION_PAGES=10;
// The listing gives no description, so each event's own page is read for one: soonest first, a few at most per run.
const MAX_DESCRIPTION_PAGES=15;
const sameUrl=(a,b)=>String(a||'').split('#')[0].replace(/\/+$/,'')===String(b||'').split('#')[0].replace(/\/+$/,'');
function toEvent(o,url=LIST){
  const loc=o.location||o.venue||{}; const addr=typeof loc.address==='string'?loc.address:(loc.address?.streetAddress||'')+' '+(loc.address?.addressLocality||'');
  const title=o.name||o.title; const start=o.startDate||o.start_at||o.startTime||o.start_time;
  const text=[title,o.description,loc.name,addr,o.city,o.locationName].filter(Boolean).join(' ');
  if(!title||!start||!isDehradunText(text)) return null;
  const checkedAt=nowIso(); const offers=Array.isArray(o.offers)?o.offers[0]:o.offers; const geo=geoFrom(loc);
  return {id:stableId('district',o.url||o.slug||title,start),slug:slugify(title),title:stripHtml(title),description:stripHtml(o.description||''),startAt:start,endAt:o.endDate||o.end_at,venue:{name:loc.name||o.locationName||'Venue TBA',address:stripHtml(addr),city:'Dehradun',...(geo&&{geo})},categories:categoryFromText(text),pricing:offers?.price?{type:Number(offers.price)===0?'free':'paid',minPrice:Number(offers.price)||undefined,currency:'INR'}:parseMoney(JSON.stringify(o)),sources:[{provider:'district',url:o.url||url,externalId:String(o.id||o.eventId||'' )||undefined,checkedAt,confidence:.95}],verificationStatus:'verified',curation:{status:'published',score:8},firstSeenAt:checkedAt,lastSeenAt:checkedAt,lastCheckedAt:checkedAt};
}
// The listing gives an event held on specific dates as one entry from the first session to the end of the last
// (31 Oct to 20 Dec), so it reads as a run of days. The event's own page has an Event per session, each with its
// own start and end. Returns the session starts, or null when the page does not show several sessions that agree
// with the listing. The page can leave out the last session; when every session it lists is the same length and
// the listing's end falls on a later day than the last of them, the last session is the one ending at the listing's end
// (a same-day difference is rounding in the listing, not a session).
function sessionsFromPage(html,e){
  const url=e.sources[0].url;
  let found=eventLikeObjects(html).filter(o=>sameUrl(o.url||o['@id'],url)&&o.startDate&&Number.isFinite(toInstant(o.startDate).getTime()))
    .map(o=>({start:toInstant(o.startDate).getTime(),end:o.endDate?toInstant(o.endDate).getTime():NaN}))
    .sort((a,b)=>a.start-b.start||b.end-a.end);
  // A run of days (a festival) is also listed as one Event for the whole run next to its per-day Events: when one
  // Event spans the start of another, the page describes a continuous event, not sessions on set dates.
  if(found.some(a=>found.some(b=>b.start>a.start&&b.start<a.end))) return null;
  found=found.filter((s,i,all)=>i===0||s.start!==all[i-1].start);
  if(found.length<2||found[0].start!==toInstant(e.startAt).getTime()) return null;
  const listingEnd=toInstant(e.endAt).getTime();
  if(found.some(s=>s.end>listingEnd)) return null;
  const starts=found.map(s=>s.start);
  const last=found.at(-1);
  const length=last.end-last.start;
  if(length>0&&istDay(new Date(listingEnd).toISOString())!==istDay(new Date(last.end).toISOString())&&listingEnd>last.end&&found.every(s=>s.end-s.start===length)) starts.push(listingEnd-length);
  return starts.map(t=>new Date(t).toISOString());
}
// Fills `occurrences` on events that span several days, from their own pages. A page that cannot be read or
// does not show the sessions leaves the event as the listing gave it.
async function addSessions(events,fetchPage){
  let pages=0,failed=0,filled=0;
  for(const e of events){
    if(!e.endAt||e.sources[0].url===LIST||pages>=MAX_SESSION_PAGES) continue;
    try{
      if(istDay(e.endAt)===istDay(e.startAt)) continue;
      pages++;
      const sessions=sessionsFromPage(await fetchPage(e.sources[0].url),e);
      if(sessions){e.occurrences=sessions;filled++}
    }catch{failed++}
  }
  return {sessionPages:pages,sessionPagesFailed:failed,withOccurrences:filled};
}
// What an event's own page says about it. The listing gives no description; the page's structured data has all of it,
// with its paragraphs run together ("night out.Featuring"), so a space goes back after a sentence that ends in one.
const spaced=text=>text.replace(/([a-z0-9][.!?])(?=[A-Z])/g,'$1 ');
export function descriptionFromPage(html,url){
  const own=eventLikeObjects(html).filter(o=>sameUrl(o.url||o['@id'],url)&&o.description).map(o=>spaced(stripHtml(o.description)));
  return own.sort((a,b)=>b.length-a.length)[0]||'';
}
// Fills in descriptions the listing left out, from each event's own page: soonest first, capped per run.
// A page that cannot be read leaves the event as the listing gave it.
async function addDescriptions(events,fetchPage){
  let pages=0,failed=0,filled=0;
  const queue=events.filter(e=>!e.description&&e.sources[0].url!==LIST).sort((a,b)=>toInstant(a.startAt)-toInstant(b.startAt)).slice(0,MAX_DESCRIPTION_PAGES);
  for(const e of queue){
    pages++;
    try{
      const description=descriptionFromPage(await fetchPage(e.sources[0].url),e.sources[0].url);
      if(description){e.description=description;filled++}
    }catch{failed++}
  }
  return {descriptionPages:pages,descriptionPagesFailed:failed,withDescriptions:filled};
}
export async function fetchDistrict({fetchPage=fetchText}={}){
  // An event's page is asked for once, even when both the sessions and the description need it.
  const pageCache=new Map();
  const page=url=>{if(!pageCache.has(url)) pageCache.set(url,fetchPage(url)); return pageCache.get(url)};
  const html=await fetchText(LIST); const candidates=[...eventLikeObjects(html)];
  const next=html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if(next){try{candidates.push(...flattenObjects(JSON.parse(next[1])))}catch{}}
  const seen=new Set(); const events=[];
  for(const o of candidates){const e=toEvent(o); if(e&&!seen.has(e.id)){seen.add(e.id);events.push(e)}}
  // A 200 that yields nothing (challenge page, changed markup) must not be recorded as a healthy fetch.
  if(events.length===0){
    const error=new Error('District listing yielded no Dehradun events; feed cannot be verified');
    error.diagnostics={listingUrl:LIST,listingBytes:Buffer.byteLength(html),candidates:candidates.length,eventsParsed:0,hasNextData:Boolean(next)};
    throw error;
  }
  const sessions=await addSessions(events,page);
  const descriptions=await addDescriptions(events,page);
  return {source:'district',events,diagnostics:{listingBytes:Buffer.byteLength(html),candidates:candidates.length,eventsParsed:events.length,...sessions,...descriptions}};
}
