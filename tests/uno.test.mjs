import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDeck, createGame, canPlay, legalMoves, playCard, chooseColor,
  drawCard, passTurn, callUno, scoreHand, nextRound, statusText, rankingOf,
  COLORS, cardImage, describeCard, challengeCard, canChallenge,
} from '../public/app/games/uno/engine.js';
import { chooseAiMove, bestColor } from '../public/app/games/uno/ai.js';

let serial = 0;
const card = (spec = {}) => ({
  id: `t${serial += 1}`,
  color: 'r',
  kind: 'number',
  value: 0,
  image: 'r0.webp',
  ...spec,
});

/** 构造确定局面：0 号玩家出牌，起始牌为红色 5。 */
function table(hands, { currentColor = 'r', top = card({ value: 5, image: 'r5.webp' }), playerCount = 4, winCondition = 'first' } = {}) {
  const base = createGame({ playerCount, seed: 7, winCondition });
  const state = structuredClone(base);
  state.players.forEach((player, index) => {
    player.hand = hands[index] || [];
    player.saidUno = false;
  });
  state.discardPile = [top];
  state.currentColor = currentColor;
  state.direction = 1;
  state.turn = 0;
  state.pendingDraw = 0;
  state.phase = 'playing';
  state.finishedOrder = [];
  state.drawPile = Array.from({ length: 30 }, () => card({ color: 'b', value: 3, image: 'b3.webp' }));
  return state;
}

test('牌组是标准 108 张，四色齐全，万能牌 8 张', () => {
  const deck = createDeck();
  assert.equal(deck.length, 108);
  assert.equal(new Set(deck.map((item) => item.id)).size, 108);
  for (const color of COLORS) {
    const group = deck.filter((item) => item.color === color);
    assert.equal(group.length, 25, `${color} 色应为 25 张`);
    assert.equal(group.filter((item) => item.kind === 'number' && item.value === 0).length, 1);
    assert.equal(group.filter((item) => item.kind === 'number' && item.value === 7).length, 2);
    assert.equal(group.filter((item) => item.kind === 'draw2').length, 2);
  }
  assert.equal(deck.filter((item) => item.kind === 'wild').length, 4);
  assert.equal(deck.filter((item) => item.kind === 'wild4').length, 4);
  assert.equal(cardImage(deck[0]), '/assets/uno/r0.webp');
  assert.equal(describeCard(deck[0]), '红 0');
});

test('开局每人 7 张，首牌是有色牌且决定当前颜色', () => {
  const state = createGame({ playerCount: 4, seed: 11 });
  assert.equal(state.players.length, 4);
  for (const player of state.players) assert.equal(player.hand.length, 7);
  assert.equal(state.discardPile.length, 1);
  assert.equal(state.drawPile.length, 108 - 28 - 1);
  assert.ok(COLORS.includes(state.discardPile[0].color));
  assert.equal(state.currentColor, state.discardPile[0].color);
  assert.equal(state.turn, 0);
  assert.equal(state.phase, 'playing');
});

test('同一 seed 发牌完全一致', () => {
  const a = createGame({ seed: 20261108 });
  const b = createGame({ seed: 20261108 });
  assert.deepEqual(a.players.map((p) => p.hand), b.players.map((p) => p.hand));
  assert.deepEqual(a.discardPile, b.discardPile);
});

test('同色、同数字、同类功能牌可出；异色异数字不可出', () => {
  const state = table([
    [card({ color: 'r', value: 3, image: 'r3.webp' }),
      card({ color: 'g', value: 5, image: 'g5.webp' }),
      card({ kind: 'skip', color: 'b', value: null, image: 'sk-b.webp' }),
      card({ color: 'y', value: 8, image: 'y8.webp' })],
  ], { top: card({ color: 'r', value: 5, image: 'r5.webp' }) });
  // 顶牌换成禁止牌，检验功能牌同类跨色。
  state.discardPile = [card({ color: 'r', kind: 'skip', value: null, image: 'sk-r.webp' })];
  assert.equal(canPlay(state.players[0].hand[0], state), true, '同色');
  assert.equal(canPlay(state.players[0].hand[2], state), true, '同类功能牌跨色');
  assert.equal(canPlay(state.players[0].hand[3], state), false, '异色异数字');
  assert.equal(legalMoves(state, 0).length, 2);
  assert.deepEqual(legalMoves(state, 1), [], '未轮到的玩家没有合法牌');
});

