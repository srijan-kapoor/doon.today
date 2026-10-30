import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pendingCandidates,parseWhen,parsePrice,buildCuratedEvent,approve,reject} from '../ingest/lib/review.mjs';
import {mergeAndWrite} from '../ingest/merge.mjs';
import { inTempDir } from './helpers.mjs';

const lead=(over={})=>({
  id:'lead1',slug:'doon-book-club',title:'Doon Book Club meetup',description:'Monthly book club, all welcome',startAt:'2030-02-10T06:30:00.000Z',
  venue:{name:'See community post',city:'Dehradun'},categories:['Books'],pricing:{type:'unknown',currency:'INR'},
  sources:[{provider:'reddit',url:'https://www.reddit.com/r/Dehradun/comments/abc/',checkedAt:'2030-01-01T00:00:00Z',confidence:.5}],
  verificationStatus:'community-reported',curation:{status:'review',score:3},...over
});
const details={title:'Doon Book Club',when:'2030-02-10 17:00',venue:'Doon Library',address:'Kanak Chowk',price:'free'};

test('only leads without a decision are pending',()=>{
  const q=[lead(),lead({id:'lead2'}),lead({id:'lead3'})];
  assert.deepEqual(pendingCandidates(q,{lead2:{decision:'rejected'}}).map(c=>c.id),['lead1','lead3']);
});

test('dates are read as IST and must be real dates',()=>{
  assert.equal(parseWhen('2030-02-10 17:00'),'2030-02-10T17:00:00+05:30');
  assert.equal(parseWhen('2030-02-10T9:05'),'2030-02-10T09:05:00+05:30');
  assert.equal(parseWhen('2030-02-10'),'2030-02-10');
  for(const bad of ['','tomorrow','2030-02-30','2030-02-10 25:00','10/02/2030']) assert.equal(parseWhen(bad),null,bad);
});

test('prices: free, unknown or rupees',()=>{
  assert.deepEqual(parsePrice('free'),{type:'free',currency:'INR'});
  assert.deepEqual(parsePrice(''),{type:'unknown',currency:'INR'});
  assert.deepEqual(parsePrice('₹1,500'),{type:'paid',minPrice:1500,currency:'INR'});
  assert.deepEqual(parsePrice('rs 300'),{type:'paid',minPrice:300,currency:'INR'});
  assert.equal(parsePrice('cheap'),null);
});

test('an approved lead becomes a verified, hand-checked event that keeps the post as provenance',()=>{
  const e=buildCuratedEvent(lead(),details,'2030-01-02T00:00:00Z');
  assert.equal(e.verificationStatus,'verified');
  assert.equal(e.curation.status,'published');
  assert.equal(e.startAt,'2030-02-10T17:00:00+05:30');
  assert.equal(e.venue.name,'Doon Library');
  assert.equal(e.venue.city,'Dehradun');
  assert.deepEqual(e.sources.map(s=>s.provider),['manual','reddit']);
  assert.equal(e.sources[0].url,'https://www.reddit.com/r/Dehradun/comments/abc/');
  assert.equal(e.pricing.type,'free');
  assert.equal(buildCuratedEvent(lead(),details).id,e.id,'the id is stable');
});

test('bad input is refused rather than published',()=>{
  assert.throws(()=>buildCuratedEvent(lead(),{...details,when:'soon'}),/Not a date/);
  assert.throws(()=>buildCuratedEvent(lead(),{...details,venue:' '}),/venue/i);
  assert.throws(()=>buildCuratedEvent(lead(),{...details,price:'cheap'}),/price/i);
});

test('approve and reject record the decision; approving twice does not duplicate',()=>{
  const e=buildCuratedEvent(lead(),details);
  let s=approve({decisions:{},curated:[]},lead(),e);
  s=approve(s,lead(),e);
  assert.equal(s.curated.length,1);
  assert.equal(s.decisions.lead1.decision,'approved');
  const r=reject({decisions:{},curated:[]},lead({id:'lead9'}),'spam');
  assert.equal(r.decisions.lead9.decision,'rejected');
  assert.equal(r.decisions.lead9.note,'spam');
});

const read=async(p)=>JSON.parse(await fs.readFile(p,'utf8'));

test('a curated event is published on every run, even when no source lists it, and decided leads leave the queue',async(t)=>{
  await inTempDir(t);
  const e=buildCuratedEvent(lead(),details);
  await fs.writeFile('data/curated-events.json',JSON.stringify([e]));
  await fs.writeFile('data/review/decisions.json',JSON.stringify({lead1:{decision:'approved'},lead2:{decision:'rejected'}}));
  await fs.writeFile('data/review/reddit.json',JSON.stringify([lead(),lead({id:'lead2'}),lead({id:'lead3'})]));
  const sources=[{source:'district',events:[],reviewCandidates:[]}];
  for(let i=0;i<5;i++){
    const counts=await mergeAndWrite(sources);
    assert.equal(counts.published,1,`run ${i+1}`);
  }
  const events=await read('data/events.json');
  assert.equal(events[0].title,'Doon Book Club');
  assert.equal(events[0].verificationStatus,'verified');
  assert.deepEqual((await read('data/review/reddit.json')).map(c=>c.id),['lead3'],'only the undecided lead stays in the queue');
});

test('a run without Reddit still hides decided leads',async(t)=>{
  await inTempDir(t);
  await fs.writeFile('data/review/decisions.json',JSON.stringify({lead2:{decision:'rejected'}}));
  await fs.writeFile('data/review/reddit.json',JSON.stringify([lead({id:'lead2'}),lead({id:'lead3'})]));
  const counts=await mergeAndWrite([{source:'district',events:[],reviewCandidates:[]}]);
  assert.equal(counts.review,1);
});
