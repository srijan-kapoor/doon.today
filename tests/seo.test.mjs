import test from 'node:test';
import assert from 'node:assert/strict';
import {eventJsonLd,eventPageTitle,eventSummary} from '../src/lib/seo.mjs';
import {sourceLabel} from '../src/lib/sources.mjs';

const ev=(over={})=>({
  title:'Doon Music Night',startAt:'2026-10-18T09:30:00.000Z',venue:{name:'Rajpur Road Hall',address:'12 Rajpur Road',area:'Rajpur',city:'Dehradun'},
  pricing:{type:'paid',minPrice:800,currency:'INR'},sources:[{provider:'district',url:'https://example.test/e'}],...over
});
const opts={pageUrl:'https://doon.today/events/doon-music-night/',imageUrl:'https://doon.today/og-default.png'};

test('Event JSON-LD has what Google needs for a rich result',()=>{
  const ld=eventJsonLd(ev(),opts);
  assert.equal(ld['@type'],'Event');
  assert.equal(ld.name,'Doon Music Night');
  assert.equal(ld.startDate,'2026-10-18T09:30:00.000Z');
  assert.equal(ld.location.name,'Rajpur Road Hall');
  assert.equal(ld.location.address.addressLocality,'Dehradun');
  assert.equal(ld.location.address.addressCountry,'IN');
  assert.deepEqual(ld.image,[opts.imageUrl]);
  assert.deepEqual(ld.offers,{'@type':'Offer',price:800,priceCurrency:'INR',url:'https://example.test/e'});
});

test('dates: offset-less times become IST, date-only stays a date',()=>{
  assert.equal(eventJsonLd(ev({startAt:'2026-10-18T15:00:00'}),opts).startDate,'2026-10-18T15:00:00+05:30');
  assert.equal(eventJsonLd(ev({startAt:'2026-10-21'}),opts).startDate,'2026-10-21');
  assert.equal(eventJsonLd(ev({endAt:'2026-10-18T12:00:00+05:30'}),opts).endDate,'2026-10-18T12:00:00+05:30');
});

test('free and unknown prices',()=>{
  const free=eventJsonLd(ev({pricing:{type:'free',currency:'INR'}}),opts);
  assert.equal(free.isAccessibleForFree,true);
  assert.equal(free.offers.price,0);
  assert.equal(eventJsonLd(ev({pricing:{type:'unknown',currency:'INR'}}),opts).offers,undefined);
});

test('the summary reads as one line with place, price and a trimmed description',()=>{
  assert.equal(eventSummary(ev()),'Sun, 18 Oct, 3:00 pm at Rajpur Road Hall, Rajpur, Dehradun. From ₹800.');
  const long=eventSummary(ev({description:'word '.repeat(100)}));
  assert.ok(long.length<=200);
  assert.ok(long.endsWith('…'),'with no sentence to stop at, it cuts at a word');
  const sentences=eventSummary(ev({description:'First sentence here. '.repeat(3)+'Second part runs on and on '.repeat(10)}));
  assert.ok(sentences.length<=200);
  assert.ok(sentences.endsWith('here.'),'it stops at the end of a whole sentence');
  assert.match(eventSummary(ev({startAt:'2026-10-21'})),/^Wed, 21 Oct at /,'date-only events show no time');
});

test('source names are readable',()=>{
  assert.equal(sourceLabel('district'),'District');
  assert.equal(sourceLabel('literaturefestival'),'Dehradun Literature Festival');
  assert.equal(sourceLabel('unknown-source'),'unknown-source');
});

test('the place carries the venue coordinates when the event has them',()=>{
  const ld=eventJsonLd(ev({venue:{name:'Rajpur Road Hall',city:'Dehradun',geo:{lat:30.3431,lng:78.0482}}}),opts);
  assert.deepEqual(ld.location.geo,{'@type':'GeoCoordinates',latitude:30.3431,longitude:78.0482});
  assert.equal('geo' in eventJsonLd(ev(),opts).location,false,'none without coordinates');
});

test('an address that is only the city is not a street address',()=>{
  assert.equal(eventJsonLd(ev({venue:{name:'Hall',address:'Dehradun',city:'Dehradun'}}),opts).location.address.streetAddress,undefined);
});

test('a price range becomes an AggregateOffer, and the summary shows the range',()=>{
  const e=ev({pricing:{type:'paid',minPrice:1500,maxPrice:4000,currency:'INR'}});
  assert.deepEqual(eventJsonLd(e,opts).offers,{'@type':'AggregateOffer',lowPrice:1500,highPrice:4000,priceCurrency:'INR',url:'https://example.test/e'});
  assert.match(eventSummary(e),/₹1,500–4,000\./);
});

test('an event on specific dates offers its next session, not the span as one run',()=>{
  const gharEv=ev({startAt:'2026-10-31T10:30:00.000Z',endAt:'2026-12-20T12:30:00.000Z',occurrences:['2026-10-31T10:30:00.000Z','2026-11-22T10:30:00.000Z']});
  const ld=eventJsonLd(gharEv,opts);
  assert.equal(ld.endDate,undefined);
  assert.ok(ld.startDate);
  assert.equal(eventJsonLd(ev({endAt:'2026-10-18T12:00:00+05:30'}),opts).endDate,'2026-10-18T12:00:00+05:30');
});

test('the page title keeps the site name and fits in 60 characters',()=>{
  assert.equal(eventPageTitle('Doon Music Night'),'Doon Music Night — doon.today');
  const title=eventPageTitle('Virasat 2026: A very long programme title that goes on and on and on for far too long');
  assert.ok(title.length<=60);
  assert.ok(title.endsWith('… — doon.today'));
});