test('万能牌随时可出，未选色先进入 choosing，选色后结算', () => {
  const wild = card({ color: null, kind: 'wild', value: null, image: 'wild.webp' });
  const state = table([[wild, card({ color: 'g', value: 1, image: 'g1.webp' })]]);
  const called = callUno(state, 0);          // 剩两张，先喊 UNO 再出牌
  const pending = playCard(called, 0, wild.id);
  assert.equal(pending.phase, 'choosing');
  assert.equal(pending.pendingCardId, wild.id);
  assert.equal(pending.players[0].hand.length, 2, '选色前不移除手牌');
  assert.equal(state.phase, 'playing', '不修改传入状态');

  const done = chooseColor(pending, 'y');
  assert.equal(done.phase, 'playing');
  assert.equal(done.currentColor, 'y');
  assert.equal(done.players[0].hand.length, 1, '已喊过 UNO，剩一张不罚抽');
  assert.equal(done.discardPile.at(-1).id, wild.id);
  assert.equal(done.flash.includes('UNO'), true, '喊过 UNO 时提示只剩一张');
});

test('加二 / 加四产生罚抽，罚抽期间不能出牌', () => {
  const d2 = card({ kind: 'draw2', value: null, image: 'd2-r.webp' });
  const state = table([
    [d2, card({ color: 'b', value: 2, image: 'b2.webp' })],
    [card({ color: 'r', value: 4, image: 'r4.webp' })],
  ]);
  const after = playCard(state, 0, d2.id);
  assert.equal(after.pendingDraw, 2);
  assert.equal(after.turn, 1);
  assert.deepEqual(legalMoves(after, 1), []);
  const blocked = playCard(after, 1, after.players[1].hand[0]?.id);
  assert.ok(blocked.flash.includes('先抽 2 张'));

  const wild4 = card({ color: null, kind: 'wild4', value: null, image: 'wild4.webp' });
  const four = playCard(table([[wild4, card({ color: 'g', value: 1, image: 'g1.webp' })]]), 0, wild4.id, 'b');
  assert.equal(four.pendingDraw, 4);
  assert.equal(four.currentColor, 'b');

  const drawn = drawCard(four, 1);
  assert.equal(drawn.players[1].hand.length, 4);
  assert.equal(drawn.pendingDraw, 0);
  assert.equal(drawn.turn, 2);
  assert.ok(drawn.flash.includes('跳过这一轮'));
});

test('禁止牌跳一位；反转牌改方向；两人局反转按禁止处理', () => {
  const skip = card({ kind: 'skip', value: null, image: 'sk-r.webp' });
  const skipState = table([[skip, card({ color: 'g', value: 1, image: 'g1.webp' })]]);
  assert.equal(playCard(skipState, 0, skip.id).turn, 2);

  const reverse = card({ kind: 'reverse', value: null, image: 'rv-r.webp' });
  const four = table([[reverse, card({ color: 'g', value: 1, image: 'g1.webp' })]]);
  const reversed = playCard(four, 0, reverse.id);
  assert.equal(reversed.direction, -1);
  assert.equal(reversed.turn, 3);

  const two = table([[reverse, card({ color: 'g', value: 1, image: 'g1.webp' })], []], { playerCount: 2 });
  const twoResult = playCard(two, 0, reverse.id);
  assert.equal(twoResult.direction, -1);
  assert.equal(twoResult.turn, 0);
});

test('出完牌即获胜，按对手剩余手牌计分', () => {
  const last = card({ color: 'r', value: 9, image: 'r9.webp' });
  const state = table([
    [last],
    [card({ color: 'g', value: 3, image: 'g3.webp' }), card({ color: null, kind: 'wild', value: null, image: 'wild.webp' })],
    [card({ kind: 'skip', value: null, image: 'sk-b.webp' })],
    [],
  ]);
  const over = playCard(state, 0, last.id);
  assert.equal(over.phase, 'over');
  assert.equal(over.winner, 0);
  assert.equal(over.scores[0], 3 + 50 + 20);
  assert.equal(over.players[0].hand.length, 0);
  assert.deepEqual(legalMoves(over, 1), []);
});

