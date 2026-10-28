import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sameEvent,istDay,mergeAndWrite} from '../ingest/merge.mjs';

const ev=(over={})=>({
  id:'x',slug:'x',title:'Doon Music Night',description:'',startAt:'2030-01-10T18:00:00+05:30',
  venue:{name:'Rajpur Road Hall',address:'Rajpur Road',city:'Dehradun'},
  categories:['Music'],sources:[{provider:'district',url:'https://example.test/e'}],
  curation:{status:'published',score:8},firstSeenAt:'2030-01-01T00:00:00Z',lastSeenAt:'2030-01-01T00:00:00Z',lastCheckedAt:'2030-01-01T00:00:00Z',
  ...over
});

test('istDay reads the day in IST regardless of how the instant is written',()=>{
  assert.equal(istDay('2026-10-18T09:30:00.000Z'),'2026-10-18');
  assert.equal(istDay('2026-10-18T15:00:00+05:30'),'2026-10-18');
  assert.equal(istDay('2026-10-18T20:00:00.000Z'),'2026-10-19','20:00Z is 01:30 IST the next day');
  assert.equal(istDay('2026-10-18T23:30:00'),'2026-10-18','no offset means IST');
  assert.equal(istDay('2026-10-18'),'2026-10-18');
});

test('the same event with a shorter and a longer venue name is one event',()=>{
  const a=ev({title:'Sanjh-E-Rass',startAt:'2026-10-18T09:30:00.000Z',venue:{name:'J P Plaza & Garden wedding point and party lawn',city:'Dehradun'}});
  const b=ev({title:'Sanjh-E-Rass',startAt:'2026-10-18T15:00:00+05:30',venue:{name:'J P Plaza & Garden',city:'Dehradun'}});
  assert.equal(sameEvent(a,b),true);
});

test('different venues or different days are still different events',()=>{
  const a=ev();
  assert.equal(sameEvent(a,ev({venue:{name:'Parade Ground',city:'Dehradun'}})),false);
  assert.equal(sameEvent(a,ev({startAt:'2030-01-11T18:00:00+05:30'})),false);
  assert.equal(sameEvent(a,ev({title:'Totally Different Show'})),false);
});

async function inTempDir(t){
  const original=process.cwd();
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'doon-merge-'));
  process.chdir(dir);
  t.after(async()=>{process.chdir(original);await fs.rm(dir,{recursive:true,force:true});});
  await fs.mkdir('data/review',{recursive:true});
  return dir;
}

test('previously stored duplicates collapse on the next merge',async t=>{
  await inTempDir(t);
  const a=ev({id:'0f66584b14129c23',title:'Sanjh-E-Rass',startAt:'2030-10-18T09:30:00.000Z',venue:{name:'J P Plaza & Garden wedding point and party lawn',city:'Dehradun'}});
  const b=ev({id:'sanjh-e-rass-2030-10-18',title:'Sanjh-E-Rass',startAt:'2030-10-18T15:00:00+05:30',venue:{name:'J P Plaza & Garden',city:'Dehradun'}});
  await fs.writeFile('data/events.json',JSON.stringify([a,b]));
  const counts=await mergeAndWrite([]);
  const out=JSON.parse(await fs.readFile('data/events.json','utf8'));
  assert.equal(counts.published,1);
  assert.equal(out.length,1);
});

test('a run without Reddit leaves the Reddit review queue alone',async t=>{
  await inTempDir(t);
  await fs.writeFile('data/events.json','[]');
  await fs.writeFile('data/review/reddit.json',JSON.stringify([{title:'candidate'}]));
  const district={source:'district',events:[ev()]};
  const counts=await mergeAndWrite([district]);
  assert.equal(counts.review,1);
  assert.equal(JSON.parse(await fs.readFile('data/review/reddit.json','utf8')).length,1);
  const withReddit=await mergeAndWrite([district,{source:'reddit',events:[],reviewCandidates:[]}]);
  assert.equal(withReddit.review,0);
  assert.equal(JSON.parse(await fs.readFile('data/review/reddit.json','utf8')).length,0);
});

