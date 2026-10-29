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
});

test('the organizer and how-to-join line from an approved lead become fields', () => {
  const d = splitDescription('Halloween night of mystery games. #BoardAndBanter\n\nOrganized by @boardandbanter.ddn. How to join: Comment or DM to reserve a table (limited spots)');
  assert.equal(d.text, 'Halloween night of mystery games.');
  assert.equal(d.organizer, '@boardandbanter.ddn');
  assert.equal(d.howToJoin, 'Comment or DM to reserve a table (limited spots)');
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
