/* 三个实用 bug 的回归测试：
 *  1. +4 质疑窗口被下线 → 恢复手动质疑，且判定口径与服务端防滥用一致；
 *  2. +4 之后还能叠 +2 → 罚牌按来源区分，+4 只能被 +4 叠；
 *  3. 双击「摸一张牌」连摸两张 → 摸牌待决时引擎拒绝再摸。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, canPlay, legalMoves, playCard, chooseColor, drawCard,
  challengeCard, canChallenge, statusText,
} from '../public/app/games/uno/engine.js';

let serial = 0;
const card = (spec = {}) => ({
  id: `b${serial += 1}`,
  color: 'r', kind: 'number', value: 0, image: 'r0.webp',
  ...spec,
});

function table(hands, { currentColor = 'r', playerCount = 4 } = {}) {
  const state = structuredClone(createGame({ playerCount, seed: 11 }));
  state.players.forEach((p, i) => { p.hand = hands[i] || []; p.saidUno = false; });
  state.discardPile = [card({ color: currentColor, value: 5 })];
  state.currentColor = currentColor;
  state.direction = 1;
  state.turn = 0;
  state.pendingDraw = 0;
  state.pendingDrawKind = null;
  state.phase = 'playing';
  state.finishedOrder = [];
  state.drawPile = Array.from({ length: 30 }, () => card({ color: 'b', value: 3 }));
  return state;
}

function playWild4(state, color = 'g') {
  return chooseColor(playCard(state, 0, state.players[0].hand[0].id), color);
}

// ── Bug 1：+4 质疑 ──────────────────────────────────────────────

test('+4 后下家开启手动质疑窗口，并记录出牌前的当前色', () => {
  const s = table([
    [card({ kind: 'wild4', color: null }), card({ color: 'r', value: 2 })],
    [card({ color: 'b', value: 3 })], [], [],
  ], { currentColor: 'r' });
  const played = playWild4(s);
  assert.equal(played.pendingDraw, 4);
  assert.equal(canChallenge(played, 1), true, '下家可以质疑');
  assert.equal(canChallenge(played, 0), false, '出牌者本人不能质疑');
  assert.equal(played.pendingChallenge.by, 0);
  assert.equal(played.pendingChallenge.target, 1);
  assert.equal(played.pendingChallenge.colorBefore, 'r');
  assert.equal(played.pendingChallenge.color, 'g', '同时保留指定色用于 UI 提示');
  assert.match(statusText(played), /可质疑/);
});

test('质疑成功：出牌者握有出牌前当前色，自罚整叠且回合留在质疑者', () => {
  // 出牌者留 2 张，避免触发「出到剩 1 张忘喊 UNO」的罚抽干扰手牌数断言。
  const s = table([
    [card({ kind: 'wild4', color: null }), card({ color: 'r', value: 2 }), card({ color: 'b', value: 5 })],
    [card({ color: 'b', value: 3 })], [], [],
  ], { currentColor: 'r' });
  const played = playWild4(s);
  const resolved = challengeCard(played, 1);
  assert.equal(resolved.pendingChallenge, null);
  assert.equal(resolved.pendingDraw, 0);
  assert.equal(resolved.pendingDrawKind, null);
  assert.equal(resolved.players[0].hand.length, 6, '出牌者原 2 张 + 自罚 4 张');
  assert.equal(resolved.players[1].hand.length, 1, '质疑者不被罚');
  assert.equal(resolved.turn, 1, '回合停在质疑者，可继续出牌');
});

test('质疑失败：判定看出牌前当前色，而不是指定色', () => {
  // 出牌者手里有指定色 g、但没有出牌前当前色 r —— 新口径应判质疑失败。
  const s = table([
    [card({ kind: 'wild4', color: null }), card({ color: 'g', value: 2 }), card({ color: 'b', value: 5 })],
    [card({ color: 'g', value: 3 })], [], [],
  ], { currentColor: 'r' });
  const played = playWild4(s, 'g');
  const resolved = challengeCard(played, 1);
  assert.equal(resolved.players[1].hand.length, 7, '质疑者原 1 张 + 罚抽 6 张');
  assert.equal(resolved.players[0].hand.length, 2, '出牌者不受罚');
  assert.equal(resolved.turn, 2, '回合推进到下一位');
});

test('手工构造的旧质疑窗口仍按指定色回退判定（兼容旧存档 / 旧测试）', () => {
  const s = table([
    [card({ kind: 'wild4', color: null }), card({ color: 'g', value: 2 }), card({ color: 'b', value: 5 })],
    [card({ color: 'b', value: 3 })], [], [],
  ], { currentColor: 'r' });
  const played = playWild4(s, 'g');
  played.pendingChallenge = { by: 0, target: 1, color: 'g' };
  const resolved = challengeCard(played, 1);
  assert.equal(resolved.players[0].hand.length, 6, '有指定色 g，出牌者自罚 4 张');
});

// ── Bug 2：+4 之后不能叠 +2 ────────────────────────────────────

test('+4 罚牌下不能用 +2 叠，但可以再叠一张 +4', () => {
  const s = table([
    [card({ kind: 'wild4', color: null }), card({ color: 'r', value: 2 })],
    [
      card({ kind: 'draw2', color: 'g' }),
      card({ kind: 'wild4', color: null }),
      card({ color: 'b', value: 1 }),
    ],
    [], [],
  ], { currentColor: 'r' });
  const played = playWild4(s);
  const [d2, w4, num] = played.players[1].hand;
  assert.equal(played.pendingDraw, 4);
  assert.equal(played.pendingDrawKind, 'wild4');
  assert.equal(canPlay(d2, played), false, '+2 不能叠 +4');
  assert.equal(canPlay(w4, played), true, '+4 可以叠 +4');
  assert.equal(canPlay(num, played), false, '普通牌仍锁住');
  assert.deepEqual(legalMoves(played, 1), [w4.id]);
});

test('+2 罚牌下仍可用 +2 继续叠', () => {
  const s = table([
    [card({ kind: 'draw2', color: 'r' }), card({ color: 'r', value: 2 })],
    [card({ kind: 'draw2', color: 'g' })], [], [],
  ], { currentColor: 'r' });
  const played = playCard(s, 0, s.players[0].hand[0].id);
  assert.equal(played.pendingDraw, 2);
  assert.equal(played.pendingDrawKind, 'draw2');
  assert.equal(canPlay(played.players[1].hand[0], played), true);
});

test('罚牌抽完后来源标记一并清空，不会污染下一次出牌', () => {
  const s = table([
    [card({ kind: 'wild4', color: null }), card({ color: 'r', value: 2 })],
    [card({ color: 'b', value: 3 })], [], [],
  ], { currentColor: 'r' });
  const played = playWild4(s);
  const drawn = drawCard(played, 1);
  assert.equal(drawn.pendingDraw, 0);
  assert.equal(drawn.pendingDrawKind, null);
  assert.equal(drawn.players[1].hand.length, 5, '原 1 张 + 罚抽 4 张');
});

// ── Bug 3：双击摸牌 ─────────────────────────────────────────────

test('摸到可出的牌后再次摸牌被拒绝，不会连摸两张', () => {
  const drawn = card({ color: 'r', value: 9 });
  const s = table([
    [card({ color: 'g', value: 3 })], [], [], [],
  ], { currentColor: 'r' });
  s.drawPile = [...Array.from({ length: 20 }, () => card({ color: 'b', value: 3 })), drawn]; // takeCards 从尾部 pop

  const first = drawCard(s, 0);
  assert.equal(first.drewCard, drawn.id, '摸到 r9 且可出');
  assert.equal(first.players[0].hand.length, 2);

  const second = drawCard(first, 0); // 模拟双击的第二下
  assert.equal(second.drewCard, drawn.id, '待决的那张牌不变');
  assert.equal(second.players[0].hand.length, 2, '没有连摸第二张');
  assert.match(second.flash, /已经摸过一张/);
  assert.deepEqual(second.players[0].hand.map((c) => c.id), first.players[0].hand.map((c) => c.id));
});

test('摸到不能出的牌会正常跳过回合，守卫不误伤', () => {
  const s = table([
    [card({ color: 'g', value: 3 })], [], [], [],
  ], { currentColor: 'r' });
  s.drawPile = [...Array.from({ length: 20 }, () => card({ color: 'b', value: 3 })), card({ color: 'y', value: 7 })];
  const first = drawCard(s, 0);
  assert.equal(first.drewCard, null);
  assert.equal(first.turn, 1, '摸到不能出的牌正常跳过');
  assert.equal(first.players[0].hand.length, 2);
});
