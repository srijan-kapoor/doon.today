import test from 'node:test';
import assert from 'node:assert/strict';
import { judgePost, explicitDate } from '../ingest/sources/reddit.mjs';

// The posts that made #21: a trip plan (#11) and a flat hunt (#19) were flagged, the art meet-up (#13) was real.
const POSTED = Date.parse('2026-10-22T10:00:00Z');
const trip = { title: 'Help me plan a family-friendly Mussoorie itinerary for 24 October (own car, travelling from Delhi)',
  content: 'Hi everyone! My family and I are planning a short trip to Mussoorie and Dehradun, and I\'d love some recommendations from locals. Dates: 24–25 October. Starting point: Delhi', postedAt: POSTED };
const flat = { title: 'Moving to Dehradun for a few months. Need flat/room suggestions!',
  content: 'Planning to move to Dehradun from 1st Nov till Holi next year. Got a trekking bucket list to complete so thought why not move there. Looking for a cheap but decent 1BHK.', postedAt: POSTED };
const art = { title: 'Art Meet and Greet by Wildflower Community',
  content: 'Join us on 24th October, 4pm at Akio Coffee Roasters, Race Course, Dehradun. A relaxed meet-up for artists: drawing and crafting over coffee.', postedAt: POSTED };

test('a trip plan and a flat hunt are skipped; an art meet-up is a lead', () => {
  assert.ok(judgePost(trip).skip);
  assert.ok(judgePost(flat).skip, '"trek" no longer matches "trekking"');
  const lead = judgePost(art);
  assert.equal(lead.date.slice(0, 10), '2026-10-24');
  assert.deepEqual(lead.why, ['date 2026-10-24', '"Meet and Greet"', '"4pm"']);
});

test('a request with a time or a sign-up link is still a lead', () => {
  const quiz = { title: 'Looking for teams: pub quiz on 30 October', content: 'Quiz night in Dehradun at 8pm, sign up at forms.gle/abc', postedAt: POSTED };
  assert.ok(judgePost(quiz).date);
  assert.equal(judgePost({ ...quiz, content: 'Quiz night in Dehradun, any suggestions for team names?' }).skip, 'asks for help ("Looking for")');
});

test('word choices: a traffic jam or ticket resale is not an event; a room number or a book launch is fine', () => {
  const post = (title) => judgePost({ title, content: 'In Dehradun.', postedAt: POSTED });
  assert.ok(post('Traffic jam on 5 Nov').skip);
  assert.ok(post('Selling 2 tickets, concert on 5 Nov').skip);
  assert.ok(post('Workshop at Room 101 on 5 Nov').date);
  assert.ok(post('Book launch on 5 Nov').date);
  assert.ok(post('Doon fest on 5 Nov').date);
});

test('a roundup of several events is skipped; one event is not', () => {
  const post = (title) => judgePost({ title, content: 'Live music at 8pm in Dehradun, tickets on insider.in', postedAt: Date.parse('2026-11-05T10:00:00Z') });
  assert.equal(post('Dehradun this weekend (Nov 6-8): 16 things to do, from Music Gigs to Diwali Parties').skip, 'a roundup ("16 things to do")');
  assert.ok(post("What's on in Dehradun this weekend").skip);
  assert.ok(post('Events this weekend in Dehradun, 7 Nov').skip);
  assert.ok(post('Jazz night at Cafe Ivy on 7 Nov').date);
});

test('the date must be within 60 days of the post, and rolls into next year after December', () => {
  assert.equal(judgePost({ ...art, content: art.content.replace('24th October', '24th March') }).skip, 'date not within 60 days of the post');
  assert.equal(explicitDate('see you on 5 Jan', Date.parse('2026-12-20T00:00:00Z')).slice(0, 10), '2027-01-05');
});
