import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCalendar,buildEventCalendar,escapeText,foldLine,googleDateRange,joinLocation,toInstant} from '../src/lib/ics.mjs';

const ev=(over={})=>({
  id:'abc123',slug:'doon-music-night',title:'Doon Music Night',description:'An evening of music.',
  startAt:'2026-10-18T09:30:00.000Z',venue:{name:'Rajpur Road Hall',address:'12 Rajpur Road, Dehradun',city:'Dehradun'},
  categories:['Music','Culture'],sources:[{provider:'district',url:'https://example.test/e'}],
  firstSeenAt:'2026-10-01T06:00:00.000Z',lastCheckedAt:'2026-10-18T08:00:00.000Z',...over
});
// Undo RFC 5545 folding so tests can read property values.
const unfold=(text)=>text.replace(/\r\n[ \t]/g,'');
const lines=(text)=>unfold(text).split('\r\n').filter(Boolean);
const prop=(text,name)=>lines(text).find(l=>l.startsWith(`${name}:`)||l.startsWith(`${name};`));

test('long lines fold at 75 octets and unfold to the original, even with multi-byte characters',()=>{
  const title='Ministry of Sound presents: Grand Dandiya Celebration — ₹800 onwards, खास आयोजन at the Annfield Lawn in Dehradun';
  const text=buildEventCalendar(ev({title}));
  for(const physical of text.split('\r\n')) assert.ok(new TextEncoder().encode(physical).length<=75,`too long: ${physical}`);
  assert.equal(prop(text,'SUMMARY'),`SUMMARY:${escapeText(title)}`);
  assert.ok(text.includes('\r\n '),'the long line was folded');
});

test('foldLine leaves short lines alone and keeps every character',()=>{
  assert.equal(foldLine('SHORT:line'),'SHORT:line');
  const long='X:'+'é'.repeat(100);
  assert.equal(foldLine(long).replace(/\r\n /g,''),long);
});

test('text values escape backslashes, semicolons, commas and newlines',()=>{
  assert.equal(escapeText('a\\b;c,d\ne\r\nf'),'a\\\\b\\;c\\,d\\ne\\nf');
});