test('主动抽牌：牌堆见底时把弃牌堆洗回；摸到不能出的牌则回合结束', () => {
  const state = table([[], [], [], []]);
  state.drawPile = [];
  state.discardPile = [
    card({ color: 'g', value: 4, image: 'g4.webp' }),
    card({ color: 'b', value: 2, image: 'b2.webp' }),
    card({ color: 'r', value: 6, image: 'r6.webp' }),
  ];
  state.currentColor = 'r';
  const next = drawCard(state, 0);
  assert.equal(next.players[0].hand.length, 1);
  assert.equal(next.discardPile.length, 1, '顶牌留在弃牌堆');
  assert.ok(next.log.some((line) => line.includes('洗回')));
  // 摸到的牌（g4/b2）与当前红牌不同色，无法出，回合应交给下家。
  assert.equal(next.turn, 1);
  assert.equal(next.drewCard, null);
});

test('主动摸牌摸到能出的牌：回合保留，可出掉或选择「过」', () => {
  const state = table([
    [card({ color: 'b', value: 2, image: 'b2.webp' }), card({ color: 'g', value: 3, image: 'g3.webp' })],
  ], { currentColor: 'r' });
  state.turn = 0;
  state.drawPile = [card({ color: 'r', value: 9, image: 'r9.webp' })]; // 摸到红 9，可出
  const after = drawCard(state, 0);
  assert.equal(after.players[0].hand.length, 3);
  assert.equal(after.drewCard, after.players[0].hand.at(-1).id);
  assert.equal(after.turn, 0, '回合保留');
  assert.ok(legalMoves(after, 0).includes(after.drewCard), '摸到的牌可出');
  // 出掉它
  const played = playCard(after, 0, after.drewCard);
  assert.equal(played.drewCard, null);
  assert.equal(played.turn, 1);
  assert.equal(played.players[0].hand.length, 2);
});

test('主动摸牌摸到不能出的牌：回合直接结束', () => {
  const state = table([
    [card({ color: 'b', value: 2, image: 'b2.webp' }), card({ color: 'g', value: 3, image: 'g3.webp' })],
  ], { currentColor: 'r' });
  state.turn = 0;
  state.drawPile = [card({ color: 'y', value: 7, image: 'y7.webp' })]; // 黄 7，不可出
  const after = drawCard(state, 0);
  assert.equal(after.drewCard, null);
  assert.equal(after.turn, 1, '回合结束');
});

test('摸到牌后选择「过」结束回合；非摸牌态过牌被拒', () => {
  const state = table([
    [card({ color: 'b', value: 2, image: 'b2.webp' }), card({ color: 'g', value: 3, image: 'g3.webp' })],
  ], { currentColor: 'r' });
  state.turn = 0;
  state.drawPile = [card({ color: 'r', value: 9, image: 'r9.webp' })];
  const drawn = drawCard(state, 0);
  assert.ok(drawn.drewCard, '已进入摸牌待决');
  const passed = passTurn(drawn, 0);
  assert.equal(passed.drewCard, null);
  assert.equal(passed.turn, 1);
  // 未摸牌时「过」应被拒
  const blocked = passTurn(state, 0);
  assert.ok(blocked.flash, '非摸牌态不能过');
});

test('新一局继承累计分数', () => {
  const state = createGame({ seed: 5 });
  state.scores[0] = 73;
  const fresh = nextRound(state, 99);
  assert.equal(fresh.round, 2);
  assert.equal(fresh.scores[0], 73);
  assert.equal(fresh.phase, 'playing');
});

test('电脑只出合法牌，万能牌会指定自己手牌最多的颜色', () => {
  const state = table([
    [card({ color: 'g', value: 1, image: 'g1.webp' })],
    [card({ color: 'b', value: 7, image: 'b7.webp' }), card({ color: 'b', value: 2, image: 'b2.webp' }), card({ color: 'r', value: 3, image: 'r3.webp' })],
  ]);
  state.turn = 1;
  state.currentColor = 'b';
  const move = chooseAiMove(state, 1);
  assert.ok(move);
  assert.ok(legalMoves(state, 1).includes(move.cardId));
  assert.equal(move.chosenColor, null);

  const wild = card({ color: null, kind: 'wild4', value: null, image: 'wild4.webp' });
  const wildState = table([[wild], [wild, card({ color: 'y', value: 1, image: 'y1.webp' }), card({ color: 'y', value: 2, image: 'y2.webp' })]], { currentColor: 'r' });
  wildState.turn = 1;
  assert.equal(bestColor(wildState.players[1].hand), 'y');
  const wildMove = chooseAiMove(wildState, 1);
  assert.equal(wildMove.cardId, wildState.players[1].hand[0].id);
  assert.equal(wildMove.chosenColor, 'y');
});

