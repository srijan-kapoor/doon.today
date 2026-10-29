import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseHandles, accountKey, accountsToStart, isAbandoned, profilePosts, unseenPosts, rememberSeen,
  candidateFromReading, addCandidate, upcomingCandidates, rememberCollected, emptyState, publicError
} from '../ingest/lib/instagram.mjs';
import { sourceLead, leadIssue, leadMarker, parseLeadIssue, leadToEvent } from '../ingest/lib/leads.mjs';
import { fetchInstagram } from '../ingest/sources/instagram.mjs';

const NOW = Date.parse('2026-10-29T06:00:00Z');
const TODAY = '2026-10-29';
const CHECKED = new Date(NOW).toISOString();

// A Profiles record shaped like Bright Data's, for a made-up account.
const record = {
  account: 'example.club',
  input: { url: 'https://www.instagram.com/example.club/' },
  posts: [
    { id: '1', url: 'https://www.instagram.com/p/AAA', datetime: '2026-10-27T00:00:00.000Z', caption: 'Join us this Saturday', image_url: 'https://cdn.example/1.jpg', content_type: 'Image' },
    { id: '2', url: 'https://www.instagram.com/p/BBB', datetime: '2026-10-20T00:00:00.000Z', caption: 'What a morning! Thanks all', image_url: 'https://cdn.example/2.jpg', content_type: 'Carousel' },
    { id: '3', url: 'https://www.instagram.com/p/CCC', datetime: '2026-06-01T00:00:00.000Z', caption: 'Pinned: about us', image_url: '', content_type: 'Image' }
  ]
};

const reading = (over = {}) => ({
  is_announcement: true, title: 'Saturday training', starts: '2026-10-31 06:00', ends: null, venue: 'City Forest Park',
  price: 'free', how_to_join: 'Walk in', categories: ['Fitness'], details_from: 'image', confidence: 'high', ...over
});

test('parseHandles takes commas, spaces and @, without duplicates', () => {
  assert.deepEqual(parseHandles(' @Example.Club, other_club  example.club\n'), ['example.club', 'other_club']);
  assert.deepEqual(parseHandles(undefined), []);
});

test('accounts are started once a day, and never while a job is running', () => {
  const state = emptyState();
  assert.deepEqual(accountsToStart(state, ['a', 'b'], NOW), ['a', 'b']);
  state.accounts[accountKey('a')] = { lastFetchedAt: new Date(NOW - 3 * 3_600_000).toISOString() };
  state.accounts[accountKey('b')] = { snapshot: { id: 's1', startedAt: CHECKED } };
  assert.deepEqual(accountsToStart(state, ['a', 'b'], NOW), []);
  state.accounts[accountKey('a')].lastFetchedAt = new Date(NOW - 21 * 3_600_000).toISOString();
  assert.deepEqual(accountsToStart(state, ['a', 'b'], NOW), ['a']);
});

test('a job running for 12 hours is given up', () => {
  assert.equal(isAbandoned({ startedAt: new Date(NOW - 11 * 3_600_000).toISOString() }, NOW), false);
  assert.equal(isAbandoned({ startedAt: new Date(NOW - 12 * 3_600_000).toISOString() }, NOW), true);
});

test('profilePosts reads posts and errors', () => {
  const { handle, posts } = profilePosts(record);
  assert.equal(handle, 'example.club');
  assert.deepEqual(posts[0], { id: '1', url: 'https://www.instagram.com/p/AAA', postedOn: '2026-10-27', caption: 'Join us this Saturday', imageUrl: 'https://cdn.example/1.jpg' });
  const dead = profilePosts({ input: { url: 'https://www.instagram.com/gone.club/' }, error: "Profile isn't available", error_code: 'dead_page' });
  assert.equal(dead.handle, 'gone.club');
  assert.match(dead.error, /dead_page/);
  assert.deepEqual(dead.posts, []);
});

