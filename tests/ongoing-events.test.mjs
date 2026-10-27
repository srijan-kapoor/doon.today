import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { eventDayRange, eventDisplayDay } from '../src/lib/dates.mjs';

const longCourse={startAt:'2026-10-31',endAt:'2026-12-20'};
const weekendCourse={startAt:'2026-11-20',endAt:'2026-11-22'};
const timedEvent={startAt:'2026-11-19T22:00:00+05:30',endAt:'2026-11-21T10:00:00+05:30'};

test('ongoing events move to today across months without losing their original date range',()=>{
  assert.deepEqual(eventDayRange(longCourse),{start:'2026-10-31',end:'2026-12-20'});
  assert.equal(eventDisplayDay(longCourse,'2026-11-20'),'2026-11-20');
  assert.equal(eventDisplayDay(longCourse,'2026-12-20'),'2026-12-20','the last date is inclusive');
  assert.equal(eventDisplayDay(longCourse,'2026-12-21'),null,'finished events have no heading');
  assert.equal(eventDisplayDay(longCourse,'2026-10-30'),'2026-10-31','future events keep their start heading');
  assert.equal(eventDisplayDay(weekendCourse,'2026-11-21'),'2026-11-21');
  assert.equal(eventDisplayDay(timedEvent,'2026-11-20'),'2026-11-20');
});

test('timed ranges use IST and exclude a midnight end, while date-only ends are inclusive',()=>{
  assert.deepEqual(eventDayRange(timedEvent),{start:'2026-11-19',end:'2026-11-21'});
  assert.deepEqual(eventDayRange({startAt:'2026-11-19T20:00:00Z',endAt:'2026-11-21T00:00:00+05:30'}),{start:'2026-11-20',end:'2026-11-20'});
  assert.deepEqual(eventDayRange({startAt:'2026-11-20T16:00:00',endAt:'2026-11-22'}),{start:'2026-11-20',end:'2026-11-22'});
  for(const endAt of [undefined,'invalid','2026-11-01']) {
    assert.deepEqual(eventDayRange({startAt:'2026-11-20',endAt}),{start:'2026-11-20',end:'2026-11-20'});
  }
  assert.equal(eventDisplayDay({startAt:'invalid'},'2026-11-20'),null);
});

test('timed ends before 6am IST belong to the previous night',()=>{
  const startAt='2026-10-30T20:00:00+05:30';
  for(const endAt of [
    '2026-10-31T00:00:00+05:30',
    '2026-10-31T01:00:00+05:30',
    '2026-10-31T05:59:59.999+05:30',
    '2026-10-30T19:30:00Z',
    '2026-10-30T15:30:00-04:00',
    '2026-10-31T01:00:00'
  ]) {
    const event={startAt,endAt};
    assert.deepEqual(eventDayRange(event),{start:'2026-10-30',end:'2026-10-30'},endAt);
    assert.equal(eventDisplayDay(event,'2026-10-31'),null,`${endAt}: no ongoing listing the next day`);
    assert.equal(eventDisplayDay(event,'2026-10-30'),'2026-10-30',`${endAt}: keep the original night`);
  }
  for(const endAt of ['2026-10-31T06:00:00+05:30','2026-10-31T00:30:00Z','2026-10-31T10:00:00+05:30','2026-10-31']) {
    assert.deepEqual(eventDayRange({startAt,endAt}),{start:'2026-10-30',end:'2026-10-31'},`${endAt}: keep the next day`);
  }
  assert.deepEqual(eventDayRange({startAt:'2026-10-31T02:00:00+05:30',endAt:'2026-10-31T03:00:00+05:30'}),
    {start:'2026-10-31',end:'2026-10-31'},'the final listing day never precedes the start day');
});