test('scoreHand 按数字面值 / 功能 20 / 万能 50 计分', () => {
  assert.equal(scoreHand([
    card({ value: 9, image: 'r9.webp' }),
    card({ kind: 'skip', value: null, image: 'sk-r.webp' }),
    card({ color: null, kind: 'wild', value: null, image: 'wild.webp' }),
  ]), 79);
});

test('电脑摸牌后决策：能出就出掉，不能出就过', () => {
  const drawnPlayable = card({ color: 'r', value: 9, image: 'r9.webp' });
  const state = table([[card({ color: 'b', value: 2, image: 'b2.webp' })]], { currentColor: 'r' });
  state.turn = 0;
  state.players[0].hand.push(drawnPlayable);
  state.players[0].saidUno = true;           // 已喊过 UNO，专注验证摸牌决策
  state.drewCard = drawnPlayable.id;
  const m1 = chooseAiMove(state, 0);
  assert.equal(m1.type, 'play');
  assert.equal(m1.cardId, drawnPlayable.id);

  const drawnBad = card({ color: 'y', value: 7, image: 'y7.webp' });
  const state2 = table([[card({ color: 'b', value: 2, image: 'b2.webp' })]], { currentColor: 'r' });
  state2.turn = 0;
  state2.players[0].hand.push(drawnBad);
  state2.players[0].saidUno = true;
  state2.drewCard = drawnBad.id;
  const m2 = chooseAiMove(state2, 0);
  assert.equal(m2.type, 'pass');
});

test('罚牌叠加：被罚时 +2 可继续叠，pendingDraw 累加；非罚牌被禁', () => {
  const d2 = card({ kind: 'draw2', value: null, image: 'd2-r.webp' });
  const d2b = card({ kind: 'draw2', value: null, image: 'd2-b.webp' });
  const state = table([
    [d2, card({ color: 'g', value: 1, image: 'g1.webp' })],
    [d2b, card({ color: 'y', value: 3, image: 'y3.webp' })],
  ]);
  const after = playCard(state, 0, d2.id);
  assert.equal(after.pendingDraw, 2);
  assert.equal(after.turn, 1);
  assert.ok(legalMoves(after, 1).includes(d2b.id), '+2 被罚时可叠加');
  const stacked = playCard(after, 1, d2b.id);
  assert.equal(stacked.pendingDraw, 4);
  assert.equal(stacked.turn, 2);
  assert.equal(legalMoves(stacked, 2).length, 0, '非罚牌在被罚时不可出');
});

test('+4 出牌限制：手里有当前色牌时不能出 +4', () => {
  const wild4 = card({ color: null, kind: 'wild4', value: null, image: 'wild4.webp' });
  const has = table([[wild4, card({ color: 'r', value: 5, image: 'r5.webp' })], []], { currentColor: 'r' });
  assert.equal(canPlay(has.players[0].hand[0], has), false);
  const none = table([[wild4, card({ color: 'b', value: 5, image: 'b5.webp' })], []], { currentColor: 'r' });
  assert.equal(canPlay(none.players[0].hand[0], none), true);
});

test('合法 +4 后下家可质疑；出牌者无该色则质疑失败罚抽 6', () => {
  const wild4 = card({ color: null, kind: 'wild4', value: null, image: 'wild4.webp' });
  const state = table([
    [wild4, card({ color: 'b', value: 2, image: 'b2.webp' })],
    [card({ color: 'g', value: 7, image: 'g7.webp' })],
  ], { currentColor: 'g' });
  const played = playCard(state, 0, wild4.id, 'b');
  assert.equal(played.pendingDraw, 4);
  assert.ok(played.pendingChallenge);
  assert.equal(played.pendingChallenge.color, 'g');
  assert.equal(canChallenge(played, 1), true);
  const resolved = challengeCard(played, 1); // 0 号手里无绿 → 质疑失败
  assert.equal(resolved.pendingChallenge, null);
  assert.equal(resolved.pendingDraw, 0);
  assert.equal(resolved.players[1].hand.length, 7); // 原 1 张 + 罚 6
  assert.equal(resolved.turn, 2);
});

test('质疑 +4 成立：出牌者确有该色牌，自罚抽牌、质疑者续打', () => {
  const state = table([
    [card({ color: 'r', value: 5, image: 'r5.webp' }), card({ color: 'g', value: 2, image: 'g2.webp' })],
    [card({ color: 'b', value: 7, image: 'b7.webp' })],
  ], { currentColor: 'g' });
  state.pendingDraw = 4;
  state.turn = 1;
  state.pendingChallenge = { by: 0, target: 1, color: 'g' };
  const resolved = challengeCard(state, 1);
  assert.equal(resolved.pendingChallenge, null);
  assert.equal(resolved.pendingDraw, 0);
  assert.equal(resolved.players[0].hand.length, 6); // 原 2 张 + 自罚 4
  assert.equal(resolved.turn, 1, '回合停在质疑者');
});

