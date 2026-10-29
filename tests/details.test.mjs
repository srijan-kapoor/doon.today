import test from 'node:test';
import assert from 'node:assert/strict';
import { splitDescription } from '../src/lib/details.mjs';
import { stripHashtags } from '../ingest/lib/utils.mjs';
import { communityHandle } from '../src/lib/community.mjs';

test('hashtags and bracketed keyword lists are removed, the rest is kept', () => {
  assert.equal(stripHashtags('Join us this Saturday! 🎲\n\n#BoardAndBanter #HalloweenNight #boardgamegeek'), 'Join us this Saturday! 🎲');
  assert.equal(stripHashtags('Meet at 7 am.\n\n[ Sunday nature trail, nature trail in Dehradun, guided nature walk ]'), 'Meet at 7 am.');
  assert.equal(stripHashtags('Room #3, then the #1 spot in town'), 'Room #3, then the #1 spot in town', 'numbers are not hashtags');
  assert.equal(stripHashtags('Bring [gloves] and water'), 'Bring [gloves] and water', 'short brackets stay');
  assert.equal(stripHashtags('चलो #देहरादून walk'), 'चलो walk', 'a Hindi hashtag goes whole');
  assert.equal(stripHashtags('Party time 🎉#halloween'), 'Party time 🎉', 'a hashtag right after an emoji');
  assert.equal(stripHashtags('See https://x.com/page#section and C#'), 'See https://x.com/page#section and C#');
});

test('the organizer and how-to-join line from an approved lead become fields', () => {
  const d = splitDescription('Halloween night of mystery games. #BoardAndBanter\n\nOrganized by @boardandbanter.ddn. How to join: Comment or DM to reserve a table (limited spots)');
  assert.equal(d.text, 'Halloween night of mystery games.');
  assert.equal(d.organizer, '@boardandbanter.ddn');
  assert.equal(d.howToJoin, 'Comment or DM to reserve a table (limited spots)');
});

test('an organizer name with a full stop stays whole', () => {
  assert.equal(splitDescription('Talk.\n\nOrganized by Dr. Rao. How to join: DM').organizer, 'Dr. Rao');
  assert.equal(splitDescription('Talk.\n\nOrganized by St. Joseph\'s Academy.').organizer, "St. Joseph's Academy");
});

test('a form entry with only one of the two, or none, is handled', () => {
  assert.deepEqual(splitDescription('One album, front to back.\n\nHow to join: https://chat.whatsapp.com/abc'), { text: 'One album, front to back.', organizer: '', howToJoin: 'https://chat.whatsapp.com/abc' });
  assert.deepEqual(splitDescription('Organized by Melophile.'), { text: '', organizer: 'Melophile', howToJoin: '' });
  assert.deepEqual(splitDescription('A plain description.'), { text: 'A plain description.', organizer: '', howToJoin: '' });
  assert.deepEqual(splitDescription(undefined), { text: '', organizer: '', howToJoin: '' });
});

test('a description that merely mentions joining is left alone', () => {
  const d = splitDescription('Walk with us.\n\nHow to join us next time: follow the page');
  assert.equal(d.howToJoin, '');
  assert.match(d.text, /How to join us next time/);
});

test('the group handle is read from the organizer field too', () => {
  assert.equal(communityHandle({ organizer: '@the5amclub.in', description: 'Run.', sources: [] }), 'the5amclub.in');
});

test('description presentation separates explicit details and itinerary entries without rewriting words', async () => {
  const { descriptionParagraphs } = await import('../src/lib/details.mjs');
  const text = 'Join us. 📏 Distance: 12–14 km 📍 Meetup: Temple ⏰ Meeting time: 5:45 AM 🥾 Trek starting point: Farm THE PLAN 5:45 AM — Meet at Temple. 6:15 AM — Begin. 9:30–9:45 AM — Return.';
  const blocks = descriptionParagraphs(text);
  assert.equal(blocks.length, 9);
  assert.equal(blocks.join(' ').replace(/\s+/g, ' '), text);
  assert.deepEqual(descriptionParagraphs('First paragraph.\n\nSecond paragraph.\nA new line.'), ['First paragraph.', 'Second paragraph.\nA new line.']);
  assert.deepEqual(descriptionParagraphs('<script>alert(1)</script>'), ['<script>alert(1)</script>']);
});

test('flattened festive and games captions split emoji-led items without separating emoji clusters', async () => {
  const { descriptionParagraphs } = await import('../src/lib/details.mjs');
  const captions = [
    '🪔✨ DIWALI IS HERE! 🎇 Celebrate with friends! 🥳 🎉 What’s waiting? 🧨 Patakhe 🌿 Mehndi 🍧 Gol Gappe 📅 Date: Friday ⏰ Time: 7 PM 📍 Venue: Kytes 💸 Entry: DM us',
    'Halloween games. 🔍 Mystery Games – Hosted by Ashish 🩸 Blood on the Clocktower 📅 When: Saturday 📍 Where: Board & Banter',
  ];
  for (const text of captions) {
    const blocks = descriptionParagraphs(text);
    assert.ok(blocks.length >= 5);
    assert.equal(blocks.join(' ').replace(/\s+/g, ' '), text);
    assert.ok(blocks.every((block) => /[\p{L}\p{N}]/u.test(block)), 'no isolated decorative emoji blocks');
  }
  assert.ok(descriptionParagraphs(captions[0]).includes('🥳 🎉 What’s waiting?'));
  assert.deepEqual(descriptionParagraphs('A plain sentence. Another sentence.'), ['A plain sentence. Another sentence.']);
});

test('all saved descriptions preserve their text through presentation formatting', async () => {
  const { readFile } = await import('node:fs/promises');
  const { descriptionParagraphs } = await import('../src/lib/details.mjs');
  const events = JSON.parse(await readFile(new URL('../data/events.json', import.meta.url), 'utf8'));
  const normalize = (text) => text.replace(/\s+/gu, ' ').trim();
  for (const event of events) {
    const text = splitDescription(event.description).text;
    assert.equal(normalize(descriptionParagraphs(text).join(' ')), normalize(text), event.title);
  }
});
