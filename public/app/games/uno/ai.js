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
  // 规则层已允许万能牌「随时可出」；AI 仍保守地把万能牌放到最后再打，
  // 避免过早丢掉转色主动权（仅影响出牌偏好，不构成出牌限制）。
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
 * @param {('easy'|'normal'|'hard')} [difficulty='normal'] 电脑强度：
 *   easy 弱（偶尔忘喊 UNO、随机出牌）；normal 按权重；hard 强（安全门禁 + 选色压制对手）。
 */
export function chooseAiMove(state, playerIndex = state.turn, difficulty = 'normal') {
  const me = state.players[playerIndex];
  // 喊 UNO：标准/困难必喊；简单档 60% 概率（偶尔忘喊，给对方翻盘机会）。
  if (state.phase === 'playing' && me && me.hand.length === 2 && !me.saidUno) {
    if (difficulty !== 'easy' || Math.random() < 0.6) return { type: 'uno' };
  }
  // 刚摸了一张牌：能出就出掉，不能出就过（避免卡在「摸牌待决」）。
  if (state.drewCard) {
    const drawn = state.players[playerIndex].hand.find((card) => card.id === state.drewCard);
    if (drawn && canPlay(drawn, state)) {
      const wild = drawn.kind === 'wild' || drawn.kind === 'wild4';
      return {
        type: 'play',
        cardId: drawn.id,
        chosenColor: wild ? pickColor(state, playerIndex, difficulty, drawn) : null,
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

  // 简单档：从可出牌里随机挑一张（弱），不追求压制。
  if (difficulty === 'easy') {
    const pick = cards[Math.floor(Math.random() * cards.length)];
    const wild = pick.kind === 'wild' || pick.kind === 'wild4';
    return { type: 'play', cardId: pick.id, chosenColor: wild ? pickColor(state, playerIndex, difficulty, pick) : null };
  }

  // 安全门禁：有对手只剩 1 张（UNO 危险）时，优先出「压制牌」拖住他，别让他下一手直接出完。
  const threat = state.players.some((p, i) => i !== playerIndex && !p.finished && p.hand.length === 1);
  const defensive = new Set(['draw2', 'skip', 'reverse', 'wild4']);
  const boost = difficulty === 'hard' ? 1000 : 200;
  const scored = cards.map((card) => {
    let w = weight(card, state);
    if (threat && defensive.has(card.kind)) w += boost;
    return { card, w };
  });
  scored.sort((a, b) => b.w - a.w);
  const card = scored[0].card;
  const wild = card.kind === 'wild' || card.kind === 'wild4';
  return {
    type: 'play',
    cardId: card.id,
    chosenColor: wild ? pickColor(state, playerIndex, difficulty, card) : null,
  };
}

/** 万能牌选色：困难档尽量选「被威胁对手（下家）手里最少」的颜色以压制；其余用自己多数色。 */
function pickColor(state, playerIndex, difficulty, playedCard) {
  if (difficulty === 'hard') {
    const next = nextOpponentIndex(state, playerIndex);
    if (next >= 0) {
      const opp = state.players[next].hand.filter((c) => c.color);
      const oppTally = Object.fromEntries(COLORS.map((c) => [c, 0]));
      for (const c of opp) oppTally[c.color] += 1;
      const ownTally = Object.fromEntries(COLORS.map((c) => [c, 0]));
      for (const c of state.players[playerIndex].hand) if (c.color) ownTally[c.color] += 1;
      let best = COLORS[0];
      let bestScore = Infinity;
      for (const c of COLORS) {
        // 对手最少、自己较多 → 最压制
        const score = oppTally[c] * 2 - ownTally[c];
        if (score < bestScore) { bestScore = score; best = c; }
      }
      return best;
    }
  }
  return bestColor(state.players[playerIndex].hand.filter((item) => item.id !== playedCard.id));
}

/** 下一位尚未出局的对手（用于困难档选色压制）。 */
function nextOpponentIndex(state, playerIndex) {
  const count = state.players.length;
  for (let step = 1; step <= count; step += 1) {
    const i = ((playerIndex + state.direction * step) % count + count) % count;
    if (!state.players[i].finished && i !== playerIndex) return i;
  }
  return -1;
}
