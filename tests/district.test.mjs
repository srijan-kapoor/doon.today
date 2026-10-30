import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchDistrict} from '../ingest/sources/district.mjs';

const listingUrl='https://www.district.in/events/upcoming-events-in-dehradun';
function response(body,status,url,headers={}) {
  const result=new Response(body,{status,headers});
  Object.defineProperty(result,'url',{value:url});
  return result;
}
const withFetch=async (t,handler)=>{
  const original=globalThis.fetch;
  t.after(()=>{globalThis.fetch=original;});
  globalThis.fetch=handler;
};

test('a listing with a Dehradun event produces a district event',async t=>{
  const ld={'@context':'https://schema.org','@type':'Event',name:'Doon Music Night',startDate:'2026-11-01T18:00:00+05:30',
    location:{name:'Rajpur Road Hall',address:{addressLocality:'Dehradun'}},url:'https://www.district.in/events/doon-music-night'};
  const html=`<html><script type="application/ld+json">${JSON.stringify(ld)}</script></html>`;
  await withFetch(t,async url=>response(html,200,url));
  const result=await fetchDistrict();
  assert.equal(result.source,'district');
  assert.equal(result.events.length,1);
  assert.equal(result.events[0].venue.city,'Dehradun');
  assert.equal(result.diagnostics.eventsParsed,1);
});

test('a 200 challenge page with no events is a failure, not a healthy fetch',async t=>{
  await withFetch(t,async url=>response('<html><title>Just a moment...</title><body>Checking your browser</body></html>',200,url));
  await assert.rejects(fetchDistrict(),error=>{
    assert.match(error.message,/yielded no Dehradun events/);
    assert.equal(error.diagnostics.eventsParsed,0);
    assert.equal(error.diagnostics.candidates,0);
    return true;
  });
});

test('a 403 is a failure with safe diagnostics',async t=>{
  await withFetch(t,async url=>response('blocked',403,url,{'content-type':'text/html'}));
  await assert.rejects(fetchDistrict(),error=>{
    assert.equal(error.diagnostics.status,403);
    assert.equal(error.diagnostics.requestedUrl,listingUrl);
    return true;
  });
});

const gharUrl='https://www.district.in/events/ghar-an-open-mic-for-words-by-tape-a-tale-dehradun-apr19-2026-buy-tickets';
const listingWith=(...items)=>`<html><script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@type':'ItemList',itemListElement:items.map((item,i)=>({'@type':'ListItem',position:i+1,item}))})}</script></html>`;
const gharListing={'@type':'Event',name:'Ghar: An Open Mic for Words by Tape A Tale | Dehradun',url:gharUrl,location:{name:'Tapri - The Teafe',address:{addressLocality:'Dehradun'}},
  startDate:'2026-10-31T10:30:00.000Z',endDate:'2026-12-20T12:30:00.000Z'};
const sessionLd=(start,end,url=gharUrl)=>`<script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@type':'Event','@id':`${url}#event`,name:gharListing.name,url,startDate:start,endDate:end})}</script>`;
const gharPage=(...days)=>`<html>${days.map(d=>sessionLd(`${d}T10:30:00.000Z`,`${d}T12:30:00.000Z`)).join('')}</html>`;

test('an event held on specific dates gets them from its own page',async t=>{
  await withFetch(t,async url=>response(url===listingUrl?listingWith(gharListing):gharPage('2026-10-31','2026-11-22','2026-12-06','2026-12-20'),200,url));
  const {events,diagnostics}=await fetchDistrict();
  assert.deepEqual(events[0].occurrences,['2026-10-31T10:30:00.000Z','2026-11-22T10:30:00.000Z','2026-12-06T10:30:00.000Z','2026-12-20T10:30:00.000Z']);
  assert.equal(events[0].endAt,'2026-12-20T12:30:00.000Z');
  assert.equal(diagnostics.withOccurrences,1);
});

test('a last session missing from the page is the one that ends where the listing ends',async t=>{
  // District\'s page lists three of the four sessions in its structured data; the listing\'s end gives the fourth.
  await withFetch(t,async url=>response(url===listingUrl?listingWith(gharListing):gharPage('2026-10-31','2026-11-22','2026-12-06'),200,url));
  const {events}=await fetchDistrict();
  assert.deepEqual(events[0].occurrences.slice(-2),['2026-12-06T10:30:00.000Z','2026-12-20T10:30:00.000Z']);
  assert.equal(events[0].occurrences.length,4);
});

test('a page that cannot be read, or shows one session, leaves the event as the listing gave it',async t=>{
  for(const page of [()=>response('blocked',403,gharUrl),()=>response(gharPage('2026-10-31'),200,gharUrl),()=>response('<html></html>',200,gharUrl)]){
    await withFetch(t,async url=>url===listingUrl?response(listingWith(gharListing),200,url):page());
    const {events,diagnostics}=await fetchDistrict();
    assert.equal(events.length,1);
    assert.equal('occurrences' in events[0],false);
    assert.equal(diagnostics.withOccurrences,0);
  }
});

