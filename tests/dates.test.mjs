import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesDate } from '../src/lib/filters.mjs';
import { toInstant, istDay, compareEventStarts, isUnexpiredEvent, occurrencesOf, occurrenceDays, nextOccurrence } from '../src/lib/dates.mjs';

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

test('the home page selects the IST weekend independently of the visitor timezone', t => {
  const previous = process.env.TZ;
  t.after(() => { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; });
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-24T12:00:00+05:30') });
  for (const timezone of ['Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Honolulu', 'Pacific/Kiritimati']) {
    process.env.TZ = timezone;
    for (const today of ['2026-10-24', '2026-10-25']) {
      t.mock.timers.setTime(new Date(`${today}T12:00:00+05:30`).getTime());
      const readerDay = istDay(new Date().toISOString());
      assert.equal(readerDay, today);
      assert.equal(matchesDate({ start: '2026-10-24', end: '2026-10-25' }, 'weekend', { today: readerDay }), true, `${timezone}, ${today}`);
      assert.equal(matchesDate({ start: '2026-10-25', end: '2026-10-25' }, 'weekend', { today: readerDay }), true);
      assert.equal(matchesDate({ start: '2026-10-26', end: '2026-10-26' }, 'weekend', { today: readerDay }), false);
      assert.equal(matchesDate({ start: '2026-10-23', end: '2026-10-23' }, 'weekend', { today: readerDay }), false);
    }
  }
});

const ghar={startAt:'2026-10-31T10:30:00.000Z',endAt:'2026-12-20T12:30:00.000Z',
  occurrences:['2026-10-31T10:30:00.000Z','2026-11-22T10:30:00.000Z','2026-12-06T10:30:00.000Z','2026-12-20T10:30:00.000Z']};

test('occurrencesOf only trusts a list that fits startAt',()=>{
  assert.deepEqual(occurrencesOf(ghar),ghar.occurrences);
  assert.equal(occurrencesOf({startAt:ghar.startAt}),null,'an ordinary event has none');
  assert.equal(occurrencesOf({...ghar,occurrences:[ghar.startAt]}),null,'one date is just startAt');
  assert.equal(occurrencesOf({...ghar,occurrences:['2026-11-22T10:30:00.000Z','2026-12-06T10:30:00.000Z']}),null,'it must begin at startAt');
  assert.equal(occurrencesOf({...ghar,occurrences:[ghar.occurrences[0],ghar.occurrences[2],ghar.occurrences[1]]}),null,'it must ascend');
  assert.equal(occurrencesOf({...ghar,occurrences:[ghar.occurrences[0],'not a date']}),null);
  assert.equal(occurrencesOf({...ghar,occurrences:[ghar.occurrences[0],'2026-11-22']}),null,'bare days and times do not mix');
  assert.deepEqual(occurrencesOf({startAt:'2026-11-01',occurrences:['2026-11-01','2026-11-08']}),['2026-11-01','2026-11-08']);
  assert.equal(occurrencesOf({startAt:'2026-10-31T16:00:00+05:30',occurrences:['2026-10-31T10:30:00Z','2026-11-07T10:30:00Z']})?.length,2,'the same instant written differently is the same start');
});

test('occurrenceDays lists the Dehradun days of the sessions, for views that draw a day at a time',()=>{
  assert.deepEqual(occurrenceDays(ghar),['2026-10-31','2026-11-22','2026-12-06','2026-12-20']);
  assert.deepEqual(occurrenceDays({startAt:'2026-10-31T20:00:00Z',occurrences:['2026-10-31T20:00:00Z','2026-11-07T10:00:00Z']}),['2026-11-01','2026-11-07'],'20:00Z is already the next day in IST');
  assert.equal(occurrenceDays({startAt:ghar.startAt,endAt:ghar.endAt}),null);
});

test('nextOccurrence is the next session, the last one when all are past, and startAt for an ordinary event',()=>{
  assert.equal(nextOccurrence(ghar,Date.parse('2026-11-01T00:00:00Z')),'2026-11-22T10:30:00.000Z');
  assert.equal(nextOccurrence(ghar,Date.parse('2027-01-01T00:00:00Z')),'2026-12-20T10:30:00.000Z');
  assert.equal(nextOccurrence({startAt:'2026-11-01'}),'2026-11-01');
});

test('an event on specific dates is unexpired until its last session is over',()=>{
  const at=(date)=>Date.parse(date);
  assert.equal(isUnexpiredEvent(ghar,at('2026-12-20T12:00:00Z')),true);
  assert.equal(isUnexpiredEvent(ghar,at('2026-12-20T12:31:00Z')),true,'endAt is the end of the last session');
  assert.equal(isUnexpiredEvent({...ghar,endAt:undefined},at('2026-12-20T16:00:00Z')),true,'six hours of grace after the last start');
  assert.equal(isUnexpiredEvent({...ghar,endAt:undefined},at('2026-12-20T16:31:00Z')),false);
  const bare={startAt:'2030-01-10',occurrences:['2030-01-10','2030-02-01']};
  assert.equal(isUnexpiredEvent(bare,at('2030-02-01T12:00:00+05:30')),true);
  assert.equal(isUnexpiredEvent(bare,at('2030-02-02T00:00:00+05:30')),false);
});