const read=async()=>JSON.parse(await fs.readFile('data/events.json','utf8'));
const src=(provider,url,extra={})=>({provider,url,checkedAt:'2030-01-01T00:00:00Z',confidence:.9,...extra});

test('an event moved to another day by its source is updated in place and keeps its id',async t=>{
  await inTempDir(t);
  const stored=ev({id:'keep-me',slug:'keep-me',startAt:'2030-01-10T18:00:00+05:30',sources:[src('district','https://example.test/events/doon-music-night')]});
  await fs.writeFile('data/events.json',JSON.stringify([stored]));
  const moved=ev({id:'new-hash',slug:'new-hash',startAt:'2030-01-17T18:00:00+05:30',lastCheckedAt:'2030-01-05T00:00:00Z',sources:[src('district','https://example.test/events/doon-music-night/?utm=x')]});
  await mergeAndWrite([{source:'district',events:[moved]}]);
  const out=await read();
  assert.equal(out.length,1,'no ghost copy on the old day');
  assert.equal(out[0].id,'keep-me','the calendar UID does not change');
  assert.equal(out[0].startAt,'2030-01-17T18:00:00+05:30');
});

test('a URL shared by several events does not match them to each other',async t=>{
  await inTempDir(t);
  const listing='https://example.test/events';
  const a=ev({id:'a',title:'Alpha Show',sources:[src('district',listing)]});
  const b=ev({id:'b',title:'Bravo Gig',startAt:'2030-01-11T18:00:00+05:30',sources:[src('district',listing)]});
  await fs.writeFile('data/events.json',JSON.stringify([a,b]));
  const incoming=ev({id:'c',title:'Charlie Night',startAt:'2030-01-12T18:00:00+05:30',sources:[src('district',listing)]});
  await mergeAndWrite([{source:'district',events:[incoming,{...incoming,id:'d',title:'Delta Fest',startAt:'2030-01-13T18:00:00+05:30'}]}]);
  const ids=(await read()).map(e=>e.id).sort();
  assert.deepEqual(ids,['a','b','c','d']);
});

test('an event its source stops listing is dropped after three successful runs',async t=>{
  await inTempDir(t);
  const gone=ev({id:'gone',title:'Cancelled Show',sources:[src('district','https://example.test/events/cancelled')]});
  const other=ev({id:'other',title:'Still On',startAt:'2030-01-12T18:00:00+05:30',sources:[src('district','https://example.test/events/still-on')]});
  await fs.writeFile('data/events.json',JSON.stringify([gone,other]));
  const run=()=>mergeAndWrite([{source:'district',events:[{...other}]}]);

  await run();
  let out=await read();
  assert.equal(out.find(e=>e.id==='gone').missedRuns,1);
  await run();
  assert.equal((await read()).find(e=>e.id==='gone').missedRuns,2);
  const counts=await run();
  out=await read();
  assert.equal(out.some(e=>e.id==='gone'),false,'dropped on the third miss');
  assert.equal(counts.dropped,1);
  assert.equal(out.some(e=>e.id==='other'),true);
  assert.equal(out.find(e=>e.id==='other').missedRuns,undefined);
});

test('misses are not counted when a source did not run, or returned nothing',async t=>{
  await inTempDir(t);
  const stored=ev({id:'dist',sources:[src('district','https://example.test/events/a')]});
  await fs.writeFile('data/events.json',JSON.stringify([stored]));
  for (let i=0;i<5;i++) await mergeAndWrite([{source:'allevents',events:[ev({id:'x',title:'Unrelated Show',startAt:'2030-02-01T18:00:00+05:30',sources:[src('allevents','https://example.test/x')]})]}]);
  assert.equal((await read()).find(e=>e.id==='dist').missedRuns,undefined,'District did not run');
  for (let i=0;i<5;i++) await mergeAndWrite([{source:'district',events:[]}]);
  assert.equal((await read()).find(e=>e.id==='dist').missedRuns,undefined,'an empty answer proves nothing');
});