test('unseenPosts skips posts already read and posts older than 30 days', () => {
  const { posts } = profilePosts(record);
  assert.deepEqual(unseenPosts(posts, [], NOW).map((p) => p.id), ['1', '2']);
  assert.deepEqual(unseenPosts(posts, ['1'], NOW).map((p) => p.id), ['2']);
  assert.deepEqual(rememberSeen(['1'], ['2', '1']), ['2', '1']);
});

test('candidateFromReading keeps upcoming announcements only', () => {
  const post = profilePosts(record).posts[0];
  const opts = { today: TODAY, checkedAt: CHECKED };
  assert.equal(candidateFromReading(reading({ is_announcement: false }), post, 'example.club', opts), null);
  assert.equal(candidateFromReading(reading({ starts: '2026-10-18 07:00' }), post, 'example.club', opts), null, 'past');
  assert.equal(candidateFromReading(reading({ starts: 'Saturday' }), post, 'example.club', opts), null, 'no date');
  const c = candidateFromReading(reading(), post, 'example.club', opts);
  assert.equal(c.startAt, '2026-10-31T06:00:00+05:30');
  assert.equal(c.venue.name, 'City Forest Park');
  assert.deepEqual(c.pricing, { type: 'free', currency: 'INR' });
  assert.equal(c.sources[0].provider, 'instagram');
  assert.equal(c.organizer, 'example.club');
  const later = candidateFromReading(reading({ starts: '2026-10-31 07:00' }), post, 'example.club', opts);
  assert.equal(later.id, c.id, 'same account and day share an id');
});

test('a second post about the same event joins the first, noting a different time', () => {
  const [a, b] = profilePosts(record).posts;
  const opts = { today: TODAY, checkedAt: CHECKED };
  const first = candidateFromReading(reading(), a, 'example.club', opts);
  const second = candidateFromReading(reading({ starts: '2026-10-31 07:00' }), b, 'example.club', opts);
  const list = addCandidate(addCandidate([], first), second);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].posts, [a.url, b.url]);
  assert.match(list[0].description, /gives the time as 07:00/);
  assert.doesNotMatch(list[0].description, /venue/, 'the same venue is not flagged');
  const elsewhere = candidateFromReading(reading({ venue: 'Rajpur Road' }), profilePosts(record).posts[2], 'example.club', opts);
  assert.match(addCandidate(list, elsewhere)[0].description, /gives the venue as Rajpur Road/);
  assert.equal(addCandidate(list, second), list, 'the same post again changes nothing');
});

test('candidates drop out once their day has passed', () => {
  const c = candidateFromReading(reading(), profilePosts(record).posts[0], 'example.club', { today: TODAY, checkedAt: CHECKED });
  assert.equal(upcomingCandidates([c], '2026-10-31').length, 1);
  assert.equal(upcomingCandidates([c], '2026-11-01').length, 0);
});

test('rememberCollected keeps three days of snapshot ids', () => {
  const old = { id: 'old', at: new Date(NOW - 4 * 24 * 3_600_000).toISOString() };
  assert.deepEqual(rememberCollected([old], 'new', NOW).map((c) => c.id), ['new']);
});

test('an Instagram candidate becomes a lead that links the post and round-trips', () => {
  const c = candidateFromReading(reading(), profilePosts(record).posts[0], 'example.club', { today: TODAY, checkedAt: CHECKED });
  const lead = sourceLead(c);
  assert.equal(lead.kind, 'instagram');
  assert.equal(lead.post, 'https://www.instagram.com/p/AAA');
  assert.equal(lead.starts, '2026-10-31 06:00');
  assert.equal(lead.price, 'free');
  assert.equal(lead.organizer, '@example.club');
  assert.equal(lead.howToJoin, 'Walk in');
  const issue = leadIssue(lead);
  assert.ok(issue.body.split('\n').slice(0, 3).join(' ').includes('https://www.instagram.com/p/AAA'), 'post link at the top');
  assert.deepEqual(leadMarker(issue.body), { kind: 'instagram', id: c.id });
  const parsed = parseLeadIssue(issue.body);
  assert.equal(parsed.fields.venue, 'City Forest Park');
  const event = leadToEvent(parsed, { candidate: c, now: CHECKED });
  assert.equal(event.sources[0].url, 'https://www.instagram.com/p/AAA');
  assert.equal(event.verificationStatus, 'verified');
});

