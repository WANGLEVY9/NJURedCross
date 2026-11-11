import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tableTransition } from '../public/app/games/uno/motion.js';

const state = () => ({ phase: 'playing', roomId: 'ABCD', round: 1, turn: 1, drawPileCount: 50, discardCount: 8, top: { id: 'a', image: 'r1.webp' }, seats: [{ handCount: 7 }, { handCount: 5 }] });

test('new rounds show a deal without repeating on unchanged state', () => {
  const first = state();
  assert.deepEqual(tableTransition(null, first), [{ type: 'deal' }]);
  assert.deepEqual(tableTransition(first, structuredClone(first)), []);
  assert.deepEqual(tableTransition(first, { ...first, round: 2 }), [{ type: 'deal' }]);
});

test('play, draw and discard recycling follow visible state changes', () => {
  const prior = state();
  const played = { ...structuredClone(prior), top: { id: 'b', image: 'g2.webp' } };
  assert.deepEqual(tableTransition(prior, played), [{ type: 'play', seat: 1, image: 'g2.webp' }]);
  const drawn = structuredClone(prior); drawn.seats[0].handCount += 1;
  assert.deepEqual(tableTransition(prior, drawn), [{ type: 'draw', seat: 0 }]);
  const reshuffled = { ...prior, drawPileCount: 57, discardCount: 1 };
  assert.deepEqual(tableTransition(prior, reshuffled), [{ type: 'shuffle' }]);
  assert.deepEqual(tableTransition(prior, { ...prior, phase: 'over' }), []);
});
