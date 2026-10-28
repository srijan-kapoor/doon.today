import test from 'node:test';
import assert from 'node:assert/strict';
import { formLead, redditLead, leadIssue, parseLeadIssue, leadMarker, leadKey, leadToEvent } from '../ingest/lib/leads.mjs';
import { dispatchLead } from '../ingest/lib/dispatch-lead.mjs';
import { github } from '../ingest/lib/github.mjs';

const entry = {
  'form-name': 'submit-event',
  title: 'Melophile listening club: Wish You Were Here',
  date: '2026-10-25', time: '16:30', end_time: '18:00',
  venue: 'Maldevta', area: 'rajpur road', category: 'Music',
  price_type: 'paid', price_amount: '₹300',
  listing_url: 'https://example.com/melophile',
  how_to_join: 'DM @melophile.ddn on Instagram',
  organizer: 'Melophile', organizer_link: '@melophile.ddn',
  repeats: 'monthly', description: 'One album, front to back.\r\nThen we talk.',
  contact: 'someone@example.com', submitter: 'organizer', 'bot-field': ''
};
const NOW = '2026-10-23T10:00:00.000Z';

test('formLead keeps the event details and drops contact details', () => {
  const lead = formLead(entry);
  assert.equal(lead.kind, 'form');
  assert.equal(lead.starts, '2026-10-25 16:30');
  assert.equal(lead.ends, '2026-10-25 18:00');
  assert.equal(lead.price, '300');
  assert.equal(lead.description, 'One album, front to back.\nThen we talk.');
  assert.ok(!JSON.stringify(lead).includes('someone@example.com'));
  assert.equal('contact' in lead, false);
});

test('formLead marks an unfixed time as a date, and rejects bots and empty entries', () => {
  assert.equal(formLead({ ...entry, time_tbd: 'yes' }).starts, '2026-10-25');
  assert.equal(formLead({ ...entry, time: '' }).ends, '', 'no end time without a start time');
  assert.equal(formLead({ ...entry, 'bot-field': 'hello' }), null);
  assert.equal(formLead({ ...entry, title: '  ' }), null);
  assert.equal(formLead({ ...entry, date: '25/10/2026' }), null);
  assert.equal(formLead({ ...entry, listing_url: 'javascript:alert(1)' }).listing, '');
});

