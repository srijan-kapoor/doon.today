import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { toInstant, istDay, compareEventStarts, isUnexpiredEvent } from '../src/lib/dates.mjs';

test('date-only and offset-less timestamps mean IST, even on a machine in another timezone',t=>{
  const previous=process.env.TZ;
  t.after(()=>{if(previous===undefined) delete process.env.TZ; else process.env.TZ=previous;});
  process.env.TZ='America/Los_Angeles';
  assert.equal(toInstant('2030-01-10').toISOString(),'2030-01-09T18:30:00.000Z');
  assert.equal(toInstant('2030-01-10T16:00:00').toISOString(),'2030-01-10T10:30:00.000Z');
  assert.equal(istDay('2030-01-09T20:00:00Z'),'2030-01-10');
  assert.equal(istDay('2030-01-10T01:30:00+05:30'),'2030-01-10');
  assert.equal(istDay('2030-01-10'),'2030-01-10');
  const rows=[{startAt:'2030-01-09T20:00:00Z'},{startAt:'2030-01-10'}];
  assert.equal(rows.sort(compareEventStarts)[0].startAt,'2030-01-10','date-only rows sort at the start of their IST day');
});

test('expiry handles missing/invalid ends and preserves the timed grace period',()=>{
  const at=(date)=>Date.parse(date);
  const now=at('2030-01-10T18:00:00+05:30');
  assert.equal(isUnexpiredEvent({startAt:'invalid'},now),false);
  for(const endAt of [undefined,'invalid','2030-01-09']) {
    assert.equal(isUnexpiredEvent({startAt:'2030-01-10',endAt},now),true);
    assert.equal(isUnexpiredEvent({startAt:'2030-01-10',endAt},at('2030-01-11T00:00:00+05:30')),false);
  }
  for(const endAt of [undefined,'invalid','2030-01-10T14:00:00+05:30']) {
    assert.equal(isUnexpiredEvent({startAt:'2030-01-10T15:00:00',endAt},now),true);
    assert.equal(isUnexpiredEvent({startAt:'2030-01-10T15:00:00',endAt},at('2030-01-10T21:00:00+05:30')),false);
  }
});

test('the home page selects the IST weekend independently of the visitor timezone',async t=>{
  const page=await readFile(new URL('../src/pages/index.astro',import.meta.url),'utf8');
  const scripts=[...page.matchAll(/<script is:inline>([\s\S]*?)<\/script>/g)];
  const script=scripts.at(-1)[1];
  const previous=process.env.TZ;
  t.after(()=>{if(previous===undefined) delete process.env.TZ; else process.env.TZ=previous;});
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-24T12:00:00+05:30')});
  for(const timezone of ['Asia/Kolkata','America/Los_Angeles','Pacific/Honolulu','Pacific/Kiritimati']) {
    process.env.TZ=timezone;
    for(const today of ['2026-10-24','2026-10-25']) {
      t.mock.timers.setTime(new Date(`${today}T12:00:00+05:30`).getTime());
      // No rows are needed to exercise the production script's date/filter initialization.
      const context={Date,Intl,URLSearchParams,location:{search:'',pathname:'/',hash:''},history:{replaceState(){}},
        document:{querySelectorAll:()=>[],querySelector:(selector)=>selector==='#area-filter'?null:{}}};
      const range=vm.runInNewContext(`${script}\nJSON.stringify({today,sat,sun})`,context);
      assert.deepEqual(JSON.parse(range),{today,sat:'2026-10-24',sun:'2026-10-25'},`${timezone}, ${today}`);
    }
  }
});