test('an event seen again resets its miss count, and every source must run before it is counted',async t=>{
  await inTempDir(t);
  const shared=ev({id:'both',missedRuns:2,sources:[src('district','https://example.test/events/b'),src('allevents','https://example.test/b')]});
  const filler=(provider)=>({source:provider,events:[ev({id:`f-${provider}`,title:`Filler ${provider}`,startAt:'2030-03-01T18:00:00+05:30',sources:[src(provider,`https://example.test/${provider}`)]})]});
  await fs.writeFile('data/events.json',JSON.stringify([shared]));
  await mergeAndWrite([filler('allevents')]);
  assert.equal((await read()).find(e=>e.id==='both').missedRuns,2,'District did not run, so the count is unchanged');
  await mergeAndWrite([{source:'district',events:[{...shared,sources:[src('district','https://example.test/events/b')]}]}]);
  assert.equal((await read()).find(e=>e.id==='both').missedRuns,undefined,'listed again, so the count resets');
});

test('SEQUENCE and modifiedAt move only when an event really changes',async t=>{
  await inTempDir(t);
  const stored=ev({id:'seq',sources:[src('district','https://example.test/events/seq')],firstSeenAt:'2030-01-01T00:00:00Z'});
  await fs.writeFile('data/events.json',JSON.stringify([stored]));
  const incoming=(over={})=>({source:'district',events:[ev({id:'seq2',lastCheckedAt:'2030-01-02T00:00:00Z',sources:[src('district','https://example.test/events/seq')],...over})]});
  await mergeAndWrite([incoming()]);
  let e=(await read())[0];
  assert.equal(e.sequence,undefined,'a refresh with no change leaves SEQUENCE alone');
  assert.equal(e.modifiedAt,undefined);
  await mergeAndWrite([incoming({startAt:'2030-01-10T19:00:00+05:30'})]);
  e=(await read())[0];
  assert.equal(e.sequence,1);
  assert.ok(e.modifiedAt);
  await mergeAndWrite([incoming({startAt:'2030-01-10T19:00:00+05:30'})]);
  assert.equal((await read())[0].sequence,1,'unchanged again');
});

test('venue.area is filled from the address when a source gives none',async t=>{
  await inTempDir(t);
  await fs.writeFile('data/events.json','[]');
  const withAddress=ev({id:'a1',title:'Race Course Gig',venue:{name:'Parade Hall',address:'64/2, Race Course Road, Dehradun',city:'Dehradun'},sources:[src('district','https://example.test/a1')]});
  const given=ev({id:'a2',title:'Kept Area Show',startAt:'2030-01-12T18:00:00+05:30',venue:{name:'Hall',address:'Malsi, Dehradun',area:'Custom Area',city:'Dehradun'},sources:[src('district','https://example.test/a2')]});
  await mergeAndWrite([{source:'district',events:[withAddress,given]}]);
  const out=await read();
  assert.equal(out.find(e=>e.id==='a1').venue.area,'Race Course');
  assert.equal(out.find(e=>e.id==='a2').venue.area,'Custom Area');
});

test('date-only events survive afternoon refreshes through their last IST day',async t=>{
  await inTempDir(t);
  t.mock.timers.enable({apis:['Date'],now:new Date('2030-01-10T13:47:00+05:30')});
  const allDay=ev({startAt:'2030-01-10',endAt:'2030-01-10'});
  await mergeAndWrite([{source:'district',events:[allDay]}]);
  assert.equal((await read()).length,1,'a date-only evening listing must survive the afternoon refresh');
  await mergeAndWrite([]);
  assert.equal((await read()).length,1,'a partial or failed fetch must retain it too');
  t.mock.timers.setTime(new Date('2030-01-11T00:00:00+05:30').getTime());
  await mergeAndWrite([{source:'district',events:[allDay]}]);
  assert.equal((await read()).length,0,'it expires at midnight IST');

  const festival=ev({startAt:'2030-01-09',endAt:'2030-01-12'});
  await mergeAndWrite([{source:'district',events:[festival]}]);
  assert.equal((await read()).length,1,'a multi-day event is still running after its first day');
  t.mock.timers.setTime(new Date('2030-01-12T23:59:59+05:30').getTime());
  await mergeAndWrite([]);
  assert.equal((await read()).length,1,'the final date is inclusive');
  t.mock.timers.setTime(new Date('2030-01-13T00:00:00+05:30').getTime());
  await mergeAndWrite([]);
  assert.equal((await read()).length,0);
});

