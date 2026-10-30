import test from 'node:test';
import assert from 'node:assert/strict';
import { festivalGroups, festivalName, sessionLabel } from '../src/lib/festivals.mjs';

test('a festival is named by the title before its colon', () => {
  assert.equal(festivalName('Virasat 2026: Sitar recital by Dhruv Bedi'), 'Virasat 2026');
  assert.equal(festivalName('Virasat 2026 : Osman Mir'), 'Virasat 2026');
  assert.equal(festivalName('Indian Ocean LIVE'), '');
  assert.equal(festivalName('Talk: '), '', 'nothing after the colon');
  assert.equal(festivalName('A: b'), '', 'too short to be a name');
  assert.equal(festivalName('Starts at 7:30 pm'), '', 'a time is not a prefix');
});

test('sessions group when at least two share a festival and a venue, keeping their order', () => {
  const at = (festival, venue = 'Auditorium') => ({ festival, venue });
  const groups = festivalGroups([at('Virasat 2026'), at(''), at('virasat 2026'), at('Virasat 2026', 'Lawn'), at('Comedy Night'), at('Virasat 2026')]);
  assert.deepEqual(groups, [{ name: 'Virasat 2026', members: [0, 2, 5] }]);
  assert.deepEqual(festivalGroups([at('Virasat 2026'), at('Virasat 2026', 'Lawn')]), [], 'one session per venue is no group');
  assert.equal(sessionLabel(1), '1 session');
  assert.equal(sessionLabel(3), '3 sessions');
});