test('every line ends with CRLF and the calendar is properly wrapped',()=>{
  const text=buildCalendar({events:[ev()]});
  assert.ok(text.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(text.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(text),'no bare LF');
});

test('the feed has a name and refresh hints',()=>{
  const text=buildCalendar({name:'doon.today: Music',description:'Music in Dehradun',events:[ev()]});
  assert.equal(prop(text,'X-WR-CALNAME'),'X-WR-CALNAME:doon.today: Music');
  assert.equal(prop(text,'NAME'),'NAME:doon.today: Music');
  assert.equal(prop(text,'X-WR-TIMEZONE'),'X-WR-TIMEZONE:Asia/Kolkata');
  assert.match(prop(text,'REFRESH-INTERVAL'),/PT6H$/);
  assert.equal(prop(text,'X-WR-CALDESC'),'X-WR-CALDESC:Music in Dehradun');
});

test('a timed event without an end gets a two-hour DTEND',()=>{
  const text=buildEventCalendar(ev());
  assert.equal(prop(text,'DTSTART'),'DTSTART:20261018T093000Z');
  assert.equal(prop(text,'DTEND'),'DTEND:20261018T113000Z');
});

test('an explicit end is kept; an end before the start is ignored',()=>{
  assert.equal(prop(buildEventCalendar(ev({endAt:'2026-10-18T12:00:00.000Z'})),'DTEND'),'DTEND:20261018T120000Z');
  assert.equal(prop(buildEventCalendar(ev({endAt:'2026-10-18T08:00:00.000Z'})),'DTEND'),'DTEND:20261018T113000Z');
});

test('date-only events are all-day, and a multi-day range ends the day after its last day',()=>{
  const one=buildEventCalendar(ev({startAt:'2026-10-21'}));
  assert.equal(prop(one,'DTSTART'),'DTSTART;VALUE=DATE:20261021');
  assert.equal(prop(one,'DTEND'),'DTEND;VALUE=DATE:20261022');
  const range=buildEventCalendar(ev({startAt:'2026-10-21',endAt:'2026-10-23'}));
  assert.equal(prop(range,'DTEND'),'DTEND;VALUE=DATE:20261024');
});

test('a timestamp without an offset is IST, not the machine\'s time zone',()=>{
  assert.equal(toInstant('2026-10-18T15:00:00').toISOString(),'2026-10-18T09:30:00.000Z');
  assert.equal(prop(buildEventCalendar(ev({startAt:'2026-10-18T15:00:00'})),'DTSTART'),'DTSTART:20261018T093000Z');
});

test('DTSTAMP and SEQUENCE do not move on a refresh, only when the event changes',()=>{
  const a=buildEventCalendar(ev());
  const refreshed=buildEventCalendar(ev({lastCheckedAt:'2026-10-19T08:00:00.000Z',lastSeenAt:'2026-10-19T08:00:00.000Z'}));
  assert.equal(prop(a,'DTSTAMP'),'DTSTAMP:20261001T060000Z','falls back to when the event was first seen');
  assert.equal(prop(refreshed,'DTSTAMP'),prop(a,'DTSTAMP'));
  assert.equal(prop(a,'SEQUENCE'),'SEQUENCE:0');
  const changed=buildEventCalendar(ev({sequence:2,modifiedAt:'2026-10-10T06:00:00.000Z'}));
  assert.equal(prop(changed,'SEQUENCE'),'SEQUENCE:2');
  assert.equal(prop(changed,'DTSTAMP'),'DTSTAMP:20261010T060000Z');
  assert.equal(prop(changed,'LAST-MODIFIED'),'LAST-MODIFIED:20261010T060000Z');
});

test('the UID is the event id, and details link back to the site',()=>{
  const text=buildEventCalendar(ev());
  assert.equal(prop(text,'UID'),'UID:abc123@doon.today');
  assert.equal(prop(text,'URL'),'URL:https://doon.today/events/doon-music-night/');
  assert.match(prop(text,'DESCRIPTION'),/An evening of music\./);
  assert.match(prop(text,'DESCRIPTION'),/Source: https:\/\/example\.test\/e/);
  assert.equal(prop(text,'CATEGORIES'),'CATEGORIES:Music,Culture');
});

test('the location does not repeat Dehradun',()=>{
  assert.equal(joinLocation(['Rajpur Road Hall','12 Rajpur Road, Dehradun','Dehradun']),'Rajpur Road Hall, 12 Rajpur Road, Dehradun');
  assert.equal(joinLocation(['Studio XO',undefined,'','Dehradun']),'Studio XO, Dehradun');
});

test('the Google Calendar link uses the same times as the download',()=>{
  assert.equal(googleDateRange(ev()),'20261018T093000Z/20261018T113000Z');
  assert.equal(googleDateRange(ev({endAt:'2026-10-18T12:00:00.000Z'})),'20261018T093000Z/20261018T120000Z');
  assert.equal(googleDateRange(ev({startAt:'2026-10-21'})),'20261021/20261022');
  assert.equal(googleDateRange(ev({startAt:'2026-10-21',endAt:'2026-10-23'})),'20261021/20261024');
});

const ghar=()=>ev({startAt:'2026-10-31T10:30:00.000Z',endAt:'2026-12-20T12:30:00.000Z',
  occurrences:['2026-10-31T10:30:00.000Z','2026-11-22T10:30:00.000Z','2026-12-06T10:30:00.000Z','2026-12-20T10:30:00.000Z']});

test('an event on specific dates is one session plus the other dates, not one long block',()=>{
  const text=buildEventCalendar(ghar());
  assert.equal(prop(text,'DTSTART'),'DTSTART:20261031T103000Z');
  assert.equal(prop(text,'DTEND'),'DTEND:20261031T123000Z','a session is the default two hours, not start..endAt');
  assert.equal(prop(text,'RDATE'),'RDATE:20261122T103000Z,20261206T103000Z,20261220T103000Z');
});

test('an event on specific dates without a time lists whole days',()=>{
  const text=buildEventCalendar(ev({startAt:'2026-11-01',endAt:'2026-11-22',occurrences:['2026-11-01','2026-11-08','2026-11-22']}));
  assert.equal(prop(text,'DTSTART;VALUE=DATE'),'DTSTART;VALUE=DATE:20261101');
  assert.equal(prop(text,'DTEND;VALUE=DATE'),'DTEND;VALUE=DATE:20261102');
  assert.equal(prop(text,'RDATE;VALUE=DATE'),'RDATE;VALUE=DATE:20261108,20261122');
});

test('a list that does not fit is ignored, and an ordinary event has no RDATE',()=>{
  assert.equal(prop(buildEventCalendar(ev({occurrences:['2026-11-22T10:30:00.000Z','2026-12-06T10:30:00.000Z']})),'RDATE'),undefined);
  assert.equal(prop(buildEventCalendar(ev()),'RDATE'),undefined);
});

test('the Google Calendar link opens the next session, not the whole span',()=>{
  const now=Date.parse('2026-11-01T00:00:00Z');
  assert.equal(googleDateRange(ghar(),now),'20261122T103000Z/20261122T123000Z');
  assert.equal(googleDateRange(ev({startAt:'2026-11-01',occurrences:['2026-11-01','2026-11-08']}),Date.parse('2026-11-05T00:00:00Z')),'20261108/20261109');
});