test('the issue keeps submitted text inside the details block', () => {
  const lead = formLead({ ...entry, title: 'Party @everyone #12 ```break```', venue: 'Cafe\n```\n@owner' });
  const { title, body, labels } = leadIssue(lead);
  assert.deepEqual(labels, ['lead']);
  assert.ok(!/@everyone|#12/.test(title), 'no live mention or issue link in the title');
  const outside = body.replace(/```text\n[\s\S]*?\n```/, '');
  assert.ok(!outside.includes('@'), 'no @ outside the block');
  assert.equal(body.match(/```/g).length, 2, 'submitted backticks cannot close the block');
  assert.ok(!body.includes('someone@example.com'));
});

test('a lead issue reads back after edits on GitHub, including Windows line endings', () => {
  const { body } = leadIssue(formLead(entry));
  const edited = body.replace('venue: Maldevta', 'venue: Maldevta Riverside Cafe').replace(/\n/g, '\r\n') + '\r\n\r\nThanks!';
  const parsed = parseLeadIssue(edited);
  assert.equal(parsed.kind, 'form');
  assert.equal(parsed.fields.venue, 'Maldevta Riverside Cafe');
  assert.equal(parsed.fields.description, 'One album, front to back.\nThen we talk.');
  assert.equal(parseLeadIssue('no marker here'), null);
  assert.deepEqual(leadMarker(body), { kind: 'form', id: '' });
});

test('an approved form lead becomes a published event', () => {
  const parsed = parseLeadIssue(leadIssue(formLead(entry)).body);
  const e = leadToEvent(parsed, { issueUrl: 'https://github.com/o/r/issues/40', now: NOW });
  assert.equal(e.startAt, '2026-10-25T16:30:00+05:30');
  assert.equal(e.endAt, '2026-10-25T18:00:00+05:30');
  assert.equal(e.venue.area, 'Rajpur', 'a typed area is matched to the area list');
  const loose = leadToEvent({ ...parsed, fields: { ...parsed.fields, area: 'near ISBT' } }, { issueUrl: 'https://github.com/o/r/issues/40', now: NOW });
  assert.equal(loose.venue.area, undefined, 'an area not on the list is left for the merge to work out');
  assert.deepEqual(e.categories, ['Music']);
  assert.deepEqual(e.pricing, { type: 'paid', minPrice: 300, currency: 'INR' });
  assert.equal(e.sources[0].url, 'https://example.com/melophile');
  assert.match(e.description, /Organized by Melophile\. How to join: DM @melophile\.ddn/);
  assert.equal(e.curation.status, 'published');
  assert.equal(leadKey(parsed, 40), 'form-40');
});

test("who sent a form entry decides whether it publishes as verified or community reported", () => {
  assert.equal(formLead(entry).submittedBy, 'organizer');
  assert.equal(formLead({ ...entry, submitter: 'community' }).submittedBy, 'community');
  assert.equal(formLead({ ...entry, submitter: undefined }).submittedBy, 'community', 'not saying is not being the organizer');
  // open-lead-issue.mjs rebuilds the lead from the dispatched JSON; the choice must survive that.
  assert.equal(formLead({ ...entry, submitter: JSON.parse(JSON.stringify(formLead(entry))).submittedBy }).submittedBy, 'organizer');

  const approve = (lead) => leadToEvent(parseLeadIssue(leadIssue(lead).body), { issueUrl: 'https://github.com/o/r/issues/41', now: NOW });
  assert.match(leadIssue(formLead({ ...entry, submitter: 'community' })).body, /^submitted by: community$/m, 'the reviewer sees it, and can change it');
  const fromOrganizer = approve(formLead(entry));
  assert.equal(fromOrganizer.verificationStatus, 'verified');
  assert.equal(fromOrganizer.sources[0].community, undefined);
  const fromCommunity = approve(formLead({ ...entry, submitter: 'community' }));
  assert.equal(fromCommunity.verificationStatus, 'community-reported');
  assert.equal(fromCommunity.sources[0].provider, 'manual');
  assert.equal(fromCommunity.sources[0].community, true);
  assert.equal(fromCommunity.curation.status, 'published', 'still checked by hand and published');

  const older = leadIssue(formLead(entry)).body.replace(/^submitted by: .*\n/m, '');
  assert.equal(leadToEvent(parseLeadIssue(older), { issueUrl: 'https://github.com/o/r/issues/12', now: NOW }).verificationStatus, 'verified', 'a lead from before this change stays verified');
  const reddit = parseLeadIssue(leadIssue(redditLead({ id: 'r1', title: 'Jam night', startAt: '2030-01-05T19:00:00+05:30', venue: { name: 'Cafe' }, sources: [{ provider: 'reddit', url: 'https://www.reddit.com/r/Dehradun/comments/r1/' }] })).body);
  assert.equal(reddit.fields.submittedBy, '', 'not asked for Reddit leads');
});

test('two form leads at the same time without links get different ids', () => {
  const bare = { ...entry, listing_url: '', organizer_link: '' };
  const parsed = parseLeadIssue(leadIssue(formLead(bare)).body);
  const a = leadToEvent(parsed, { issueUrl: 'https://github.com/o/r/issues/40', now: NOW });
  const b = leadToEvent(parsed, { issueUrl: 'https://github.com/o/r/issues/41', now: NOW });
  assert.equal(a.sources[0].url, 'https://github.com/o/r/issues/40');
  assert.notEqual(a.id, b.id);
});

test('a lead with a missing or unreadable detail is refused with a plain reason', () => {
  const base = parseLeadIssue(leadIssue(formLead(entry)).body);
  const withField = (key, value) => ({ ...base, fields: { ...base.fields, [key]: value } });
  assert.throws(() => leadToEvent(withField('venue', '')), /venue is empty/);
  assert.throws(() => leadToEvent(withField('starts', 'next sunday')), /"starts" must look like/);
  assert.throws(() => leadToEvent(withField('price', 'cheap')), /"price" must be/);
});

test('a Reddit lead keeps the post as provenance and needs a venue', () => {
  const candidate = {
    id: '2c692e44e499b6f5', title: 'Open mic at Cafe Brew', description: 'Come along',
    startAt: '2026-10-24T13:30:00.000Z', venue: { name: 'See community post', city: 'Dehradun' }, categories: ['Music'],
    sources: [{ provider: 'reddit', url: 'https://www.reddit.com/r/Dehradun/comments/abc/', checkedAt: NOW, confidence: 0.5 }]
  };
  const { body } = leadIssue(redditLead(candidate));
  assert.deepEqual(leadMarker(body), { kind: 'reddit', id: '2c692e44e499b6f5' });
  const parsed = parseLeadIssue(body);
  assert.equal(parsed.fields.starts, '2026-10-24 19:00');
  assert.throws(() => leadToEvent(parsed, { candidate }), /venue is empty/);
  const e = leadToEvent({ ...parsed, fields: { ...parsed.fields, venue: 'Cafe Brew Casa' } }, { candidate, now: NOW });
  assert.deepEqual(e.sources.map((s) => s.provider), ['manual', 'reddit']);
  assert.equal(e.sources[0].url, 'https://www.reddit.com/r/Dehradun/comments/abc/');
  assert.equal(leadKey(parsed, 7), '2c692e44e499b6f5');
});

test('dispatchLead starts the intake workflow without contact details', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 204, text: async () => '' }; };
  assert.equal(await dispatchLead(entry, { fetchImpl, token: 't', repo: 'o/r' }), 'dispatched');
  assert.equal(calls[0].url, 'https://api.github.com/repos/o/r/actions/workflows/lead-intake.yml/dispatches');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.ref, 'main');
  assert.equal(JSON.parse(body.inputs.lead).title, entry.title);
  assert.ok(!calls[0].init.body.includes('someone@example.com'));
  assert.equal(await dispatchLead({ ...entry, 'form-name': 'other' }, { fetchImpl, token: 't' }), 'other form');
  assert.equal(await dispatchLead({ ...entry, 'bot-field': 'x' }, { fetchImpl, token: 't' }), 'not a usable entry');
  assert.equal(await dispatchLead(entry, { fetchImpl, token: '' }), 'no token');
  assert.equal(calls.length, 1);
});

test('issuesWithLabel pages through issues and skips pull requests', async () => {
  const pages = [Array.from({ length: 100 }, (_, i) => ({ number: i + 1 })), [{ number: 101 }, { number: 102, pull_request: {} }]];
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => pages[Number(new URL(url).searchParams.get('page')) - 1] });
  const issues = await github({ token: 't', repo: 'o/r', fetchImpl }).issuesWithLabel('lead');
  assert.equal(issues.length, 101);
});

test('Reddit text arrives as plain words, not escaped HTML', async () => {
  const { decodeEntities, stripHtml } = await import('../ingest/lib/utils.mjs');
  const escaped = '&lt;!-- SC_OFF --&gt;&lt;div class="md"&gt;&lt;p&gt;&amp;#x200B;&lt;/p&gt; &lt;p&gt;Hi everyone!&lt;/p&gt; &lt;p&gt;&lt;strong&gt;Dates:&lt;/strong&gt; 24&#x2013;25 October&lt;/p&gt;&lt;/div&gt;';
  assert.equal(stripHtml(decodeEntities(escaped)), 'Hi everyone! Dates: 24–25 October');
  assert.equal(decodeEntities('Tom &amp;amp; Jerry'), 'Tom &amp; Jerry', 'one layer at a time');
  assert.equal(stripHtml(decodeEntities('&lt;p&gt;Starting point: Delhi&lt;/p&gt; &lt;p&gt;&lt;stro')), 'Starting point: Delhi', 'a tag cut off at the end is dropped');
  const lead = redditLead({ id: 'abc123', title: 'Trip', startAt: '2026-10-24', description: escaped, sources: [] });
  assert.equal(lead.description, 'Hi everyone! Dates: 24–25 October', 'old queued leads are cleaned too');
});

test('the Reddit adapter decodes post HTML before it cuts the description', async () => {
  const { fetchReddit } = await import('../ingest/sources/reddit.mjs');
  const body = '&lt;p&gt;' + 'Open mic night in Dehradun at the club. '.repeat(20) + '&lt;/p&gt;';
  const xml = `<feed><entry><title>Open mic on 2 November</title><link href="https://www.reddit.com/r/Dehradun/comments/x1/"/><content type="html">${body}</content></entry></feed>`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => xml, headers: new Map() });
  try {
    const { reviewCandidates } = await fetchReddit();
    assert.equal(reviewCandidates.length, 1);
    assert.ok(!/&lt;|<p>/.test(reviewCandidates[0].description));
    assert.ok(reviewCandidates[0].description.startsWith('Open mic night in Dehradun'));
  } finally {
    globalThis.fetch = realFetch;
  }
});
