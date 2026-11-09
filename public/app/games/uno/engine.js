/* ==========================================================================
   UNO 规则引擎 —— 纯函数模块
   - 不碰 DOM、不依赖浏览器 API，可被 node --test 直接 import
   - 所有动作 state -> state，不修改传入对象
   - 随机数以 state.rngState 保存（可复现、可 structuredClone）
   联机版可直接把本模块放到服务端做权威判定，UI 层无需改动。
   ========================================================================== */

export const COLORS = ['r', 'g', 'b', 'y'];
export const COLOR_LABELS = { r: '红', g: '绿', b: '蓝', y: '黄' };
export const COLOR_NAMES = { r: '红桃', g: '绿叶', b: '蓝海', y: '暖阳' };
export const KIND_LABELS = {
  number: '', draw2: '加二', reverse: '反转', skip: '禁止', wild: '变色', wild4: '加四',
};

/** 一张牌对应的网页素材路径。 */
export function cardImage(card) {
  return `/assets/uno/${card.image}`;
}

export function describeCard(card) {
  if (!card) return '空';
  const color = card.color ? COLOR_LABELS[card.color] : '';
  if (card.kind === 'number') return `${color} ${card.value}`;
  return card.color ? `${color} ${KIND_LABELS[card.kind]}` : KIND_LABELS[card.kind];
}

/** 标准 UNO 108 张：每色 0×1、1-9×2、三类功能牌各×2，万能牌各×4。 */
export function createDeck() {
  const cards = [];
  let serial = 0;
  const add = (color, kind, value, image, count) => {
    for (let i = 0; i < count; i += 1) {
      cards.push({ id: `c${serial += 1}`, color, kind, value, image });
    }
  };
  for (const color of COLORS) {
    add(color, 'number', 0, `${color}0.webp`, 1);
    for (let value = 1; value <= 9; value += 1) add(color, 'number', value, `${color}${value}.webp`, 2);
    add(color, 'draw2', null, `d2-${color}.webp`, 2);
    add(color, 'reverse', null, `rv-${color}.webp`, 2);
    add(color, 'skip', null, `sk-${color}.webp`, 2);
  }
  add(null, 'wild', null, 'wild.webp', 4);
  add(null, 'wild4', null, 'wild4.webp', 4);
  return cards;
}

