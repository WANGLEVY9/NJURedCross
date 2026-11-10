/* 轻量电脑对手：只依赖规则引擎，不碰 DOM，可单独测试。 */
import { legalMoves, canPlay, COLORS } from './engine.js';

/** 指定手牌里数量最多的颜色，让万能牌尽量转成自己的优势色。 */
export function bestColor(hand) {
  const tally = Object.fromEntries(COLORS.map((color) => [color, 0]));
  for (const card of hand) if (card.color) tally[card.color] += 1;
  return COLORS.reduce((best, color) => (tally[color] > tally[best] ? color : best), COLORS[0]);
}

function weight(card, state) {
  const sameColor = card.color === state.currentColor;
  // 万能牌留到无牌可出时再用。
  if (card.kind === 'wild4') return 1;
  if (card.kind === 'wild') return 2;
  if (card.kind === 'number') return 20 + card.value + (sameColor ? 15 : 0);
  return 30 + (sameColor ? 10 : 0);
}

/**
 * @returns {{type:'play'|'draw'|'pass'|'uno', cardId?:string, chosenColor?:string|null}}
 *   play = 出某张牌；draw = 摸一张；pass = 摸牌后不出、跳过；
 *   uno = 手里两张且尚未喊 UNO，先喊一声（否则出到剩一张会被罚抽 2 张）。
 *   无牌可出时返回 draw；摸牌后由调用方再驱动一次，此时会返回 play 或 pass。
 */
export function chooseAiMove(state, playerIndex = state.turn, difficulty = 'normal') {
  // 电脑也遵守「剩两张先喊 UNO」，否则出牌时会被判忘喊罚抽。
  const me = state.players[playerIndex];
  if (state.phase === 'playing' && me && me.hand.length === 2 && !me.saidUno) {
    return { type: 'uno' };
  }
  // 刚摸了一张牌：能出就出掉，不能出就过（避免卡在「摸牌待决」）。
  if (state.drewCard) {
    const drawn = state.players[playerIndex].hand.find((card) => card.id === state.drewCard);
    if (drawn && canPlay(drawn, state)) {
      const wild = drawn.kind === 'wild' || drawn.kind === 'wild4';
      return {
        type: 'play',
        cardId: drawn.id,
        chosenColor: wild ? bestColor(state.players[playerIndex].hand.filter((item) => item.id !== drawn.id)) : null,
      };
    }
    return { type: 'pass' };
  }

  const ids = legalMoves(state, playerIndex);
  if (!ids.length) return { type: 'draw' };
  const hand = state.players[playerIndex].hand;

  // 罚牌叠加：AI 默认认罚抽牌；只有面对单张 +2（pendingDraw ≤ 2）时才有一半概率反叠 +2。
  // 不主动质疑 +4（无证据机制），避免误判。
  if (state.pendingDraw > 0) {
    const stack2 = ids.find((id) => hand.find((card) => card.id === id)?.kind === 'draw2');
    if (stack2 && state.pendingDraw <= 2 && Math.random() < 0.5) {
      return { type: 'play', cardId: stack2, chosenColor: null };
    }
    return { type: 'draw' };
  }

  const cards = ids.map((id) => hand.find((card) => card.id === id)).filter(Boolean);
  if (difficulty === 'easy') cards.sort(() => Math.random() - 0.5);
  else {
    const threat = state.players.some((player, index) => index !== playerIndex && !player.finished && player.hand.length === 1);
    const defensive = new Set(['draw2', 'skip', 'reverse', 'wild4']);
    const bonus = (card) => (threat && defensive.has(card.kind) ? (difficulty === 'hard' ? 200 : 60) : 0) + (difficulty === 'hard' ? state.players[playerIndex].hand.filter((item) => item.color && item.color === card.color).length * 4 : 0);
    cards.sort((a, b) => weight(b, state) + bonus(b) - weight(a, state) - bonus(a));
  }
  const card = cards[0];
  const wild = card.kind === 'wild' || card.kind === 'wild4';
  return {
    type: 'play',
    cardId: card.id,
    chosenColor: wild ? bestColor(hand.filter((item) => item.id !== card.id)) : null,
  };
}