test('sessions that do not begin where the listing does, or run past its end, are not used',async t=>{
  await withFetch(t,async url=>response(url===listingUrl?listingWith(gharListing):gharPage('2026-11-22','2026-12-06'),200,url));
  assert.equal('occurrences' in (await fetchDistrict()).events[0],false);
  await withFetch(t,async url=>response(url===listingUrl?listingWith(gharListing):gharPage('2026-10-31','2026-12-27'),200,url));
  assert.equal('occurrences' in (await fetchDistrict()).events[0],false);
});

test('single-day events cost no extra page fetch for sessions, and other events\' sessions on the page are ignored',async t=>{
  const calls=[];
  const described={description:'Listed with a description, so its page is only read for sessions.'};
  const single={...gharListing,...described,name:'Doon Music Night',url:'https://www.district.in/events/doon-music-night',startDate:'2026-11-01T12:30:00.000Z',endDate:'2026-11-01T15:30:00.000Z'};
  const page=`${gharPage('2026-10-31','2026-11-22')}${sessionLd('2026-10-31T10:30:00.000Z','2026-10-31T12:30:00.000Z','https://www.district.in/events/other')}`;
  await withFetch(t,async url=>{calls.push(url);return response(url===listingUrl?listingWith(single,{...gharListing,...described}):page,200,url)});
  const {events}=await fetchDistrict();
  assert.deepEqual(calls,[listingUrl,gharUrl]);
  assert.equal(events.find(e=>e.title==='Doon Music Night').occurrences,undefined);
  assert.equal(events.find(e=>e.title!=='Doon Music Night').occurrences.length,3,'the third is the one ending where the listing does');
});

test('a listing end later on the same day as the last session is rounding, not another session',async t=>{
  const padded={...gharListing,endDate:'2026-12-20T12:59:00.000Z'};
  await withFetch(t,async url=>response(url===listingUrl?listingWith(padded):gharPage('2026-10-31','2026-11-22','2026-12-20'),200,url));
  assert.equal((await fetchDistrict()).events[0].occurrences.length,3);
});

test('a festival listed as one Event for the whole run plus one per day is a run, not sessions on set dates',async t=>{
  const url='https://www.district.in/events/doon-festival';
  const listing={...gharListing,name:'Doon Festival',url,startDate:'2026-11-27T04:30:00.000Z',endDate:'2026-11-29T15:30:00.000Z'};
  const page=`<html>${[['2026-11-27T04:30:00.000Z','2026-11-29T15:30:00.000Z'],['2026-11-27T04:30:00.000Z','2026-11-27T15:30:00.000Z'],['2026-11-28T04:30:00.000Z','2026-11-28T15:30:00.000Z']].map(([s,e])=>sessionLd(s,e,url)).join('')}</html>`;
  await withFetch(t,async u=>response(u===listingUrl?listingWith(listing):page,200,u));
  assert.equal('occurrences' in (await fetchDistrict()).events[0],false);
});

const ownPage=(url,description,startDate='2026-11-01T12:30:00.000Z')=>`<html><script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@type':'Event',name:'Doon Music Night',url,startDate,description})}</script></html>`;
const musicUrl='https://www.district.in/events/doon-music-night';
const music={...gharListing,name:'Doon Music Night',url:musicUrl,startDate:'2026-11-01T12:30:00.000Z',endDate:'2026-11-01T15:30:00.000Z'};

test('an event the listing gives no description for gets it from its own page',async t=>{
  await withFetch(t,async url=>response(url===listingUrl?listingWith(music):ownPage(musicUrl,'An evening of live music.<br>Doors open at six &amp; food is served.Dress warm!Bring a friend. Visit U.S.A. fans.'),200,url));
  const {events,diagnostics}=await fetchDistrict();
  assert.equal(events[0].description,'An evening of live music. Doors open at six & food is served. Dress warm! Bring a friend. Visit U.S.A. fans.','paragraphs the page ran together get their space back');
  assert.equal(diagnostics.withDescriptions,1);
});

test('a page that cannot be read, or has no description for this event, leaves the listing as it was',async t=>{
  await withFetch(t,async url=>url===listingUrl?response(listingWith(music),200,url):response('blocked',403,url));
  const blocked=await fetchDistrict();
  assert.equal(blocked.events[0].description,'');
  const other=async url=>response(url===listingUrl?listingWith(music):ownPage('https://www.district.in/events/someone-else','Not this event.'),200,url);
  await withFetch(t,other);
  const {events,diagnostics}=await fetchDistrict();
  assert.equal(events[0].description,'');
  assert.equal(diagnostics.withDescriptions,0);
});

test('an event on specific dates has its page fetched once for both its sessions and its description',async t=>{
  const calls=[];
  const page=`${gharPage('2026-10-31','2026-11-22')}${ownPage(gharUrl,'Open mic for words.','2026-10-31T10:30:00.000Z')}`;
  await withFetch(t,async url=>{calls.push(url);return response(url===listingUrl?listingWith(gharListing):page,200,url)});
  const {events}=await fetchDistrict();
  assert.deepEqual(calls,[listingUrl,gharUrl]);
  assert.equal(events[0].description,'Open mic for words.');
  assert.equal(events[0].occurrences.length,3,'the page\'s own Event does not count as another session');
});
