import test from 'node:test';
import assert from 'node:assert/strict';
import {adapterName,selectAdapters,knownSources,recordAttempt,computeHealth,primaryFreshness} from '../ingest/lib/status.mjs';

async function fetchDistrict(){}
async function fetchMeetup(){}
async function fetchAllEvents(){}
async function fetchReddit(){}
const adapters=[fetchDistrict,fetchMeetup,fetchAllEvents,fetchReddit];
const names=(list)=>list.map(adapterName);

test('selectAdapters supports only, skip and unknown names',()=>{
  assert.deepEqual(names(selectAdapters(adapters)),['district','meetup','allevents','reddit']);
  assert.deepEqual(names(selectAdapters(adapters,{only:'district, Meetup'})),['district','meetup']);
  assert.deepEqual(names(selectAdapters(adapters,{skip:'district,meetup'})),['allevents','reddit']);
  assert.deepEqual(names(selectAdapters(adapters,{only:'',skip:''})),['district','meetup','allevents','reddit']);
  assert.throws(()=>selectAdapters(adapters,{only:'distrct'}),/Unknown ingest source "distrct"/);
});

test('knownSources drops the status of a source that no longer has an adapter',()=>{
  const previous={district:{status:'ok'},townscript:{status:'ok'},bookmyshow:{status:'failed'}};
  assert.deepEqual(knownSources(previous,adapters),{district:{status:'ok'}});
  assert.deepEqual(knownSources(undefined,adapters),{});
});

test('recordAttempt tracks last success and consecutive failures',()=>{
  const t1='2026-10-18T00:00:00.000Z', t2='2026-10-18T08:00:00.000Z', t3='2026-10-18T16:00:00.000Z';
  const ok=recordAttempt(undefined,{status:'ok',events:12},t1);
  assert.equal(ok.lastSuccessAt,t1);
  assert.equal(ok.consecutiveFailures,0);
  const failed=recordAttempt(ok,{status:'failed',error:'403'},t2);
  assert.equal(failed.lastSuccessAt,t1,'a failure keeps the previous success time');
  assert.equal(failed.lastAttemptAt,t2);
  assert.equal(failed.consecutiveFailures,1);
  assert.equal(recordAttempt(failed,{status:'failed',error:'403'},t3).consecutiveFailures,2);
  assert.equal(recordAttempt(failed,{status:'ok',events:3},t3).consecutiveFailures,0);
});

const now=Date.parse('2026-10-19T00:00:00.000Z');
const hoursAgo=(h)=>new Date(now-h*3_600_000).toISOString();

test('health is healthy while the primary source has a recent success, whatever other sources do',()=>{
  const sources={
    district:{status:'ok',lastSuccessAt:hoursAgo(2)},
    reddit:{status:'failed',consecutiveFailures:9},
    allevents:{status:'ok'}
  };
  const result=computeHealth(sources,{now,published:30});
  assert.equal(result.health,'healthy');
  assert.deepEqual(result.primarySourcesExpected,['district']);
});

test('a primary source carried forward past the max age makes the site degraded',()=>{
  const sources={
    district:{status:'ok',lastSuccessAt:hoursAgo(40)},
    allevents:{status:'ok'}
  };
  const result=computeHealth(sources,{now,published:30,maxAgeHours:36});
  assert.equal(result.health,'degraded');
  assert.deepEqual(result.primarySourcesAvailable,[]);
  assert.equal(result.primarySources.district.fresh,false);
});

test('one failed attempt does not degrade a source that succeeded recently',()=>{
  const sources={district:{status:'failed',lastSuccessAt:hoursAgo(8),consecutiveFailures:1}};
  assert.equal(computeHealth(sources,{now,published:5}).health,'healthy');
});

test('a primary source that never succeeded is not fresh, and zero published is failed',()=>{
  const sources={district:{status:'failed'},allevents:{status:'ok'}};
  const freshness=primaryFreshness(sources,{now});
  assert.equal(freshness.district.lastSuccessAt,null);
  assert.equal(freshness.district.fresh,false);
  assert.equal(computeHealth(sources,{now,published:4}).health,'degraded');
  assert.equal(computeHealth(sources,{now,published:0}).health,'failed');
  assert.equal(computeHealth({district:{status:'failed'}},{now,published:4}).health,'failed');
});

test('a source listed as primary by the caller is honoured',()=>{
  const sources={district:{status:'ok',lastSuccessAt:hoursAgo(1)},meetup:{status:'ok',lastSuccessAt:hoursAgo(50)}};
  const result=computeHealth(sources,{now,published:5,primary:['district','meetup']});
  assert.equal(result.health,'degraded');
});