test('a placeholder venue is left empty in the lead', () => {
  const c = candidateFromReading(reading({ venue: null }), profilePosts(record).posts[0], 'example.club', { today: TODAY, checkedAt: CHECKED });
  assert.equal(c.venue.name, 'See Instagram post');
  assert.equal(sourceLead(c).venue, '');
});

// The adapter end to end, in a temporary data folder, with a fake Bright Data and model.
async function inTempDir(fn) {
  const cwd = process.cwd();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'doon-ig-'));
  process.chdir(dir);
  try { return await fn(dir); } finally { process.chdir(cwd); await fs.rm(dir, { recursive: true, force: true }); }
}

function fakeClient({ ready = new Set(), records = {}, listed = [] } = {}) {
  const calls = { trigger: [], download: [] };
  return {
    calls,
    async trigger(_dataset, input) { calls.trigger.push(input[0].url); return `sd_${calls.trigger.length}`; },
    async status(id) { return ready.has(id) ? 'ready' : 'running'; },
    async download(id) { calls.download.push(id); return records[id] || []; },
    async snapshots() { return listed; }
  };
}

test('fetchInstagram starts jobs, collects them on a later run, and keeps its leads', async () => {
  const old = process.env.INSTAGRAM_HANDLES;
  process.env.INSTAGRAM_HANDLES = 'example.club';
  try {
    await inTempDir(async () => {
      const reads = [];
      const reader = async (post) => { reads.push(post.caption); return { reading: post.caption.includes('Saturday') ? reading() : reading({ is_announcement: false }), usage: { input_tokens: 10, output_tokens: 5 } }; };
      const getImage = async () => null;

      // Run 1: nothing collected yet, one job started.
      const client1 = fakeClient();
      const r1 = await fetchInstagram({ client: client1, reader, getImage, now: NOW });
      assert.deepEqual(client1.calls.trigger, ['https://www.instagram.com/example.club/']);
      assert.equal(r1.reviewCandidates.length, 0);

      // Run 2: the job is ready; two recent posts are read, one is an announcement.
      const client2 = fakeClient({ ready: new Set(['sd_1']), records: { sd_1: [record] } });
      const r2 = await fetchInstagram({ client: client2, reader, getImage, now: NOW + 8 * 3_600_000 });
      assert.deepEqual(reads, ['Join us this Saturday', 'What a morning! Thanks all']);
      assert.equal(r2.reviewCandidates.length, 1);
      assert.equal(r2.diagnostics.announcements, 1);
      assert.deepEqual(client2.calls.trigger, [], 'fetched under 20 hours ago');

      // Run 3: nothing new, but the lead is sent again so the queue keeps it.
      const client3 = fakeClient({ listed: [{ id: 'sd_1', status: 'ready', created: CHECKED }] });
      const r3 = await fetchInstagram({ client: client3, reader, getImage, now: NOW + 16 * 3_600_000 });
      assert.equal(r3.reviewCandidates.length, 1);
      assert.deepEqual(client3.calls.download, [], 'a snapshot already collected is not read again');
      assert.equal(reads.length, 2);

      const state = JSON.parse(await fs.readFile('data/instagram-state.json', 'utf8'));
      assert.ok(!JSON.stringify(state.accounts).includes('example.club'), 'accounts are keyed by hash');
    });
  } finally {
    if (old === undefined) delete process.env.INSTAGRAM_HANDLES; else process.env.INSTAGRAM_HANDLES = old;
  }
});

test('fetchInstagram picks up a finished job whose id was never saved', async () => {
  const old = process.env.INSTAGRAM_HANDLES;
  process.env.INSTAGRAM_HANDLES = 'example.club';
  try {
    await inTempDir(async () => {
      const client = fakeClient({ records: { sd_lost: [record] }, listed: [{ id: 'sd_lost', status: 'ready', created: new Date(NOW - 3_600_000).toISOString() }] });
      const reader = async () => ({ reading: reading(), usage: { input_tokens: 1, output_tokens: 1 } });
      const r = await fetchInstagram({ client, reader, getImage: async () => null, now: NOW });
      assert.deepEqual(client.calls.download, ['sd_lost']);
      assert.equal(r.reviewCandidates.length, 1);
      assert.deepEqual(client.calls.trigger, [], 'just fetched, so no new job');
    });
  } finally {
    if (old === undefined) delete process.env.INSTAGRAM_HANDLES; else process.env.INSTAGRAM_HANDLES = old;
  }
});

