import test from 'node:test';
import assert from 'node:assert/strict';
import { cardWhen, eventCard, CARD } from '../src/lib/og.mjs';

const event = (over = {}) => ({
  title: 'Little Chefs Carnival', startAt: '2026-11-14T11:00:00+05:30', venue: { name: 'Retro', area: 'Rajpur' },
  pricing: { type: 'paid', minPrice: 700, maxPrice: 2000, currency: 'INR' }, ...over
});

test('the card says when: day and time, or the day alone', () => {
  assert.equal(cardWhen(event()), 'Sat, 14 Nov · 11:00 am');
  assert.equal(cardWhen(event({ startAt: '2026-12-05' })), 'Sat, 5 Dec');
});

test('the card is a 1200 by 630 PNG, even for a very long title', async () => {
  for (const e of [event(), event({ title: 'A'.repeat(40) + ' ' + 'very long event title '.repeat(8), pricing: { type: 'free' } })]) {
    const png = await eventCard(e);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [CARD.width, CARD.height]);
  }
});