test('被罚方选择抽牌即关闭质疑窗口', () => {
  const state = table([
    [card({ color: 'b', value: 2, image: 'b2.webp' })],
    [card({ color: 'b', value: 7, image: 'b7.webp' })],
  ], { currentColor: 'g' });
  state.pendingDraw = 4;
  state.turn = 1;
  state.pendingChallenge = { by: 0, target: 1, color: 'g' };
  const drawn = drawCard(state, 1);
  assert.equal(drawn.pendingChallenge, null);
  assert.equal(drawn.pendingDraw, 0);
  assert.equal(drawn.turn, 2);
});

// ---- 胜负判定：标准制 vs 淘汰制 -----------------------------------------
test('createGame 默认胜负判定为 first，淘汰字段初始化', () => {
  const state = createGame({ playerCount: 4, seed: 3 });
  assert.equal(state.winCondition, 'first');
  assert.equal(state.loser, null);
  assert.deepEqual(state.finishedOrder, []);
  for (const player of state.players) assert.equal(player.finished, false);
  const elim = createGame({ playerCount: 4, seed: 3, winCondition: 'elimination' });
  assert.equal(elim.winCondition, 'elimination');
});

test('标准制：有人先出完立即结束（既有口径不变）', () => {
  const last = card({ color: 'r', value: 9, image: 'r9.webp' });
  const state = table([[last], [card({ color: 'g', value: 3 })], [card({ color: 'r', value: 2 })], []]);
  const over = playCard(state, 0, last.id);
  assert.equal(over.phase, 'over');
  assert.equal(over.winner, 0);
  assert.equal(over.loser, null);
  assert.deepEqual(over.finishedOrder, [0]);
  assert.equal(over.players[0].finished, true);
});

test('淘汰制：第一位出完不结束，标记出局并把回合传给下一位在场者', () => {
  const last = card({ color: 'r', value: 9, image: 'r9.webp' });
  const state = table(
    [[last], [card({ color: 'r', value: 3 })], [card({ color: 'r', value: 4 })], [card({ color: 'r', value: 5 })]],
    { winCondition: 'elimination' },
  );
  const next = playCard(state, 0, last.id);
  assert.equal(next.phase, 'playing', '还有 3 人在场，不能结束');
  assert.equal(next.winner, null);
  assert.equal(next.players[0].finished, true);
  assert.deepEqual(next.finishedOrder, [0]);
  assert.equal(next.turn, 1, '回合顺延给下一位仍在场的人');
  assert.equal(next.pendingDraw, 0, '普通数字牌本来就没有功能效果');
  assert.ok(next.flash.includes('照常结算'));
});

test('淘汰制：出局后 nextTurn 会跳过已出局席位', () => {
  // 0 号在场，1 号已出局，2、3 号在场；0 号摸到不能出的牌后回合应跳到 2 号。
  const state = table(
    [[card({ color: 'g', value: 1 })], [], [card({ color: 'r', value: 2 })], [card({ color: 'r', value: 3 })]],
    { winCondition: 'elimination', currentColor: 'r' },
  );
  state.players[1].finished = true;
  state.finishedOrder = [1];
  state.turn = 0;
  state.drawPile = [card({ color: 'y', value: 7, image: 'y7.webp' })]; // 黄 7 不可出
  const drawn = drawCard(state, 0);
  assert.equal(drawn.turn, 2, '跳过已出局的 1 号，直接到 2 号');
});

