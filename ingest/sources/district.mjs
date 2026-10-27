import {fetchText} from '../lib/http.mjs';
import {eventLikeObjects,flattenObjects} from '../lib/jsonld.mjs';
import {istDay,toInstant} from '../../src/lib/dates.mjs';
import {stableId,slugify,parseMoney,categoryFromText,isDehradunText,stripHtml,nowIso,geoFrom} from '../lib/utils.mjs';
const LIST='https://www.district.in/events/upcoming-events-in-dehradun';
// The pages of events listed as a run of days that are read for their own dates; a few at most.
const MAX_SESSION_PAGES=10;
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
// the listing's end falls after the last of them, the last session is the one ending at the listing's end.
export function sessionsFromPage(html,e){
  const url=e.sources[0].url;
  const found=eventLikeObjects(html).filter(o=>sameUrl(o.url||o['@id'],url)&&o.startDate&&Number.isFinite(toInstant(o.startDate).getTime()))
    .map(o=>({start:toInstant(o.startDate).getTime(),end:o.endDate?toInstant(o.endDate).getTime():NaN}))
    .sort((a,b)=>a.start-b.start).filter((s,i,all)=>i===0||s.start!==all[i-1].start);
  if(found.length<2||found[0].start!==toInstant(e.startAt).getTime()) return null;
  const listingEnd=toInstant(e.endAt).getTime();
  if(found.some(s=>s.end>listingEnd)) return null;
  const starts=found.map(s=>s.start);
  const last=found.at(-1);
  const length=last.end-last.start;
  if(length>0&&listingEnd>last.end&&found.every(s=>s.end-s.start===length)) starts.push(listingEnd-length);
  return starts.map(t=>new Date(t).toISOString());
}
// Fills `occurrences` on events that span several days, from their own pages. A page that cannot be read or
// does not show the sessions leaves the event as the listing gave it.
async function addSessions(events,fetchPage){
  let pages=0,failed=0,filled=0;
  for(const e of events){
    if(!e.endAt||istDay(e.endAt)===istDay(e.startAt)||pages>=MAX_SESSION_PAGES) continue;
    pages++;
    try{
      const sessions=sessionsFromPage(await fetchPage(e.sources[0].url),e);
      if(sessions){e.occurrences=sessions;filled++}
    }catch{failed++}
  }
  return {sessionPages:pages,sessionPagesFailed:failed,withOccurrences:filled};
}
export async function fetchDistrict({fetchPage=fetchText}={}){
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
  const sessions=await addSessions(events,fetchPage);
  return {source:'district',events,diagnostics:{listingBytes:Buffer.byteLength(html),candidates:candidates.length,eventsParsed:events.length,...sessions}};
}