/** mulberry32：把随机数状态写回 state，保证同一 seed 可复现且状态可克隆。 */
function random(state) {
  let t = (state.rngState + 0x6D2B79F5) >>> 0;
  state.rngState = t;
  let r = t;
  r = Math.imul(r ^ (r >>> 15), r | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
}

function shuffled(state, cards) {
  const out = cards.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random(state) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const clone = (state) => structuredClone(state);

function reject(state, message) {
  const next = clone(state);
  next.flash = message;
  return next;
}

function say(state, message) {
  const next = state;
  next.log = [...next.log.slice(-11), message];
  return next;
}

export function topCard(state) {
  return state.discardPile[state.discardPile.length - 1] || null;
}

/**
 * 下一位玩家；reverse 只改方向，步数由调用方决定。
 * 会跳过已出局（finished）的席位——淘汰制下有人出完手牌后不再轮到他。
 */
function nextTurn(state, steps = 1) {
  const count = state.players.length;
  if (count === 0) return state.turn;
  let index = state.turn;
  for (let step = 0; step < steps; step += 1) {
    let guard = 0;
    do {
      index = ((index + state.direction) % count + count) % count;
      guard += 1;
    } while (state.players[index].finished && guard <= count);
  }
  return index;
}

/** 一张牌对应的「跳过步数」：禁止 +2、反转在「只剩两人」时按禁止处理（也 +2），其余 +1。
 *  淘汰制按「仍在场人数」判定，而不是开局总人数——打到两人残局时反转应等同禁止。 */
function cardStep(card, activeCount) {
  switch (card.kind) {
    case 'skip': return 2;
    case 'reverse': return activeCount <= 2 ? 2 : 1;
    default: return 1;
  }
}

/** 牌堆不够时，把弃牌堆（除顶牌）洗回；返回实际抽到的牌。 */
function takeCards(state, count) {
  const taken = [];
  while (taken.length < count) {
    if (!state.drawPile.length) {
      if (state.discardPile.length <= 1) break;
      const top = state.discardPile.pop();
      state.drawPile = shuffled(state, state.discardPile);
      state.discardPile = [top];
      say(state, '弃牌堆已洗回牌堆');
    }
    taken.push(state.drawPile.pop());
  }
  return taken;
}

/**
 * 开一局。首张翻出的牌取一张有色牌，功能牌效果不结算（简化口径）。
 * @param {{playerCount?: number, seed?: number, cardsPerPlayer?: number}} options
 */
export function createGame({ playerCount = 4, seed = Date.now(), cardsPerPlayer = 7, winCondition = 'first' } = {}) {
  // winCondition: 'first' = 有人先出完即结束；'elimination' = 一直玩到倒数第二位出完（最后留在手里的是输家）。
  const names = ['你', '小南', '苏荷', '格格'];
  const state = {
    players: Array.from({ length: playerCount }, (_, index) => ({
      id: `p${index}`,
      name: names[index] || `玩家 ${index + 1}`,
      isHuman: index === 0,
      hand: [],
      saidUno: false,
      finished: false,         // 淘汰制下是否已出完手牌（出局）
    })),
    drawPile: [],
    discardPile: [],
    currentColor: null,
    direction: 1,
    turn: 0,
    pendingDraw: 0,
    phase: 'playing',
    winner: null,
    loser: null,               // 淘汰制下最后留在手上的输家（席位索引）
    finishedOrder: [],         // 淘汰制下出完顺序（席位索引，越早出完越靠前）
    winCondition,
    pendingCardId: null,
    pendingChallenge: null,
    drewCard: null,            // 主动摸牌后那一张的 id；非空表示「摸到可出、可出掉或跳过」
    rngState: seed >>> 0,
    scores: Array.from({ length: playerCount }, () => 0),
    round: 1,
    log: [],
    flash: '',
  };

  state.drawPile = shuffled(state, createDeck());
  for (let round = 0; round < cardsPerPlayer; round += 1) {
    for (const player of state.players) player.hand.push(state.drawPile.pop());
  }

  // 首牌不用万能牌，避免开局就要选色。
  let firstIndex = state.drawPile.length - 1;
  while (firstIndex >= 0 && !state.drawPile[firstIndex].color) firstIndex -= 1;
  if (firstIndex < 0) firstIndex = state.drawPile.length - 1;
  const [first] = state.drawPile.splice(firstIndex, 1);
  state.discardPile.push(first);
  state.currentColor = first.color;
  say(state, `第 ${state.round} 局开始，起始牌：${describeCard(first)}`);
  return state;
}

export function scoreHand(hand) {
  return hand.reduce((total, card) => {
    if (card.kind === 'number') return total + card.value;
    if (card.kind === 'wild' || card.kind === 'wild4') return total + 50;
    return total + 20;
  }, 0);
}

/** 一组手牌里是否有与指定颜色相同的牌（用于 +4 出牌限制与质疑判定）。 */
export function hasCurrentColorCard(hand, color) {
  if (!color) return false;
  return hand.some((card) => card.color === color);
}

/**
 * 一张牌此刻能否打出。
 *  - +2：仅在被罚（pendingDraw > 0）时可出，用于「罚牌叠加」。
 *  - +4：手里有当前色牌时一律不能出（出牌限制）；否则任意时机可出。
 *  - 被罚时，数字牌 / 禁止 / 反转 / 变色 都不能出，只能继续叠罚牌。
 */
export function canPlay(card, state) {
  if (!card || state.phase !== 'playing') return false;
  // 摸到牌后只允许出那一张（官方规则：抽到能出的牌才可接着出，其它牌一律锁定）。
  if (state.drewCard && card.id !== state.drewCard) return false;
  // 罚牌叠加：被罚（pendingDraw > 0）时只能继续叠罚牌（+2 随时；+4 须手里无当前色牌）。
  if (state.pendingDraw > 0) {
    if (card.kind === 'draw2') return true;
    if (card.kind === 'wild4') return !hasCurrentColorCard(state.players[state.turn].hand, state.currentColor);
    return false;
  }
  if (card.kind === 'wild') return true;
  if (card.kind === 'wild4') return !hasCurrentColorCard(state.players[state.turn].hand, state.currentColor);
  if (!state.currentColor) return true;
  const top = topCard(state);
  if (card.color === state.currentColor) return true;
  if (!top) return false;
  if (card.kind === 'number' && top.kind === 'number' && card.value === top.value) return true;
  if (card.kind !== 'number' && top.kind === card.kind) return true;
  return false;
}

/** 当前玩家所有可出的牌 id。UI 直接拿它决定哪些牌可点。 */
export function legalMoves(state, playerIndex = state.turn) {
  if (state.phase !== 'playing' || state.turn !== playerIndex) return [];
  return state.players[playerIndex].hand.filter((card) => canPlay(card, state)).map((card) => card.id);
}

/** 当前玩家是否处于「可质疑 +4」的窗口（轮到他、且上一张是待质疑的 +4）。 */
export function canChallenge(state, playerIndex = state.turn) {
  return state.phase === 'playing'
    && state.pendingChallenge
    && state.pendingChallenge.target === playerIndex
    && state.turn === playerIndex;
}

/**
 * 质疑上一张 +4：只有被指向下家（pendingChallenge.target）能发起。
 *  - 质疑成立：出 +4 的人手里确有指定色牌，他自己罚抽当前罚牌堆（吃掉整叠），质疑者正常出牌。
 *  - 质疑失败：质疑者罚抽 6 张，回合推进。
 */
export function challengeCard(state, challengerIndex) {
  if (state.phase !== 'playing' || !state.pendingChallenge) return reject(state, '现在不能质疑');
  if (state.pendingChallenge.target !== challengerIndex) return reject(state, '现在不是你能质疑的时机');
  if (state.turn !== challengerIndex) return reject(state, '现在还没轮到你');
  const next = clone(state);
  const pc = next.pendingChallenge;
  const cheater = next.players[pc.by];
  const hadColor = cheater.hand.some((card) => card.color === pc.color);
  next.pendingChallenge = null;
  if (hadColor) {
    const amount = next.pendingDraw > 0 ? next.pendingDraw : 4;
    const drawn = takeCards(next, amount);
    cheater.hand.push(...drawn);
    next.pendingDraw = 0;
    next.flash = `${cheater.name} 被质疑成功，自己罚抽 ${drawn.length} 张`;
    say(next, `${cheater.name} 被质疑：手里有${COLOR_LABELS[pc.color]}色牌，罚抽 ${drawn.length} 张`);
  } else {
    const drawn = takeCards(next, 6);
    next.players[challengerIndex].hand.push(...drawn);
    next.pendingDraw = 0;
    next.turn = nextTurn(next);
    next.flash = `质疑不成立，你罚抽 ${drawn.length} 张`;
    say(next, `${next.players[challengerIndex].name} 质疑失败，罚抽 ${drawn.length} 张`);
  }
  return next;
}

/**
 * 喊 UNO：手里剩两张、即将打出倒数第二张时，必须先按「喊 UNO!」。
 * 忘了喊就在 commitPlay 里罚抽 2 张（见上方分支）。
 * 电脑由 chooseAiMove 返回 {type:'uno'} 自动喊，真人由手牌区按钮触发。
 */
export function callUno(state, playerIndex) {
  if (state.phase !== 'playing' && state.phase !== 'choosing') return reject(state, '现在不能喊 UNO');
  if (state.turn !== playerIndex) return reject(state, '现在还没轮到你');
  const player = state.players[playerIndex];
  if (!player || player.hand.length < 1 || player.hand.length > 2) {
    return reject(state, '手里剩两张牌时才需要喊 UNO');
  }
  if (player.saidUno) return reject(state, '已经喊过 UNO 了');
  const next = clone(state);
  next.players[playerIndex].saidUno = true;
  next.flash = `${player.name}：UNO！`;
  say(next, `${player.name} 喊了 UNO！`);
  return next;
}

function commitPlay(next, playerIndex, card, chosenColor) {
  next.drewCard = null;          // 任何出牌都清掉「摸牌待决」标记
  const preColor = next.currentColor; // 本张出牌前的当前色，用于 +4 质疑判定
  const player = next.players[playerIndex];
  player.hand = player.hand.filter((item) => item.id !== card.id);
  next.discardPile.push(card);
  next.currentColor = chosenColor || card.color;
  next.pendingCardId = null;
  next.phase = 'playing';
  next.flash = '';
  say(next, `${player.name} 打出 ${describeCard(card)}${chosenColor ? `（指定${COLOR_LABELS[chosenColor]}）` : ''}`);

  const wentOut = player.hand.length === 0;
  if (wentOut) {
    // 按仍留在场上的其他玩家手牌计分（先出完者分数最高）。
    const points = next.players.reduce((sum, other, index) => (
      index === playerIndex ? sum : sum + scoreHand(other.hand)), 0);
    next.scores[playerIndex] += points;
    next.players[playerIndex].finished = true;
    next.finishedOrder = [...next.finishedOrder, playerIndex];
    say(next, `${player.name} 出完所有牌，本局得 ${points} 分`);
  } else if (player.hand.length === 1) {
    // 出到只剩一张：必须提前喊过 UNO（见 callUno），否则按官方口径罚抽 2 张。
    if (player.saidUno) {
      next.flash = `${player.name} 喊了 UNO！只剩一张牌`;
      say(next, `${player.name}：UNO！`);
    } else {
      const drawn = takeCards(next, 2);
      player.hand.push(...drawn);
      player.saidUno = false;
      next.flash = `${player.name} 忘了喊 UNO，罚抽 ${drawn.length} 张`;
      say(next, next.flash);
    }
  } else {
    player.saidUno = false;
  }

  // ---- 终局判定 ----
  if (wentOut && next.winCondition !== 'elimination') {
    // 标准制：有人先出完即结束。
    next.phase = 'over';
    next.winner = playerIndex;
    next.direction = 1;
    next.pendingDraw = 0;
    next.pendingChallenge = null;
    return next;
  }
  if (wentOut && next.winCondition === 'elimination') {
    const remaining = next.players.filter((p) => !p.finished).length;
    if (remaining <= 1) {
      // 只剩最后一人（倒数第二位出完触发结束）：最先出完者为冠军，最后留在手上的是输家。
      // 终局瞬间不必再结算这张牌的罚牌（已无人可被罚），直接收局。
      next.phase = 'over';
      next.loser = next.players.findIndex((p) => !p.finished);
      next.winner = next.finishedOrder[0];
      next.direction = 1;
      next.pendingDraw = 0;
      next.pendingChallenge = null;
      say(next, `只剩一人，淘汰赛结束：${next.players[next.winner].name} 夺冠，${next.players[next.loser]?.name || ''} 垫底`);
      return next;
    }
    // 出完牌者离桌，但这张牌的功能牌效果照常结算（禁止/反转/加二/加四）传给在场下家。
    next.flash = `${player.name} 出完离桌，功能牌效果照常结算！其余人继续`;
  }

  // 罚牌叠加：在已有罚牌上再叠一张 +2，旧有的 +4 质疑窗口作废（选择叠牌即放弃质疑）。
  if (next.pendingChallenge && card.kind !== 'wild4') next.pendingChallenge = null;

  const activeCount = next.players.filter((p) => !p.finished).length || next.players.length;
  const steps = cardStep(card, activeCount);
  if (card.kind === 'reverse') next.direction *= -1;
  if (card.kind === 'draw2') next.pendingDraw += 2;
  if (card.kind === 'wild4') next.pendingDraw += 4;
  next.turn = nextTurn(next, steps);

  // 打出加四：只有出牌者仍在场才开质疑窗口。出完牌离桌时手里只剩这一张万能牌，
  // 出牌前必然没有当前色牌，+4 一定合法，开窗口只会指向一个已不在场的处罚对象。
  if (card.kind === 'wild4' && !wentOut) {
    next.pendingChallenge = { by: playerIndex, target: next.turn, color: preColor };
  }
  return next;
}

/**
 * 出牌。万能牌未指定颜色时进入 choosing 阶段，由 chooseColor() 结算。
 * 非法出牌返回带 flash 提示的新 state，游戏状态不变。
 */
export function playCard(state, playerIndex, cardId, chosenColor = null) {
  if (state.phase !== 'playing' || state.turn !== playerIndex) return reject(state, '现在还没轮到你');
  const player = state.players[playerIndex];
  const card = player.hand.find((item) => item.id === cardId);
  if (!card) return reject(state, '找不到这张牌');
  if (!canPlay(card, state)) return reject(state, state.pendingDraw > 0 ? `先抽 ${state.pendingDraw} 张牌` : '这张牌现在不能出');

  if ((card.kind === 'wild' || card.kind === 'wild4') && !chosenColor) {
    const next = clone(state);
    next.phase = 'choosing';
    next.pendingCardId = card.id;
    next.flash = '请选择接下来要跟的颜色';
    return next;
  }
  if (chosenColor && !COLORS.includes(chosenColor)) return reject(state, '颜色无效');

  return commitPlay(clone(state), playerIndex, card, chosenColor);
}

/** 万能牌选色后结算。 */
export function chooseColor(state, color) {
  if (state.phase !== 'choosing' || !COLORS.includes(color)) return reject(state, '现在不需要选颜色');
  const next = clone(state);
  const cardId = next.pendingCardId;
  return commitPlay(next, next.turn, next.players[next.turn].hand.find((item) => item.id === cardId), color);
}

/**
 * 抽牌。被罚（pendingDraw > 0）时一次性抽完罚牌并跳过回合；
 * 主动抽牌抽 1 张：若摸到可出的牌，回合保留，可出掉或选择「过」；否则跳过回合。
 */
export function drawCard(state, playerIndex) {
  if (state.phase !== 'playing' || state.turn !== playerIndex) return reject(state, '现在还没轮到你');
  const next = clone(state);
  // 轮到被罚的人选择抽牌，即视为放弃对 +4 的质疑窗口。
  if (next.pendingChallenge && next.pendingChallenge.target === playerIndex) next.pendingChallenge = null;
  const penalty = next.pendingDraw > 0;
  if (penalty) {
    const drawn = takeCards(next, next.pendingDraw);
    next.players[playerIndex].hand.push(...drawn);
    next.players[playerIndex].saidUno = false;
    next.pendingDraw = 0;
    next.drewCard = null;
    next.flash = `被罚抽 ${drawn.length} 张，跳过这一轮`;
    say(next, `${next.players[playerIndex].name} ${next.flash}`);
    next.turn = nextTurn(next);
    return next;
  }
  // 主动摸牌：摸 1 张；能出则保留回合（drewCard 标记），不能出则直接跳过。
  const drawn = takeCards(next, 1);
  const card = drawn[0] || null;
  next.players[playerIndex].hand.push(...drawn);
  next.players[playerIndex].saidUno = false;
  if (!card) {
    next.drewCard = null;
    next.flash = '牌堆已空，跳过这一轮';
    next.turn = nextTurn(next);
    return next;
  }
  if (canPlay(card, next)) {
    next.drewCard = card.id;
    next.flash = `摸到 ${describeCard(card)}，可出掉或选择「过」`;
  } else {
    next.drewCard = null;
    next.flash = `摸到 ${describeCard(card)}（无法出），跳过这一轮`;
    say(next, `${next.players[playerIndex].name} 摸了一张，无法出，跳过`);
    next.turn = nextTurn(next);
  }
  return next;
}

/** 主动摸牌后选择不出，直接结束回合（仅当 drewCard 存在时有效）。 */
export function passTurn(state, playerIndex) {
  if (state.phase !== 'playing' || state.turn !== playerIndex) return reject(state, '现在还没轮到你');
  if (!state.drewCard) return reject(state, '现在不需要过');
  const next = clone(state);
  next.drewCard = null;
  next.flash = `${next.players[playerIndex].name} 选择跳过`;
  say(next, `${next.players[playerIndex].name} 摸牌后选择跳过`);
  next.turn = nextTurn(next);
  return next;
}

/** 开下一局，保留累计分数与胜负判定方式。 */
export function nextRound(state, seed = state.rngState) {
  const fresh = createGame({ playerCount: state.players.length, seed, winCondition: state.winCondition });
  fresh.scores = state.scores.slice();
  fresh.round = state.round + 1;
  return fresh;
}

/**
 * 本局名次表：返回按「第 1 名 → 最后一名」排列的席位下标数组。
 *  - 淘汰制：按出完顺序，最后留在手上的人垫底。
 *  - 标准制：冠军固定第 1，其余按累计分数降序（同分按席位序）。
 * 同时兼容服务端完整 state 与前端投影 view（后者用 seats 代替 players）。
 * 战绩入库、结算名次表共用这一份口径，避免两处各算一套。
 */
export function rankingOf(state) {
  const count = (state.players || state.seats || []).length;
  if (!count) return [];
  const order = (state.finishedOrder || []).slice();
  if (state.winCondition === 'elimination' && order.length) {
    const last = state.loser != null && state.loser >= 0 ? state.loser : -1;
    return last >= 0 ? [...order, last] : order;
  }
  return Array.from({ length: count }, (_, index) => index).sort((a, b) => {
    if (a === state.winner) return -1;
    if (b === state.winner) return 1;
    return (state.scores?.[b] || 0) - (state.scores?.[a] || 0) || a - b;
  });
}

export function statusText(state) {
  if (state.phase === 'over') {
    if (state.winCondition === 'elimination' && state.loser != null) {
      return `淘汰赛结束：${state.players[state.winner].name} 夺冠，${state.players[state.loser].name} 垫底`;
    }
    return `${state.players[state.winner].name} 赢下这一局`;
  }
  if (state.phase === 'choosing') return '请选择颜色';
  if (state.drewCard) {
    const card = state.players[state.turn].hand.find((item) => item.id === state.drewCard);
    if (card) return `${state.players[state.turn].name} 摸到 ${describeCard(card)}，可出掉或选择「过」`;
  }
  if (state.pendingChallenge && state.pendingChallenge.target === state.turn) return `${state.players[state.turn].name} 可质疑上一张 +4`;
  if (state.pendingDraw > 0) return `${state.players[state.turn].name} 需抽 ${state.pendingDraw} 张`;
  // 淘汰制进行中：默认轮次提示附带「还剩几人在场」，不影响上面的摸牌/质疑/罚牌提示。
  if (state.winCondition === 'elimination' && state.finishedOrder.length > 0) {
    const remaining = state.players.filter((p) => !p.finished).length;
    return `淘汰赛 · 剩 ${remaining} 人在场 · 轮到 ${state.players[state.turn].name}`;
  }
  return `轮到 ${state.players[state.turn].name}`;
}