test('淘汰制：玩到倒数第二位出完才结束，冠军为最先出完者、最后一人垫底', () => {
  // 四人全红牌，逐一出完；3 号手握两张，永远留在手上当输家。
  const r = (value) => card({ color: 'r', value, image: `r${value}.webp` });
  let state = table(
    [[r(9)], [r(8)], [r(7)], [r(6), r(6)]],
    { winCondition: 'elimination', currentColor: 'r' },
  );
  state.drawPile = [card({ color: 'b', value: 3, image: 'b3.webp' })];
  // 0 号出完
  state = playCard(state, 0, state.players[0].hand[0].id);
  assert.equal(state.phase, 'playing');
  assert.deepEqual(state.finishedOrder, [0]);
  assert.equal(state.turn, 1);
  // 1 号出完
  state = playCard(state, 1, state.players[1].hand[0].id);
  assert.equal(state.phase, 'playing', '还剩 2 人，仍不结束');
  assert.deepEqual(state.finishedOrder, [0, 1]);
  assert.equal(state.turn, 2);
  // 2 号出完 → 只剩 3 号，倒数第二位出完，游戏结束
  state = playCard(state, 2, state.players[2].hand[0].id);
  assert.equal(state.phase, 'over');
  assert.deepEqual(state.finishedOrder, [0, 1, 2]);
  assert.equal(state.winner, 0, '冠军＝最先出完的人');
  assert.equal(state.loser, 3, '最后留在手上的输家');
  assert.equal(state.players[3].finished, false);
});

test('淘汰制：出完的是加四，罚牌照常结算，但不开质疑窗口', () => {
  const wild4 = card({ color: null, kind: 'wild4', value: null, image: 'wild4.webp' });
  const state = table(
    [[wild4], [card({ color: 'r', value: 2 })], [card({ color: 'r', value: 3 })], [card({ color: 'r', value: 4 })]],
    { winCondition: 'elimination', currentColor: 'g' },
  );
  const next = playCard(state, 0, wild4.id, 'r'); // 手里无绿，可出 +4 并选色
  assert.equal(next.phase, 'playing');
  assert.equal(next.players[0].finished, true);
  assert.equal(next.currentColor, 'r', '指定颜色生效');
  assert.equal(next.pendingDraw, 4, '加四罚牌照常结算给在场下家');
  assert.equal(next.pendingChallenge, null, '出牌者已离桌，不设质疑窗口');
  assert.equal(next.turn, 1);
  const drawn = drawCard(next, 1);
  assert.equal(drawn.pendingDraw, 0);
  assert.equal(drawn.players[1].hand.length, 5, '原 1 张 + 罚抽 4 张');
});

test('淘汰制状态文案：进行中提示在场人数，结束提示冠军与垫底', () => {
  const r = (value) => card({ color: 'r', value, image: `r${value}.webp` });
  let state = table(
    [[r(9)], [r(8)], [r(7)]],
    { winCondition: 'elimination', currentColor: 'r', playerCount: 3 },
  );
  state.drawPile = [card({ color: 'b', value: 3, image: 'b3.webp' })];
  state = playCard(state, 0, state.players[0].hand[0].id);
  assert.ok(statusText(state).includes('剩 2 人在场'));
  state = playCard(state, 1, state.players[1].hand[0].id); // 只剩 2 号 → 结束
  assert.equal(state.phase, 'over');
  assert.equal(state.winner, 0);
  assert.equal(state.loser, 2);
  const text = statusText(state);
  assert.ok(text.includes('夺冠') && text.includes('垫底'));
});

test('nextRound 保留胜负判定方式', () => {
  const state = createGame({ playerCount: 4, seed: 5, winCondition: 'elimination' });
  state.scores[0] = 42;
  const fresh = nextRound(state, 99);
  assert.equal(fresh.round, 2);
  assert.equal(fresh.winCondition, 'elimination');
  assert.equal(fresh.scores[0], 42);
  assert.deepEqual(fresh.finishedOrder, []);
});

/** 让电脑自动打完一整局，返回终局 state（防止死循环设上限）。 */
function autoPlay(seed, winCondition) {
  let state = createGame({ playerCount: 4, seed, winCondition });
  let guard = 0;
  while (state.phase !== 'over' && guard < 6000) {
    guard += 1;
    if (state.phase === 'choosing') {
      state = chooseColor(state, bestColor(state.players[state.turn].hand));
      continue;
    }
    const move = chooseAiMove(state, state.turn);
    if (move.type === 'uno') state = callUno(state, state.turn);
    else if (move.type === 'play') state = playCard(state, state.turn, move.cardId, move.chosenColor);
    else if (move.type === 'pass') state = passTurn(state, state.turn);
    else state = drawCard(state, state.turn);
    // 仅在对局进行中要求「回合不落在已出局席位」；终局时 turn 停在刚出完的人身上属正常。
    if (state.phase !== 'over') {
      assert.equal(state.players[state.turn]?.finished, false, '进行中回合不该落在已出局席位');
    }
  }
  assert.equal(state.phase, 'over', '不应打满步数上限仍未结束');
  return state;
}

