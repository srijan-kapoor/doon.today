import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {categoryFromText,currentCategories,withAddedCategories,hasOutsideGeo,isDehradunText,isLikelyDehradunEvent} from '../ingest/lib/utils.mjs';

const fixture=JSON.parse(await readFile(new URL('./fixtures/event-categories.json',import.meta.url),'utf8'));
const textOf=(e)=>[e.title,e.description,e.venueName,e.address].filter(Boolean).join(' ');

test('categories match whole words, not fragments of other words',()=>{
  assert.deepEqual(categoryFromText('Sanjh-E-Rass at the party lawn'),['Culture'],'"party" must not match "art"');
  assert.ok(!categoryFromText('Pool party night').includes('Art'));
  assert.ok(!categoryFromText('Booking now open').includes('Books'),'"booking" is not "book"');
  assert.ok(categoryFromText('Art and paint workshop').includes('Art'));
  assert.ok(categoryFromText('Weekend arts fair').includes('Art'),'a plural still matches');
});

test('Dehradun-relevant terms are recognised',()=>{
  assert.deepEqual(categoryFromText('Dandiya Night'),['Culture']);
  assert.deepEqual(categoryFromText('Garba and Rass evening'),['Culture']);
  assert.deepEqual(categoryFromText('Kiran Bajwa Live'),['Live shows']);
  assert.deepEqual(categoryFromText('LITCHI India Tour'),['Live shows']);
  assert.deepEqual(categoryFromText('Live music night'),['Music'],'a specific category replaces the live-show fallback');
  assert.deepEqual(categoryFromText('Old city walking tour'),['Outdoors']);
  assert.deepEqual(categoryFromText('Evening city tour'),['Other'],'a sightseeing tour is not a live show');
  assert.deepEqual(categoryFromText('Standup comedy show'),['Comedy']);
  assert.deepEqual(categoryFromText('Zumba Instructor Training'),['Workshop','Wellness']);
  assert.deepEqual(categoryFromText('Trick or Treat Run, 3/5/7 km'),['Fitness'],'runs are Fitness, not Outdoors');
  assert.deepEqual(categoryFromText('Sunrise hike to Bandal Ghati'),['Outdoors']);
  assert.deepEqual(categoryFromText('Saturday functional training'),['Fitness','Workshop']);
  assert.deepEqual(categoryFromText('Halloween night: murder mystery and board games'),['Games']);
  assert.deepEqual(categoryFromText('Quiz night at the cafe'),['Games']);
  assert.deepEqual(categoryFromText('Stargazing at the nature fest'),['Outdoors']);
  assert.deepEqual(categoryFromText('Book club meetup'),['Books','Meetups']);
  assert.deepEqual(categoryFromText('Framed In Crimson: Halloween Rock Night'),['Music']);
  assert.ok(categoryFromText('Classic rock covers all evening').includes('Music'));
  assert.ok(!categoryFromText('Rock climbing at the rock garden').includes('Music'),'a rock is not rock music');
});

test('geo terms match whole words',()=>{
  assert.equal(hasOutsideGeo('Goat yoga and the goal of calm'),false,'"goa" must not match "goat" or "goal"');
  assert.equal(hasOutsideGeo('Holy parish hall concert'),false,'"paris" must not match "parish"');
  assert.equal(hasOutsideGeo('Food festival in Goa'),true);
  assert.equal(hasOutsideGeo('Live in Paris'),true);
});

test('Raipur only counts as Dehradun when it is Raipur Road',()=>{
  assert.equal(isDehradunText('Raipur Road'),true);
  assert.equal(isDehradunText('Rajpur'),true,'Rajpur (with a j) is unaffected');
  assert.equal(isDehradunText('Raipur'),false);
  assert.equal(isLikelyDehradunEvent({title:'Music night',venueName:'Convention Centre',address:'Raipur, Chhattisgarh'}),false);
  assert.equal(isLikelyDehradunEvent({title:'Music night',venueName:'Studio XO',address:'Raipur Road, Dehradun'}),true);
});

test('a structured city that names somewhere else wins over loose text',()=>{
  assert.equal(isLikelyDehradunEvent({title:'Dehradun Run',venueName:'Stadium',city:'Delhi'}),false);
  assert.equal(isLikelyDehradunEvent({title:'Dehradun Run',venueName:'Stadium',city:'Dehradun'}),true);
});

test('current events keep their reviewed categories, and few fall into Other',()=>{
  for(const e of fixture) assert.deepEqual(categoryFromText(textOf(e)),e.expected,e.title);
  const other=fixture.filter(e=>categoryFromText(textOf(e))[0]==='Other').length;
  assert.ok(other/fixture.length<0.25,`${other} of ${fixture.length} events are in Other`);
});

test('a renamed category reads as its new name',()=>{
  assert.deepEqual(currentCategories(['Community','Books']),['Meetups','Books']);
  assert.deepEqual(currentCategories(['Meetups','Community']),['Meetups']);
});

test('a hand-checked event gains a new category the rules find, and keeps the rest',()=>{
  assert.deepEqual(withAddedCategories(['Other'],'Halloween Night: mystery games and Blood on the Clocktower'),['Games']);
  assert.deepEqual(withAddedCategories(['Workshop'],'Saturday functional training'),['Workshop','Fitness']);
  assert.deepEqual(withAddedCategories(['Community'],'Diwali hangout'),['Meetups'],'only Fitness and Games are added');
  assert.deepEqual(withAddedCategories(['Music'],'Album listening session'),['Music']);
  assert.deepEqual(withAddedCategories(['Outdoors','Meetups'],'Temple trek, consider your fitness and the run back'),['Outdoors','Meetups'],'no third category');
  assert.ok(!categoryFromText('Check your fitness before joining the trek').includes('Fitness'),'a passing mention of fitness is not a fitness event');
  assert.deepEqual(categoryFromText('Dehradun Ultra Run 2027'),['Outdoors','Fitness'],'a trail or ultra race is both');
});