test('production Today, Tomorrow and Weekend filters match the whole date range in every timezone',async t=>{
  const page=await readFile(new URL('../src/pages/index.astro',import.meta.url),'utf8');
  const script=[...page.matchAll(/<script is:inline>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const previous=process.env.TZ;
  t.after(()=>{if(previous===undefined) delete process.env.TZ; else process.env.TZ=previous;});
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-20T13:00:00+05:30')});
  for(const timezone of ['Asia/Kolkata','America/Los_Angeles','Pacific/Kiritimati']) {
    process.env.TZ=timezone;
    const context=vm.createContext({Date,Intl,URLSearchParams,location:{search:'',pathname:'/',hash:''},history:{replaceState(){}},
      document:{documentElement:{classList:{contains:()=>false}},querySelectorAll:()=>[],querySelector:(selector)=>selector==='#area-filter'?null:{}}});
    vm.runInContext(script,context);
    for(const event of [longCourse,weekendCourse,timedEvent]) {
      const {start,end}=eventDayRange(event);
      context.row={dataset:{startDate:start,endDate:end}};
      for(const when of ['all','today','tomorrow','weekend']) {
        assert.equal(vm.runInContext(`state.when='${when}';dayOk(row)`,context),true,`${timezone}, ${event.startAt}, ${when}`);
      }
    }
    for(const event of [
      {startAt:'2026-10-31',endAt:'2026-11-19'},
      {startAt:'2026-11-23',endAt:'2026-11-25'},
      {startAt:'2026-11-19T20:00:00+05:30',endAt:'2026-11-20T01:00:00+05:30'}
    ]) {
      const {start,end}=eventDayRange(event);context.row={dataset:{startDate:start,endDate:end}};
      for(const when of ['today','tomorrow','weekend']) {
        assert.equal(vm.runInContext(`state.when='${when}';dayOk(row)`,context),false,`${timezone}, exclude ${event.startAt} from ${when}`);
      }
    }
    // On Sunday, an event that ended on Saturday must not reappear in Weekend under a past heading.
    t.mock.timers.setTime(new Date('2026-11-22T13:00:00+05:30').getTime());
    const sunday=vm.createContext({Date,Intl,URLSearchParams,location:{search:'?when=weekend',pathname:'/',hash:''},history:{replaceState(){}},
      document:{documentElement:{classList:{contains:()=>false}},querySelectorAll:()=>[],querySelector:(selector)=>selector==='#area-filter'?null:{}}});
    vm.runInContext(script,sunday);sunday.row={dataset:{startDate:'2026-11-20',endDate:'2026-11-21'}};
    assert.equal(vm.runInContext('dayOk(row)',sunday),false);
    t.mock.timers.setTime(new Date('2026-11-20T13:00:00+05:30').getTime());
  }
});

const ghar={startAt:'2026-10-31T10:30:00.000Z',endAt:'2026-12-20T12:30:00.000Z',
  occurrences:['2026-10-31T10:30:00.000Z','2026-11-22T10:30:00.000Z','2026-12-06T10:30:00.000Z','2026-12-20T10:30:00.000Z']};

test('an event on specific dates is listed on those days only, not as ongoing in between',()=>{
  assert.deepEqual(eventDayRange(ghar),{start:'2026-10-31',end:'2026-12-20',days:['2026-10-31','2026-11-22','2026-12-06','2026-12-20']});
  assert.equal(eventDisplayDay(ghar,'2026-10-27'),'2026-10-31');
  assert.equal(eventDisplayDay(ghar,'2026-11-01'),'2026-11-22','between sessions it waits under the next one');
  assert.equal(eventDisplayDay(ghar,'2026-12-20'),'2026-12-20');
  assert.equal(eventDisplayDay(ghar,'2026-12-21'),null);
  assert.deepEqual(eventDayRange({startAt:ghar.startAt,endAt:ghar.endAt}),{start:'2026-10-31',end:'2026-12-20'},'without the list it is still a run');
});

test('production filters match an event on specific dates only on its dates',async t=>{
  const page=await readFile(new URL('../src/pages/index.astro',import.meta.url),'utf8');
  const script=[...page.matchAll(/<script is:inline>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const previous=process.env.TZ;
  t.after(()=>{if(previous===undefined) delete process.env.TZ; else process.env.TZ=previous;});
  const {start,end,days}=eventDayRange(ghar);
  const run=(now,when)=>{
    t.mock.timers.setTime(new Date(now).getTime());
    const context=vm.createContext({Date,Intl,URLSearchParams,location:{search:'',pathname:'/',hash:''},history:{replaceState(){}},
      document:{documentElement:{classList:{contains:()=>false}},querySelectorAll:()=>[],querySelector:(selector)=>selector==='#area-filter'?null:{}}});
    vm.runInContext(script,context);
    context.row={dataset:{startDate:start,endDate:end,days:days.join(' ')}};
    return vm.runInContext(`state.when='${when}';dayOk(row)`,context);
  };
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-20T13:00:00+05:30')});
  for(const timezone of ['Asia/Kolkata','America/Los_Angeles']) {
    process.env.TZ=timezone;
    assert.equal(run('2026-11-20T13:00:00+05:30','today'),false,'between sessions');
    assert.equal(run('2026-11-20T13:00:00+05:30','tomorrow'),false);
    assert.equal(run('2026-11-20T13:00:00+05:30','weekend'),true,'Sun 22 Nov is a session');
    assert.equal(run('2026-11-20T13:00:00+05:30','all'),true);
    assert.equal(run('2026-11-22T13:00:00+05:30','today'),true);
    assert.equal(run('2026-11-21T13:00:00+05:30','tomorrow'),true);
    assert.equal(run('2026-12-21T13:00:00+05:30','all'),false,'over');
  }
});