test('淘汰制整局模拟（多 seed）：能打到只剩一人，名次完整且不卡死', () => {
  for (const seed of [1, 7, 20261108, 424242]) {
    const state = autoPlay(seed, 'elimination');
    assert.equal(state.phase, 'over', `seed ${seed} 应正常结束`);
    assert.equal(state.finishedOrder.length, 3, `seed ${seed} 应有 3 人先后出完`);
    assert.equal(state.players.filter((p) => !p.finished).length, 1, `seed ${seed} 应只剩 1 人`);
    assert.equal(state.loser, state.players.findIndex((p) => !p.finished), `seed ${seed} 输家应一致`);
    assert.equal(state.winner, state.finishedOrder[0], `seed ${seed} 冠军应是最先出完者`);
    assert.equal(new Set(state.finishedOrder).size, 3, `seed ${seed} 名次不重复`);
    assert.ok(!state.finishedOrder.includes(state.loser), `seed ${seed} 输家不该出现在出完名单`);
  }
});

test('标准制整局模拟：有人先出完即结束（回归保护）', () => {
  const state = autoPlay(20261108, 'first');
  assert.equal(state.phase, 'over');
  assert.equal(state.winner, state.finishedOrder[0]);
  assert.equal(state.loser, null);
  assert.equal(state.players.filter((p) => !p.finished).length, 3, '标准制只走掉 1 人就结束');
});

// ---- 淘汰制：出完牌那张的功能牌照常结算 --------------------------------
test('淘汰制出完牌打出加二：罚牌照常结算给在场下家', () => {
  const d2 = card({ kind: 'draw2', color: 'r', value: null, image: 'd2-r.webp' });
  const state = table(
    [[d2], [card({ color: 'r', value: 2 })], [card({ color: 'r', value: 3 })], [card({ color: 'r', value: 4 })]],
    { winCondition: 'elimination', currentColor: 'r' },
  );
  const next = playCard(state, 0, d2.id);
  assert.equal(next.phase, 'playing');
  assert.equal(next.players[0].finished, true);
  assert.equal(next.pendingDraw, 2, '加二罚牌不因出局作废');
  assert.equal(next.turn, 1);
  assert.deepEqual(legalMoves(next, 1), [], '下家必须先抽罚牌');
});

test('淘汰制出完牌打出禁止：仍跳过一位在场玩家', () => {
  const skip = card({ kind: 'skip', color: 'r', value: null, image: 'sk-r.webp' });
  const state = table(
    [[skip], [card({ color: 'r', value: 2 })], [card({ color: 'r', value: 3 })], [card({ color: 'r', value: 4 })]],
    { winCondition: 'elimination', currentColor: 'r' },
  );
  const next = playCard(state, 0, skip.id);
  assert.equal(next.turn, 2, '禁止效果照常结算');
  assert.equal(next.players[0].finished, true);
});

test('淘汰制出完牌打出反转：改方向；两人残局按禁止处理', () => {
  const reverse = card({ kind: 'reverse', color: 'r', value: null, image: 'rv-r.webp' });
  const four = table(
    [[reverse], [card({ color: 'r', value: 2 })], [card({ color: 'r', value: 3 })], [card({ color: 'r', value: 4 })]],
    { winCondition: 'elimination', currentColor: 'r' },
  );
  const reversed = playCard(four, 0, reverse.id);
  assert.equal(reversed.direction, -1);
  assert.equal(reversed.turn, 3, '四人局反转后走向上家');

  // 1 号已出局，0 号出完本张后只剩 2、3 号在场 → 按「两人局」当禁止牌处理（steps=2）。
  const twoLeft = table(
    [[reverse], [], [card({ color: 'r', value: 3 })], [card({ color: 'r', value: 4 })]],
    { winCondition: 'elimination', currentColor: 'r' },
  );
  twoLeft.players[1].finished = true;
  twoLeft.finishedOrder = [1];
  const twoLeftResult = playCard(twoLeft, 0, reverse.id);
  assert.equal(twoLeftResult.direction, -1);
  assert.equal(twoLeftResult.turn, 2, '两人残局反转按禁止处理，跳过一位在场玩家');
});