test('started timed events use the same expiry rules on successful and partial refreshes',async t=>{
  await inTempDir(t);
  t.mock.timers.enable({apis:['Date'],now:new Date('2030-01-10T13:00:00+05:30')});
  const running=ev({startAt:'2030-01-10T05:00:00+05:30',endAt:'2030-01-10T18:00:00+05:30'});
  await mergeAndWrite([{source:'district',events:[running]}]);
  assert.equal((await read()).length,1,'an event with a future end is still running');
  await mergeAndWrite([]);
  assert.equal((await read()).length,1,'a partial refresh must not remove a running event');
  t.mock.timers.setTime(new Date('2030-01-10T18:00:00+05:30').getTime());
  await mergeAndWrite([]);
  assert.equal((await read()).length,0);

  const noEnd=ev({startAt:'2030-01-10T15:00:00'});
  await mergeAndWrite([{source:'district',events:[noEnd]}]);
  await mergeAndWrite([]);
  assert.equal((await read()).length,1,'keep the existing six-hour grace for events without an end');
  t.mock.timers.setTime(new Date('2030-01-10T21:00:00+05:30').getTime());
  await mergeAndWrite([]);
  assert.equal((await read()).length,0);
});

test('a run that only knows the date keeps the stored time, and does not bump the calendar sequence',async t=>{
  await inTempDir(t);
  t.mock.timers.enable({apis:['Date'],now:new Date('2030-01-01T12:00:00+05:30')});
  const timed=ev({startAt:'2030-01-10T20:30:00+05:30',endAt:'2030-01-10T22:30:00+05:30',sources:[src('allevents','https://allevents.in/dehradun/x/1')]});
  await mergeAndWrite([{source:'allevents',events:[timed]}]);
  await mergeAndWrite([{source:'allevents',events:[{...timed,startAt:'2030-01-10',endAt:'2030-01-10'}]}]);
  const [e]=await read();
  assert.equal(e.startAt,'2030-01-10T20:30:00+05:30');
  assert.equal(e.endAt,'2030-01-10T22:30:00+05:30');
  assert.equal(e.sequence,undefined);
  await mergeAndWrite([{source:'allevents',events:[{...timed,startAt:'2030-01-10T21:00:00+05:30',endAt:undefined}]}]);
  assert.equal((await read())[0].startAt,'2030-01-10T21:00:00+05:30','a new time still replaces the old one');
});

