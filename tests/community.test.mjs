import test from 'node:test';
import assert from 'node:assert/strict';
import { isCommunityEvent, communityHandle, communityFirst } from '../src/lib/community.mjs';
import { matchesFilters } from '../src/lib/month.mjs';
import { feedDefinitions, eventsForFeed } from '../src/lib/feeds.mjs';

const src = (provider, url = `https://example.com/${provider}`) => ({ provider, url, checkedAt: '2026-10-29T00:00:00Z', confidence: 1 });
const event = (id, sources, extra = {}) => ({ id, title: id, sources, curation: { status: 'published' }, categories: [], pricing: { type: 'unknown' }, ...extra });

test('community events are hand-checked leads from Instagram or Reddit, or hand-checked events with no other source', () => {
  assert.equal(isCommunityEvent(event('ig', [src('manual'), src('instagram')])), true);
  assert.equal(isCommunityEvent(event('reddit', [src('manual'), src('reddit')])), true);
  assert.equal(isCommunityEvent(event('form', [src('manual')])), true, 'a submitted event');
  assert.equal(isCommunityEvent(event('thin', [src('manual'), src('allevents')])), false, 'an approved aggregator listing');
  assert.equal(isCommunityEvent(event('district', [src('district')])), false);
  assert.equal(isCommunityEvent(event('none', [])), false);
});

test('the group name comes from the approved lead or a profile link, never a post link', () => {
  assert.equal(communityHandle(event('a', [src('manual', 'https://www.instagram.com/p/AAA')], { description: 'Join us.\n\nOrganized by @the5amclub.in. How to join: walk in' })), 'the5amclub.in');
  assert.equal(communityHandle(event('b', [src('manual', 'https://www.instagram.com/melophile.ddn?utm_source=ig')])), 'melophile.ddn');
  assert.equal(communityHandle(event('c', [src('manual', 'https://www.instagram.com/p/DfCWCmFp5uk')])), '');
  assert.equal(communityHandle(event('d', [src('manual', 'https://sortmyscene.com/event/x')])), '');
});

test('community events lead the day, each group keeping its order', () => {
  const list = [event('agg1', [src('district')]), event('c1', [src('manual')]), event('agg2', [src('allevents')]), event('c2', [src('manual'), src('instagram')])];
  assert.deepEqual(communityFirst(list).map((e) => e.id), ['c1', 'c2', 'agg1', 'agg2']);
});

test('the month view filter can keep only community events', () => {
  const item = { categories: ['fitness'], price: 'free', area: '', community: true };
  assert.equal(matchesFilters(item, { community: true }), true);
  assert.equal(matchesFilters({ ...item, community: false }, { community: true }), false);
  assert.equal(matchesFilters({ ...item, community: false }, { community: false }), true);
});

test('the Community picks feed holds community events only', () => {
  const feed = feedDefinitions().find((f) => f.id === 'community');
  assert.equal(feed.kind, 'collection');
  const list = [event('c1', [src('manual')]), event('agg', [src('district')])];
  assert.deepEqual(eventsForFeed(feed, list).map((e) => e.id), ['c1']);
});