test('淘汰制终局那张功能牌不残留待罚牌', () => {
  const d2 = card({ kind: 'draw2', color: 'r', value: null, image: 'd2-r.webp' });
  let state = table(
    [[card({ color: 'r', value: 9 })], [d2], [card({ color: 'r', value: 7 })]],
    { winCondition: 'elimination', currentColor: 'r', playerCount: 3 },
  );
  state = playCard(state, 0, state.players[0].hand[0].id);
  assert.equal(state.phase, 'playing');
  state = playCard(state, 1, state.players[1].hand[0].id); // 倒数第二位出完，触发终局
  assert.equal(state.phase, 'over');
  assert.equal(state.pendingDraw, 0, '终局时不再留无人承接的罚牌');
  assert.equal(state.loser, 2);
});

// ---- 名次口径（结算面板与战绩入库共用）----------------------------------
test('rankingOf：淘汰制按出完顺序加垫底，标准制按分数排且冠军第一', () => {
  const elim = createGame({ playerCount: 4, seed: 1, winCondition: 'elimination' });
  elim.finishedOrder = [2, 0, 3];
  elim.loser = 1;
  elim.winner = 2;
  assert.deepEqual(rankingOf(elim), [2, 0, 3, 1]);

  const std = createGame({ playerCount: 4, seed: 1 });
  std.winner = 1;
  std.scores = [10, 50, 30, 20];
  assert.deepEqual(rankingOf(std), [1, 2, 3, 0]);

  // 兼容前端投影（用 seats 代替 players）
  assert.deepEqual(rankingOf({
    seats: [{}, {}, {}, {}], winCondition: 'elimination', finishedOrder: [1], loser: 2,
  }), [1, 2]);
});

// ---- 喊 UNO（第七版）---------------------------------------------------
test('callUno：剩两张本人回合可喊，重复喊 / 非本人 / 手牌数不对都被拒', () => {
  const state = table([
    [card({ color: 'r', value: 1, image: 'r1.webp' }), card({ color: 'r', value: 2, image: 'r2.webp' })],
    [card({ color: 'g', value: 3, image: 'g3.webp' })],
  ]);
  const called = callUno(state, 0);
  assert.equal(called.players[0].saidUno, true);
  assert.equal(state.players[0].saidUno, false, '不修改传入状态');
  assert.ok(called.flash.includes('UNO'));
  assert.ok(callUno(called, 0).flash.includes('已经喊过'));
  assert.ok(callUno(state, 1).flash.includes('还没轮到你'));

  const many = table([
    [card({ color: 'r', value: 1 }), card({ color: 'r', value: 2 }), card({ color: 'r', value: 3 })],
  ]);
  assert.ok(callUno(many, 0).flash.includes('剩两张'));
});

test('忘喊 UNO：出到剩一张立刻罚抽 2 张，回合照常推进', () => {
  const state = table([
    [card({ color: 'r', value: 1, image: 'r1.webp' }), card({ color: 'r', value: 2, image: 'r2.webp' })],
    [card({ color: 'g', value: 3, image: 'g3.webp' })],
  ]);
  const after = playCard(state, 0, state.players[0].hand[0].id);
  assert.equal(after.players[0].hand.length, 3, '1 张 + 罚抽 2 张');
  assert.equal(after.players[0].saidUno, false);
  assert.ok(after.flash.includes('忘了喊 UNO'));
  assert.ok(after.log.some((line) => line.includes('罚抽 2 张')));
  assert.equal(after.phase, 'playing');
});

test('先喊 UNO 再出牌：只剩一张且不罚抽', () => {
  const state = table([
    [card({ color: 'r', value: 1, image: 'r1.webp' }), card({ color: 'r', value: 2, image: 'r2.webp' })],
    [card({ color: 'g', value: 3, image: 'g3.webp' })],
  ]);
  const called = callUno(state, 0);
  const after = playCard(called, 0, called.players[0].hand[0].id);
  assert.equal(after.players[0].hand.length, 1);
  assert.equal(after.players[0].saidUno, true);
  assert.ok(after.flash.includes('UNO'));
  assert.equal(after.drawPile.length, state.drawPile.length, '没有额外抽牌');
});

test('电脑剩两张会先自动喊 UNO，喊完再决策出牌', () => {
  const state = table([
    [card({ color: 'r', value: 1, image: 'r1.webp' }), card({ color: 'r', value: 2, image: 'r2.webp' })],
    [card({ color: 'g', value: 3, image: 'g3.webp' })],
  ]);
  assert.equal(chooseAiMove(state, 0).type, 'uno');
  const called = callUno(state, 0);
  const move = chooseAiMove(called, 0);
  assert.equal(move.type, 'play', '喊过之后才出牌');
  assert.ok(called.players[0].hand.some((item) => item.id === move.cardId));
});