test('venue coordinates survive a run or a source without them',async t=>{
  await inTempDir(t);
  const geo={lat:30.3431,lng:78.0482};
  const withGeo=ev({venue:{name:'Rajpur Road Hall',address:'Rajpur Road',city:'Dehradun',geo}});
  await mergeAndWrite([{source:'district',events:[withGeo]}]);
  await mergeAndWrite([{source:'district',events:[ev()]}]);
  assert.deepEqual((await read())[0].venue.geo,geo,'a later run without coordinates keeps the stored ones');
  await mergeAndWrite([{source:'district',events:[ev({venue:{...withGeo.venue,geo:{lat:30.3432,lng:78.0483}}})]}]);
  assert.deepEqual((await read())[0].venue.geo,{lat:30.3432,lng:78.0483},'new coordinates replace old ones');

  await fs.rm('data/events.json');
  await mergeAndWrite([
    {source:'district',events:[ev()]},
    {source:'allevents',events:[ev({id:'ae',sources:[src('allevents','https://allevents.in/dehradun/x/1')],venue:{name:'Rajpur Road Hall',city:'Dehradun',geo}})]}
  ]);
  const [e]=await read();
  assert.equal(e.sources[0].provider,'district','District still leads');
  assert.deepEqual(e.venue.geo,geo,'and takes the coordinates AllEvents gave for the same event');
  assert.equal(e.venue.address,'Rajpur Road',"District's own venue details stand");

  await fs.rm('data/events.json');
  await mergeAndWrite([{source:'district',events:[withGeo]}]);
  await mergeAndWrite([{source:'district',events:[ev({venue:{name:'Parade Ground',city:'Dehradun'}})]}]);
  const [moved]=await read();
  assert.equal(moved.venue.name,'Parade Ground','the same District listing moved venue');
  assert.equal(moved.venue.geo,undefined,"and doesn't keep the old venue's pin");
});

test('a community submission shows as community reported, unless a verified source lists it too',async t=>{
  await inTempDir(t);
  const manual=(community)=>({...src('manual','https://example.test/m'),...(community?{community:true}:{})});
  await fs.writeFile('data/curated-events.json',JSON.stringify([ev({id:'m',sources:[manual(true)]})]));
  await mergeAndWrite([]);
  assert.equal((await read())[0].verificationStatus,'community-reported');
  await mergeAndWrite([{source:'district',events:[ev()]}]);
  assert.equal((await read())[0].verificationStatus,'verified','District lists the same event');

  await fs.rm('data/events.json');
  await fs.writeFile('data/curated-events.json',JSON.stringify([ev({id:'m',sources:[manual(false)]})]));
  await mergeAndWrite([]);
  assert.equal((await read())[0].verificationStatus,'verified','an organizer submission, as before');
});

test('mixed UTC and IST timestamps are sorted by actual start time',async t=>{
  await inTempDir(t);
  const times=['2030-01-10T12:30:00.000Z','2030-01-10T14:30:00.000Z','2030-01-10T16:00:00+05:30'];
  await mergeAndWrite([{source:'district',events:times.map((startAt,i)=>ev({
    id:String(i),title:['Jalsa Festival','Live Music Night','Art Meet'][i],startAt,
    sources:[src('district',`https://example.test/${i}`)]
  }))}]);
  assert.deepEqual((await read()).map(e=>e.startAt),[times[2],times[0],times[1]]);
});

test('a placeholder venue or description never replaces a real one from another source',async t=>{
  await inTempDir(t);
  const thrillzone=ev({id:'tz',title:'Dehradun Ultra Run 2027 (4th Edition)',startAt:'2030-03-14T04:00:00+05:30',
    venue:{name:'Venue TBA',city:'Dehradun'},description:'Thrill Zone running event in Dehradun. Check the organizer for route, venue and registration details.',
    sources:[src('thrillzone','https://www.sportifiindia.com/events/ddn-ultra-run')]});
  const allevents=ev({id:'ae',title:'Dehradun Ultra Run 2027 (4th Edition)',startAt:'2030-03-14T05:00:00+05:30',
    venue:{name:'Hotel JSR INN.',address:'Near Bizapur Dam Galjwari, Garhi Cantt, Dehradun',city:'Dehradun'},description:'A 50 km trail ultra through the Doon valley.',
    sources:[src('allevents','https://allevents.in/dehradun/ultra/1')]});
  await mergeAndWrite([{source:'thrillzone',events:[thrillzone]},{source:'allevents',events:[allevents]}]);
  const [e]=await read();
  assert.equal(e.venue.name,'Hotel JSR INN.');
  assert.equal(e.venue.area,'Garhi Cantt');
  assert.equal(e.description,'A 50 km trail ultra through the Doon valley.');
  assert.equal(e.startAt,'2030-03-14T04:00:00+05:30','the higher-ranked source still decides everything else');
  assert.equal(e.sources[0].provider,'thrillzone');
});