test('without keys, fetchInstagram only sends the leads it already has', async () => {
  await inTempDir(async () => {
    const c = candidateFromReading(reading(), profilePosts(record).posts[0], 'example.club', { today: TODAY, checkedAt: CHECKED });
    await fs.mkdir('data');
    await fs.writeFile('data/instagram-state.json', JSON.stringify({ ...emptyState(), candidates: [c] }));
    const r = await fetchInstagram({ now: NOW });
    assert.equal(r.diagnostics.configured, false);
    assert.equal(r.reviewCandidates.length, 1);
  });
});

test('a day-only reading stays a day in the lead, not 05:30', () => {
  const c = candidateFromReading(reading({ starts: '2026-11-02' }), profilePosts(record).posts[0], 'example.club', { today: TODAY, checkedAt: CHECKED });
  assert.equal(c.startAt, '2026-11-02');
  assert.equal(sourceLead(c).starts, '2026-11-02');
  assert.equal(parseLeadIssue(leadIssue(sourceLead(c)).body).fields.starts, '2026-11-02');
});

test('publicError hides the profile URL', () => {
  assert.equal(publicError('dead_page: https://www.instagram.com/example.club/ not found'), 'dead_page: https://www.instagram.com/…/ not found');
});

test('a failed download keeps the job for the next run, and other jobs still go through', async () => {
  const old = process.env.INSTAGRAM_HANDLES;
  process.env.INSTAGRAM_HANDLES = 'example.club,other.club';
  try {
    await inTempDir(async () => {
      const reader = async () => ({ reading: reading(), usage: { input_tokens: 1, output_tokens: 1 } });
      const getImage = async () => null;
      await fetchInstagram({ client: fakeClient(), reader, getImage, now: NOW });
      const other = { ...record, account: 'other.club', input: { url: 'https://www.instagram.com/other.club/' } };
      const flaky = fakeClient({ ready: new Set(['sd_1', 'sd_2']), records: { sd_2: [other] } });
      flaky.download = async (id) => { flaky.calls.download.push(id); if (id === 'sd_1') throw new Error('Bright Data 502'); return [other]; };
      const r = await fetchInstagram({ client: flaky, reader, getImage, now: NOW + 8 * 3_600_000 });
      assert.deepEqual(flaky.calls.download, ['sd_1', 'sd_2']);
      assert.equal(r.reviewCandidates.length, 1);
      assert.deepEqual(flaky.calls.trigger, [], 'no new job for the account whose download failed');
      const state = JSON.parse(await fs.readFile('data/instagram-state.json', 'utf8'));
      assert.equal(state.accounts[accountKey('example.club')].snapshot.id, 'sd_1');
    });
  } finally {
    if (old === undefined) delete process.env.INSTAGRAM_HANDLES; else process.env.INSTAGRAM_HANDLES = old;
  }
});

test('an Instagram lead takes the categories the model picked, falling back to the keyword rules', () => {
  const post = profilePosts(record).posts[0];
  const opts = { today: TODAY, checkedAt: CHECKED };
  assert.deepEqual(candidateFromReading(reading({ categories: ['Games', 'Meetups', 'Music'] }), post, 'example.club', opts).categories, ['Games', 'Meetups']);
  assert.deepEqual(candidateFromReading(reading({ title: 'Board game night', categories: ['Other'] }), post, 'example.club', opts).categories, ['Games'], 'Other alone falls back to the keyword rules');
  assert.deepEqual(candidateFromReading(reading({ categories: ['Not a category'] }), post, 'example.club', opts).categories, ['Workshop'], 'unknown names are dropped');
});
