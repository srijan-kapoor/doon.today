import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {feedDefinitions,eventsForFeed,feedPath,slug} from '../src/lib/feeds.mjs';
import {SOURCE_LABELS} from '../src/lib/sources.mjs';
import {CATEGORY_NAMES,categoryFromText,areaFromText} from '../ingest/lib/utils.mjs';

const events=JSON.parse(await readFile(new URL('../data/events.json',import.meta.url),'utf8'));
const feeds=feedDefinitions();
const byId=Object.fromEntries(feeds.map(f=>[f.id,f]));

test('feed ids are unique, URL-safe and have a path',()=>{
  const ids=feeds.map(f=>f.id);
  assert.equal(new Set(ids).size,ids.length);
  for(const id of ids){ assert.match(id,/^[a-z0-9-]+$/); assert.equal(feedPath(id),`/calendars/${id}.ics`); }
});

test('every category an event can get has a feed, and so does every source we ingest',()=>{
  for(const name of CATEGORY_NAMES) assert.ok(byId[`category-${slug(name)}`],`no feed for ${name}`);
  assert.ok(CATEGORY_NAMES.includes(categoryFromText('nothing recognisable')[0]));
  for(const provider of Object.keys(SOURCE_LABELS).filter(p=>p!=='manual')) assert.ok(byId[`source-${provider}`],`no feed for ${provider}`);
});

test('feeds select the right events',()=>{
  const e=(over)=>({curation:{status:'published'},categories:['Music'],pricing:{type:'paid'},verificationStatus:'verified',sources:[{provider:'district'}],...over});
  const list=[e({}),e({categories:['Comedy'],pricing:{type:'free'},verificationStatus:'review',sources:[{provider:'allevents'}]}),e({curation:{status:'rejected'}})];
  assert.equal(eventsForFeed(byId['category-music'],list).length,1,'rejected events never appear');
  assert.equal(eventsForFeed(byId['category-comedy'],list).length,1);
  assert.equal(eventsForFeed(byId['free'],list).length,1);
  assert.equal(eventsForFeed(byId['verified'],list).length,1,'source-reported events are left out');
  assert.equal(eventsForFeed(byId['source-allevents'],list).length,1);
});

test('the feeds cover the current events: every event is in a category feed',()=>{
  const covered=new Set(feeds.filter(f=>f.kind==='category').flatMap(f=>eventsForFeed(f,events).map(e=>e.id)));
  assert.equal(covered.size,events.length);
});

test('areas are read from addresses on whole words',()=>{
  assert.equal(areaFromText('Studio XO Rajpur, Dehradun'),'Rajpur');
  assert.equal(areaFromText('64/2, Race Course Road, Guru Nanak Vihar'),'Race Course');
  assert.equal(areaFromText('Forest Edge, Mussoorie Rd, Salan Gaon, Malsi, Dehradun'),'Malsi');
  assert.equal(areaFromText('Maldevta'),'Maldevta','a venue name alone is enough');
  assert.equal(areaFromText('Somewhere in Dehradun'),undefined);
  assert.equal(areaFromText('Malsiwala Farm'),undefined,'"malsi" inside another word does not count');
});
