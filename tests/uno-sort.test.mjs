/* 第十二版手牌排序口径：红黄绿蓝紫 / 0-9 → 反转 → 禁止 → +2。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sortHand, HAND_SORTS, COLOR_ORDER, KIND_ORDER, WILD_COLOR_ORDER,
} from '../public/app/games/uno/hand-sort.js';

const c = (id, color, kind, value = null) => ({ id, color, kind, value, image: `${id}.webp` });

test('三档排序为 原序 / 按色 / 按点', () => {
  assert.deepEqual(HAND_SORTS.map((item) => item.key), ['default', 'color', 'value']);
});

test('颜色与牌型次序常量符合口径', () => {
  assert.deepEqual(COLOR_ORDER, { r: 0, y: 1, g: 2, b: 3 });
  assert.equal(WILD_COLOR_ORDER, 4);
  assert.equal(KIND_ORDER.reverse, 10);
  assert.equal(KIND_ORDER.skip, 11);
  assert.equal(KIND_ORDER.draw2, 12);
});

test('原序不改变顺序，也不改动传入数组', () => {
  const cards = [c('b1', 'b', 'number', 1), c('r9', 'r', 'number', 9), c('w', null, 'wild')];
  assert.deepEqual(sortHand(cards, 'default').map((item) => item.id), ['b1', 'r9', 'w']);
  assert.deepEqual(cards.map((item) => item.id), ['b1', 'r9', 'w']);
});

test('按色：红 → 黄 → 绿 → 蓝 → 紫（万能牌）', () => {
  const cards = [
    c('wild', null, 'wild'),
    c('b1', 'b', 'number', 1),
    c('r1', 'r', 'number', 1),
    c('g1', 'g', 'number', 1),
    c('y1', 'y', 'number', 1),
    c('wild4', null, 'wild4'),
  ];
  assert.deepEqual(sortHand(cards, 'color').map((item) => item.id),
    ['r1', 'y1', 'g1', 'b1', 'wild', 'wild4']);
});

test('同色内：数字 0-9 → 反转 → 禁止 → +2', () => {
  const cards = [
    c('d2', 'r', 'draw2'),
    c('sk', 'r', 'skip'),
    c('rv', 'r', 'reverse'),
    c('r9', 'r', 'number', 9),
    c('r0', 'r', 'number', 0),
    c('r5', 'r', 'number', 5),
  ];
  assert.deepEqual(sortHand(cards, 'color').map((item) => item.id),
    ['r0', 'r5', 'r9', 'rv', 'sk', 'd2']);
});

test('按点：数字点数优先、同点数按红黄绿蓝紫、功能牌在后', () => {
  const cards = [
    c('y3', 'y', 'number', 3),
    c('w', null, 'wild'),
    c('rd2', 'r', 'draw2'),
    c('g3', 'g', 'number', 3),
    c('r3', 'r', 'number', 3),
    c('b3', 'b', 'number', 3),
  ];
  assert.deepEqual(sortHand(cards, 'value').map((item) => item.id),
    ['r3', 'y3', 'g3', 'b3', 'rd2', 'w']);
});

test('排序只换顺序：牌集合与 id 完全不变（出牌按 id 不会错位）', () => {
  const cards = [
    c('r2', 'r', 'number', 2), c('b2', 'b', 'number', 2), c('y7', 'y', 'number', 7),
    c('gsk', 'g', 'skip'), c('rrv', 'r', 'reverse'), c('bd2', 'b', 'draw2'),
    c('w4', null, 'wild4'), c('w', null, 'wild'),
  ];
  for (const mode of ['color', 'value']) {
    const sorted = sortHand(cards, mode);
    assert.equal(sorted.length, cards.length);
    assert.deepEqual(new Set(sorted.map((item) => item.id)), new Set(cards.map((item) => item.id)));
  }
});

test('未知颜色 / 未知牌型不抛错，归到万能牌之后', () => {
  const cards = [c('x', 'x', 'mystery'), c('r1', 'r', 'number', 1), c('w', null, 'wild')];
  assert.deepEqual(sortHand(cards, 'color').map((item) => item.id), ['r1', 'w', 'x']);
});