test('a real venue from the preferred source is kept, and placeholders are recognised',async t=>{
  const { isPlaceholderVenue, isPlaceholderDescription } = await import('../ingest/lib/utils.mjs');
  for (const name of ['Venue TBA','Venue To Be Announced: Dehradun','TBA','To be decided','See community post','',undefined]) assert.equal(isPlaceholderVenue(name),true,String(name));
  for (const name of ['Hotel JSR INN.','The Tabla House','TBA Cafe','Rajpur Road Hall']) assert.equal(isPlaceholderVenue(name),false,name);
  assert.equal(isPlaceholderDescription('Check the organizer for route, venue and registration details.'),true);
  assert.equal(isPlaceholderDescription('Bring your own sketchbook.'),false);
  await inTempDir(t);
  const district=ev({id:'d',venue:{name:'Rajpur Road Hall',city:'Dehradun'},description:'From District.',sources:[src('district','https://example.test/d')]});
  const other=ev({id:'o',venue:{name:'Rajpur Road Hall annex',city:'Dehradun'},description:'From AllEvents.',sources:[src('allevents','https://example.test/o')]});
  await mergeAndWrite([{source:'district',events:[district]},{source:'allevents',events:[other]}]);
  const [e]=await read();
  assert.equal(e.venue.name,'Rajpur Road Hall');
  assert.equal(e.description,'From District.');
});

const sessions=['2030-01-10T18:00:00+05:30','2030-01-17T18:00:00+05:30','2030-01-24T18:00:00+05:30'];
const onDates=(over={})=>ev({endAt:'2030-01-24T20:00:00+05:30',occurrences:sessions,...over});
const withoutKey=(e,key)=>{const {[key]:_,...rest}=e;return rest};

test('an event on specific dates keeps its dates through a merge, and a source without them does not remove them',async t=>{
  await inTempDir(t);
  await fs.writeFile('data/events.json',JSON.stringify([onDates()]));
  await mergeAndWrite([{source:'district',events:[onDates()]}]);
  assert.deepEqual(JSON.parse(await fs.readFile('data/events.json','utf8'))[0].occurrences,sessions);
  // A run where the event's page could not be read gives the same span without the dates.
  await mergeAndWrite([{source:'district',events:[withoutKey(onDates(),'occurrences')]}]);
  assert.deepEqual(JSON.parse(await fs.readFile('data/events.json','utf8'))[0].occurrences,sessions);
});

test('stored dates are dropped when the source moves the span, and replaced when it sends new ones',async t=>{
  await inTempDir(t);
  await fs.writeFile('data/events.json',JSON.stringify([onDates()]));
  await mergeAndWrite([{source:'district',events:[withoutKey(onDates({endAt:'2030-01-31T20:00:00+05:30'}),'occurrences')]}]);
  const moved=JSON.parse(await fs.readFile('data/events.json','utf8'))[0];
  assert.equal(moved.occurrences,undefined,'stale dates must not outlive their span');
  assert.equal(moved.endAt,'2030-01-31T20:00:00+05:30');
  const next=[sessions[0],'2030-01-31T18:00:00+05:30'];
  await mergeAndWrite([{source:'district',events:[onDates({endAt:'2030-01-31T20:00:00+05:30',occurrences:next})]}]);
  assert.deepEqual(JSON.parse(await fs.readFile('data/events.json','utf8'))[0].occurrences,next);
});

test('a change to the dates bumps the calendar SEQUENCE',async t=>{
  await inTempDir(t);
  await fs.writeFile('data/events.json',JSON.stringify([onDates()]));
  await mergeAndWrite([{source:'district',events:[onDates({occurrences:[sessions[0],sessions[2]]})]}]);
  const e=JSON.parse(await fs.readFile('data/events.json','utf8'))[0];
  assert.equal(e.sequence,1);
  assert.deepEqual(e.occurrences,[sessions[0],sessions[2]]);
});
