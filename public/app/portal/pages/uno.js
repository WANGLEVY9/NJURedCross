/* ==========================================================================
   南小红 UNO —— 平台内建桌游（牌桌式界面）
   两种模式共用同一套渲染：
     · 人机练习：本地跑 engine.js，三位电脑对手
     · 联机房间：状态来自服务端投影，engine.js 在服务端做权威判定
   渲染层只吃统一的 view 对象，不直接接触完整 state（联机时看不到别人手牌）。
   ========================================================================== */
import { h } from '../../core/dom.js';
import { assetUrl } from '../../core/asset-url.js';
import {
  createGame, nextRound, playCard, chooseColor, drawCard, passTurn, callUno, legalMoves,
  topCard, cardImage, describeCard, scoreHand, statusText, rankingOf,
  canChallenge, challengeCard,
  COLORS, COLOR_LABELS, COLOR_NAMES,
} from '../../games/uno/engine.js';
import { chooseAiMove } from '../../games/uno/ai.js';
import { UnoClient } from '../../games/uno/client.js';

/** 按需加载 UNO 样式：只在进入牌桌页时插入，其他页面不加载、不影响性能。 */
function ensureUnoStyles() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('link[data-uno-style]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = assetUrl('/styles/uno.css');
  link.dataset.unoStyle = '1';
  document.head.append(link);
}

const BACK_IMAGE = assetUrl('/assets/uno/back.webp');
const AI_DELAY = 680;

/** 四张原创 Q 版头像；按席位去重分配，发言气泡从本人头像弹出。 */
const AVATARS = ['xiaohong', 'xiaonan', 'xiaosuhe', 'gege'];
const AVATAR_BY_NAME = [
  [/格格/, 'gege'],
  [/小红/, 'xiaohong'],
  [/小南/, 'xiaonan'],
  [/苏荷/, 'xiaosuhe'],
];
const avatarImage = (key) => assetUrl(`/assets/uno/avatar-${key}.webp`);

/** 名字能对上角色就用角色头像，其余按席位补一个尚未占用的，保证同桌四人各不相同。 */
function avatarKeysFor(seats) {
  const used = new Set();
  return (seats || []).map((entry, index) => {
    const matched = AVATAR_BY_NAME.find(([re]) => re.test(entry?.name || ''))?.[1];
    const key = (matched && !used.has(matched))
      ? matched
      : (AVATARS.find((item) => !used.has(item)) || AVATARS[index % AVATARS.length]);
    used.add(key);
    return key;
  });
}

const colorSwatch = (color) => h('span', {
  class: `uno-swatch uno-swatch--${color}`,
  attrs: { 'aria-hidden': 'true' },
});

/** 统一视图：人机模式把完整 state 折成与联机投影同构的对象。 */
function localView(state) {
  const myTurn = state.turn === 0 && state.phase !== 'over';
  return {
    mode: 'local',
    roomId: null,
    seat: 0,
    phase: state.phase === 'over' ? 'over' : 'playing',
    hostSeat: 0,
    seats: state.players.map((player, index) => ({
      name: player.name,
      kind: player.isHuman ? 'human' : 'ai',
      connected: true,
      auto: false,
      handCount: player.hand.length,
      saidUno: player.saidUno,
      finished: Boolean(player.finished),
      score: state.scores[index],
      isHost: index === 0,
    })),
    round: state.round,
    scores: state.scores.slice(),
    turn: state.turn,
    direction: state.direction,
    currentColor: state.currentColor,
    pendingDraw: state.pendingDraw,
    drawPileCount: state.drawPile.length,
    discardCount: state.discardPile.length,
    top: topCard(state),
    secondTop: state.discardPile.length > 1 ? state.discardPile[state.discardPile.length - 2] : null,
    status: statusText(state),
    log: state.log.slice(-6),
    flash: state.flash || '',
    winner: state.winner,
    loser: state.loser,
    finishedOrder: state.finishedOrder.slice(),
    winCondition: state.winCondition,
    selfHand: state.players[0].hand.slice(),
    legal: myTurn ? legalMoves(state, 0) : [],
    myTurn,
    selfSaidUno: Boolean(state.players[0].saidUno),
    drewCard: state.drewCard || null,
    needColor: state.phase === 'choosing' && myTurn,
    canChallenge: canChallenge(state, 0),
    challengeColor: state.pendingChallenge?.color || null,
    messages: [],
    version: state.discardPile.length + state.drawPile.length,
  };
}

/** 刚创建/加入房间、还没收到首帧推送时的占位视图。 */
function emptyRoomView(session) {
  return {
    mode: 'online',
    roomId: session.roomId,
    seat: session.seat,
    hostSeat: 0,
    phase: 'lobby',
    seats: Array.from({ length: session.seat + 1 }, (_, index) => ({
      name: index === session.seat ? session.name : '同学',
      kind: 'human', connected: true, auto: false,
      handCount: 0, saidUno: false, score: 0, isHost: index === 0,
    })),
    selfHand: [], legal: [], log: [], flash: '', status: '等待玩家加入',
    myTurn: false, needColor: false, scores: [], round: 1,
    selfSaidUno: false,
    top: null, secondTop: null, currentColor: null, pendingDraw: 0,
    drawPileCount: 0, discardCount: 0, direction: 1, turn: 0,
    drewCard: null, messages: [],
    canStart: false, canAddAi: true, version: 0,
    winCondition: 'first',
  };
}

/** 相对自己的座位方位：下家在左，对家在上，上家在右（四人局）。 */
function seatPosition(count, me, index) {
  const rel = (index - me + count) % count;
  if (rel === 0) return 'bottom';
  if (count === 2) return 'top';
  if (count === 3) return rel === 1 ? 'left' : 'right';
  return rel === 1 ? 'left' : rel === 2 ? 'top' : 'right';
}

export default function page() {
  ensureUnoStyles();
  let mode = 'local';
  let localWinCondition = 'first';
  let state = createGame({ playerCount: 4, seed: Date.now(), winCondition: localWinCondition });
  let view = localView(state);
  let timer = null;
  let disposed = false;
  let modal = null;                 // 'color' | 'rules' | null
  let lobbyError = '';
  let busy = false;
  let nameDraft = '';
  let codeDraft = '';
  let copyHint = '';
  let chatDraft = '';
  // 牌桌浮层聊天：气泡锚定发言者席位 + 顶部飘屏弹幕。人机模式也能发本地弹幕。
  let floatingChatOn = true;
  let localMessages = [];
  let localSerial = 0;
  // 浮层节点常驻：每次渲染只是被移动到新的 .uno-board 里，气泡/弹幕动画不会被打断。
  const floatingLayer = h('div', { class: 'uno-bubbles', attrs: { 'aria-hidden': 'true' } });
  let danmakuTrack = 0;
  let seenRoomKey = null;
  let seenMessageIds = new Set();
  let avatarKeys = [];
  const client = new UnoClient({
    onState: (next) => { view = { ...next, mode: 'online' }; render(); },
    onError: (message) => { lobbyError = message; render(); },
  });

  // 动画变化检测：只有真正新增/变化的牌才播动画，避免每次刷新全量重播。
  let lastTopId = view.top?.id || null;
  let lastHandIds = new Set(view.selfHand.map((card) => card.id));
  let lastRound = view.round;
  let dealing = false;

  const root = h('div', { class: 'view uno-page' });

  // ---- 牌桌聊天气泡 / 弹幕 ---------------------------------------------
  // 浮层是常驻节点，被 boardNode() 挂进 .uno-board（position:relative），
  // 因此坐标一律相对牌桌：气泡从发言者头像弹出、弹幕只在牌桌内横向飘过。
  function currentMessages() {
    return mode === 'local' ? localMessages : (view.messages || []);
  }

  /** 一条新消息 → 该席位头像旁冒气泡 + 牌桌内飘一条弹幕。 */
  function spawnMessage(msg) {
    const layer = floatingLayer;
    const board = root.querySelector('.uno-board');
    const avatar = root.querySelector(`.uno-seat__avatar[data-uno-seat="${Number(msg.seat) || 0}"]`);
    const boardRect = board?.getBoundingClientRect();
    const aRect = avatar?.getBoundingClientRect();
    const bw = Math.round(boardRect?.width || 900);
    const bh = Math.round(boardRect?.height || 320);
    const width = 214;
    const anchorX = aRect && boardRect
      ? aRect.left - boardRect.left + aRect.width / 2 : bw / 2;
    const anchorY = aRect && boardRect ? aRect.top - boardRect.top : bh * 0.3;
    const x = Math.round(Math.max(8, Math.min(bw - width - 8, anchorX - width / 2)));
    // 上方席位（对家）气泡往下弹，其余席位往上弹，避免溢出牌桌。
    const pos = avatar?.dataset?.unoPos;
    const rawY = pos === 'top'
      ? anchorY + (aRect?.height || 34) + 6
      : anchorY - 76;
    const y = Math.round(Math.max(6, Math.min(bh - 82, rawY)));
    const key = avatarKeys[Number(msg.seat) || 0] || AVATARS[0];
    const bubble = h('div', {
      class: `uno-bubble ${msg.seat === view.seat ? 'is-me' : ''}`,
      vars: { 'uno-bx': `${x}px`, 'uno-by': `${y}px` },
    },
    h('img', { class: 'uno-bubble__avatar', src: avatarImage(key), alt: '', attrs: { decoding: 'async' } }),
    h('div', { class: 'uno-bubble__body' },
      h('span', { class: 'uno-bubble__name', text: msg.name }),
      h('span', { class: 'uno-bubble__text', text: msg.text })));
    layer.append(bubble);
    window.setTimeout(() => bubble.remove(), 4800);

    const danmaku = h('div', {
      class: `uno-danmaku ${msg.seat === view.seat ? 'is-me' : ''}`,
      vars: {
        'uno-track': `${8 + (danmakuTrack++ % 3) * 30}px`,
        'uno-span': `${bw + 260}px`,
      },
    },
    h('img', { class: 'uno-danmaku__avatar', src: avatarImage(key), alt: '', attrs: { decoding: 'async' } }),
    h('span', { class: 'uno-danmaku__name', text: msg.name }),
    h('span', { class: 'uno-danmaku__text', text: msg.text }));
    layer.append(danmaku);
    window.setTimeout(() => danmaku.remove(), 10800);
  }

  /** 只弹「本次会话新出现」的消息；连上房间时的历史消息不刷屏。 */
  function noticeMessages(active) {
    const list = currentMessages();
    const key = mode === 'local' ? 'local' : (view.roomId || 'online');
    if (key !== seenRoomKey) {
      seenRoomKey = key;
      seenMessageIds = new Set(list.map((msg) => msg.id));
      return;
    }
    for (const msg of list) {
      if (msg.id && !seenMessageIds.has(msg.id) && active && floatingChatOn) spawnMessage(msg);
    }
    seenMessageIds = new Set(list.map((msg) => msg.id));
  }

  function clearTimer() {
    if (timer) window.clearTimeout(timer);
    timer = null;
  }

  function isOnlinePlaying() {
    return mode === 'online' && client.joined && view.phase !== 'lobby' && view.seats?.length;
  }

  /** 电脑回合串行推进（仅人机模式）。 */
  function scheduleAi() {
    clearTimer();
    if (disposed || mode !== 'local' || state.phase !== 'playing' || state.players[state.turn].isHuman) return;
    timer = window.setTimeout(() => {
      if (disposed || mode !== 'local') return;
      const index = state.turn;
      const move = chooseAiMove(state, index);
      if (move.type === 'uno') state = callUno(state, index);
      else if (move.type === 'play') state = playCard(state, index, move.cardId, move.chosenColor);
      else if (move.type === 'pass') state = passTurn(state, index);
      else state = drawCard(state, index);
      commitLocal(state);
    }, AI_DELAY);
  }

  function commitLocal(next) {
    state = next;
    view = localView(state);
    if (state.phase === 'choosing') modal = 'color';
    else if (modal === 'color') modal = null;
    render();
    scheduleAi();
  }

  function newLocalRound() {
    clearTimer();
    modal = null;
    state = nextRound(state, Date.now());
    lastHandIds = new Set();
    dealing = true;
    commitLocal(state);
  }

  /** 人机模式切换胜负判定：重开一局（规则改变只能在新局生效）。 */
  function localSetWinCondition(value) {
    if (value === localWinCondition) return;
    localWinCondition = value;
    state = createGame({ playerCount: 4, seed: Date.now(), winCondition: value });
    lastHandIds = new Set();
    dealing = true;
    commitLocal(state);
  }

  const WIN_CONDITIONS = [
    { value: 'first', label: '有人先出完即结束' },
    { value: 'elimination', label: '玩到倒数第二位出完' },
  ];
  /** 胜负判定选择器；onChange 仅在允许改时传入，disabled 时整组不可点。 */
  function ruleSelector(value, { onChange = null, disabled = false } = {}) {
    return h('div', { class: 'uno-rule', attrs: { role: 'group', 'aria-label': '胜负判定方式' } },
      h('span', { class: 'uno-rule__label', text: '胜负判定' }),
      ...WIN_CONDITIONS.map((opt) => h('button', {
        class: `uno-rule__opt ${value === opt.value ? 'is-active' : ''}`,
        type: 'button',
        disabled: disabled || value === opt.value, // 整组禁用或已选中项不必再点
        attrs: { 'aria-pressed': value === opt.value ? 'true' : 'false' },
        text: opt.label,
        on: { click: () => { if (onChange && !disabled && value !== opt.value) onChange(opt.value); } },
      })));
  }

  function send(type, extra) {
    if (busy) return;
    busy = true;
    lobbyError = '';
    render();
    void client.action(type, extra).finally(() => {
      busy = false;
      if (!disposed) render();
    });
  }

  function switchMode(next) {
    if (next === mode) return;
    clearTimer();
    modal = null;
    lobbyError = '';
    copyHint = '';
    floatingLayer.replaceChildren();   // 切模式不带走上一桌的残留气泡
    if (next === 'local') {
      client.disconnect();
      mode = 'local';
      view = localView(state);
      lastHandIds = new Set(view.selfHand.map((card) => card.id));
      lastTopId = view.top?.id || null;
      dealing = true;
      render();
      scheduleAi();
    } else {
      mode = 'online';
      render();
      if (client.joined) client.connect();
    }
  }

  // ---- 卡牌节点 ---------------------------------------------------------
  function cardNode(card, { playable = false, onClick = null, extra = '', index = 0, eager = false } = {}) {
    const image = h('img', {
      class: 'uno-card__img',
      src: cardImage(card),
      alt: describeCard(card),
      // 手牌在首屏必须立即可见，不能等懒加载判定。
      attrs: { loading: eager ? 'eager' : 'lazy', decoding: 'async', draggable: 'false' },
    });
    // 麻将式平铺：只保留 --uno-i（发牌动画延迟 + 从左到右的叠压层级），
    // 不再写扇形旋转/弧线。牌与牌底部对齐、连成一整条牌墙。
    // 动态值仍走 h() 的 vars 通道（style.setProperty），不写内联 style，符合 CSP。
    const styleVars = index ? { 'uno-i': String(index) } : null;
    const classes = ['uno-card', `uno-card--${card.kind}`, extra].filter(Boolean).join(' ');
    if (!onClick) {
      return h('div', {
        class: classes,
        vars: styleVars,
        attrs: { title: describeCard(card) },
      }, image);
    }
    return h('button', {
      class: `${classes} uno-card--button ${playable ? 'is-playable' : 'is-locked'}`,
      type: 'button',
      disabled: !playable,
      vars: styleVars,
      attrs: {
        'aria-label': `${describeCard(card)}${playable ? '，可以打出' : '，现在不能打出'}`,
        title: describeCard(card),
      },
      on: { click: onClick },
    }, image);
  }

  function backFan(count) {
    const shown = Math.min(count, 7);
    return h('div', { class: 'uno-seat__backs', attrs: { 'aria-hidden': 'true' } },
      ...Array.from({ length: shown }, (_, index) => h('img', {
        class: 'uno-back', src: BACK_IMAGE, alt: '',
        vars: { 'uno-i': String(index) },
        attrs: { loading: 'lazy', decoding: 'async', draggable: 'false' },
      })));
  }

  // ---- 牌桌 -------------------------------------------------------------
  function seatNode(entry, index, position) {
    const isTurn = view.turn === index && view.phase === 'playing';
    const isMe = index === view.seat;
    const isElim = view.winCondition === 'elimination';
    const rank = isElim && entry.finished
      ? (view.finishedOrder || []).indexOf(index) + 1 : 0;
    const isLoser = isElim && view.phase === 'over' && index === view.loser;
    const badges = [
      entry.kind === 'ai' ? h('span', { class: 'uno-tag uno-tag--ai', text: '电脑' }) : null,
      entry.auto ? h('span', { class: 'uno-tag uno-tag--auto', text: '托管' }) : null,
      !entry.connected && entry.kind === 'human' && !isMe
        ? h('span', { class: 'uno-tag uno-tag--off', text: '离线' }) : null,
      entry.isHost ? h('span', { class: 'uno-tag uno-tag--host', text: '房主' }) : null,
      entry.saidUno ? h('span', { class: 'uno-uno', text: 'UNO!' }) : null,
      entry.finished && rank > 0
        ? h('span', { class: 'uno-tag uno-tag--out', text: `已出完 · 第 ${rank} 名` }) : null,
      isLoser ? h('span', { class: 'uno-tag uno-tag--loser', text: '垫底' }) : null,
    ].filter(Boolean);
    return h('div', {
      class: `uno-seat uno-seat--${position} ${isTurn ? 'is-active' : ''} ${isMe ? 'is-me' : ''} ${entry.finished ? 'is-out' : ''} ${isLoser ? 'is-loser' : ''}`,
    },
    // 头像独立成一块圆角正方形，名字/徽标只是一条透明信息带，不再把头像混进胶囊。
    h('div', { class: 'uno-seat__identity' },
      h('img', {
        class: 'uno-seat__avatar',
        src: avatarImage(avatarKeys[index] || AVATARS[0]),
        alt: `${entry.name} 的头像`,
        data: { unoSeat: String(index), unoPos: position },
        attrs: { decoding: 'async', draggable: 'false' },
      }),
      h('div', { class: 'uno-seat__plate' },
        h('span', { class: 'uno-seat__name', text: entry.name }),
        ...badges,
        h('span', { class: 'uno-seat__count', text: `${entry.handCount} 张` }))),
    isMe ? null : backFan(entry.handCount),
    h('span', { class: 'uno-seat__score', text: `累计 ${entry.score} 分` }));
  }

  function boardNode() {
    const canDraw = Boolean(view.myTurn) && !view.needColor && view.phase === 'playing' && !view.drewCard;
    const drawPile = h('button', {
      class: 'uno-pile uno-pile--draw',
      type: 'button',
      disabled: !canDraw,
      attrs: { 'aria-label': `抽牌堆，${canDraw ? '点击抽牌' : '现在不能抽'}` },
      on: {
        click: () => {
          if (!canDraw) return;
          if (mode === 'local') commitLocal(drawCard(state, 0));
          else send('draw');
        },
      },
    },
    h('span', { class: 'uno-pile__stack', attrs: { 'aria-hidden': 'true' } },
      ...Array.from({ length: 3 }, () => h('img', { class: 'uno-pile__ghost', src: BACK_IMAGE, alt: '', attrs: { decoding: 'async' } }))),
    h('img', { class: 'uno-pile__img', src: BACK_IMAGE, alt: '', attrs: { decoding: 'async' } }),
    h('span', { class: 'uno-pile__label', text: `抽牌 · ${view.drawPileCount} 张` }));

    const top = view.top;
    const topChanged = top && top.id !== lastTopId;
    const discard = h('div', { class: 'uno-pile uno-pile--discard' },
      h('div', { class: 'uno-pile__stack', attrs: { 'aria-hidden': 'true' } },
        ...Array.from({ length: Math.min(3, Math.max(1, view.discardCount - 1)) }, () =>
          h('img', { class: 'uno-pile__ghost', src: BACK_IMAGE, alt: '', attrs: { decoding: 'async' } }))),
      top ? cardNode(top, { extra: topChanged ? 'is-dealt' : '' }) : null,
      h('span', { class: 'uno-pile__label', text: '出牌堆' }));

    const center = h('div', { class: 'uno-center' },
      h('div', { class: 'uno-center__piles' }, drawPile, discard),
      h('div', { class: 'uno-center__meta' },
        h('span', { class: 'uno-center__color', text: '当前颜色' },
          view.currentColor ? colorSwatch(view.currentColor) : h('span', { text: '—' }),
          h('span', { text: view.currentColor ? COLOR_LABELS[view.currentColor] : '' })),
        h('span', {
          class: `uno-center__dir ${view.direction === 1 ? '' : 'is-reverse'}`,
          attrs: { 'aria-hidden': 'true' },
        }, h('span', { text: '↻' })),
        h('span', { text: `第 ${view.round} 局` })),
      top ? h('span', { class: 'uno-center__top-name', text: describeCard(top) }) : null);

    const seats = (view.seats || []).map((entry, index) =>
      seatNode(entry, index, seatPosition(view.seats.length, view.seat, index)));
    return h('section', { class: 'uno-board', attrs: { 'aria-label': '牌桌' } },
      h('div', { class: 'uno-board__felt' },
        ...seats,
        center,
        // 第十版：手牌与操作按钮都直接落在绿色台面上（felt 的 grid 单元），
        // 自己的席位挪到左下角，中间不再有「姓名区」和牌堆抢位置。
        handNode(),
        actionsNode()),
      // 麻将手游式角落信息区：左上角聊天记录、右上角出牌记录。
      // 两块面板绝对定位压在台面上，不占牌桌高度、不打断首屏同屏。
      chatNode(true),
      logPanel(),
      floatingLayer);
  }

  /** 右上角出牌记录：直接沿用引擎 state.log / 服务端投影，最新一条在最上。 */
  function logPanel() {
    const lines = (view.log || []).slice(-6).reverse();
    return h('aside', { class: 'uno-boardlog', attrs: { 'aria-label': '出牌记录' } },
      h('h2', { class: 'uno-boardlog__title', text: '出牌记录' }),
      h('ol', { class: 'uno-boardlog__list' },
        ...lines.map((line, i) => h('li', {
          class: `uno-boardlog__line ${i === 0 ? 'is-latest' : ''}`,
          text: line,
        }))),
      lines.length ? null : h('p', { class: 'uno-boardlog__empty', text: '等待第一手牌…' }));
  }

  // ---- 手牌 -------------------------------------------------------------
  function handNode() {
    const legal = new Set(view.legal || []);
    const hand = view.selfHand || [];
    const myTurn = Boolean(view.myTurn) && view.phase === 'playing';
    const isDealing = dealing && lastRound !== view.round;
    const newIds = new Set(hand.map((card) => card.id).filter((id) => !lastHandIds.has(id)));
    // 第十版：手牌直接铺在绿色台面上，一整排紧挨着、不互相压叠，
    // 去掉重叠阴影；index 只用于发牌动画延迟。
    const cards = hand.map((card, index) => {
      const extra = [
        isDealing ? 'is-dealing' : '',
        newIds.has(card.id) ? 'is-new' : '',
        card.id === view.drewCard ? 'is-drawn' : '',
      ].filter(Boolean).join(' ');
      return cardNode(card, {
        playable: myTurn && legal.has(card.id) && !view.needColor,
        index: index + 1,
        extra,
        eager: true,
        onClick: () => {
          if (!(myTurn && legal.has(card.id)) || view.needColor) return;
          if (mode === 'local') commitLocal(playCard(state, 0, card.id));
          else send('play', { cardId: card.id });
        },
      });
    });
    // 第十版：手牌区只放牌墙 + 张数，操作按钮全部收到右下角 actionsNode()。
    return h('section', { class: `uno-hand uno-hand--table ${myTurn ? 'is-my-turn' : ''}` },
      h('div', { class: 'uno-hand__head' },
        h('h2', { text: `你的手牌 · ${hand.length} 张` })),
      h('div', { class: 'uno-hand__cards' }, ...cards));
  }

  /** 第十版：抽牌 / 过 / 喊 UNO / 质疑统一放在牌桌右下角。 */
  function actionsNode() {
    const hand = view.selfHand || [];
    const myTurn = Boolean(view.myTurn) && view.phase === 'playing';
    const needUno = myTurn && hand.length === 2 && !view.selfSaidUno;
    const hint = needUno
      ? '还剩 2 张：先喊 UNO!'
      : view.needColor ? '先选一个颜色'
        : myTurn
          ? (view.drewCard
              ? '摸到可出的牌：出掉或过'
              : ((view.legal || []).length ? '点亮的牌可以打出' : '没有可出的牌，去抽一张'))
          : '等待其他玩家出牌';
    const unoButton = needUno
      ? h('button', {
        class: 'uno-btn uno-btn--small uno-btn--uno',
        type: 'button',
        text: '喊 UNO!',
        disabled: busy,
        attrs: { 'aria-label': '喊 UNO，避免出到剩一张时罚抽两张' },
        on: {
          click: () => {
            if (busy) return;
            if (mode === 'local') commitLocal(callUno(state, 0));
            else send('uno');
          },
        },
      })
      : (view.selfSaidUno && hand.length <= 2
        ? h('span', { class: 'uno-uno-called', text: 'UNO! 已喊' })
        : null);
    const drawButton = view.drewCard
      ? h('button', {
        class: 'uno-btn uno-btn--small uno-btn--pass',
        type: 'button',
        text: '过',
        disabled: busy,
        attrs: { 'aria-label': '不出这张，结束回合' },
        on: {
          click: () => {
            if (busy) return;
            if (mode === 'local') commitLocal(passTurn(state, 0));
            else send('pass');
          },
        },
      })
      : h('button', {
        class: 'uno-btn uno-btn--small uno-btn--draw',
        type: 'button',
        text: view.pendingDraw > 0 ? `抽 ${view.pendingDraw} 张` : '抽一张',
        disabled: !(myTurn && !view.needColor),
        attrs: { 'aria-label': '摸一张牌' },
        on: {
          click: () => {
            if (!(myTurn && !view.needColor)) return;
            if (mode === 'local') commitLocal(drawCard(state, 0));
            else send('draw');
          },
        },
      });
    return h('div', { class: 'uno-actions', attrs: { 'aria-label': '本回合操作' } },
      h('span', { class: `uno-actions__hint ${needUno ? 'is-warning' : ''}`, text: hint }),
      h('div', { class: 'uno-actions__buttons' },
        unoButton,
        drawButton,
        view.canChallenge ? h('button', {
          class: 'uno-btn uno-btn--small uno-btn--challenge',
          type: 'button',
          text: '质疑 +4',
          disabled: busy,
          on: {
            click: () => {
              if (mode === 'local') commitLocal(challengeCard(state, 0));
              else send('challenge');
            },
          },
        }) : null));
  }

  // ---- 联机大厅 ---------------------------------------------------------
  function lobbyNode() {
    if (!client.joined) {
      let nameInput;
      let codeInput;
      return h('section', { class: 'uno-lobby' },
        h('div', { class: 'uno-lobby__intro' },
          h('h2', { text: '开一桌牌' }),
          h('p', { text: '创建房间后把 4 位房间码发给同学，或用房间码加入别人的桌。2–4 人，人数不够可以让电脑补位。' })),
        h('div', { class: 'uno-lobby__form' },
          h('label', { class: 'uno-field' },
            h('span', { text: '你的昵称' }),
            h('input', {
              class: 'uno-input', type: 'text', value: nameDraft,
              attrs: { maxlength: '12', placeholder: '例如：金大夫', 'aria-label': '昵称' },
              ref: (node) => { nameInput = node; },
              on: { input: (event) => { nameDraft = event.target.value; } },
            })),
          h('div', { class: 'uno-lobby__actions' },
            h('button', {
              class: 'uno-btn uno-btn--primary', type: 'button', text: busy ? '请稍候…' : '创建房间',
              disabled: busy,
              on: {
                click: () => {
                  const name = (nameInput?.value || nameDraft || '').trim();
                  busy = true; lobbyError = ''; render();
                  void client.create(name).then((session) => {
                    view = emptyRoomView(session);
                    lastHandIds = new Set();
                    busy = false; lobbyError = ''; render(); client.connect();
                  }).catch((error) => { busy = false; lobbyError = error.message; render(); });
                },
              },
            }))),
        h('div', { class: 'uno-lobby__form uno-lobby__form--join' },
          h('label', { class: 'uno-field' },
            h('span', { text: '房间码' }),
            h('input', {
              class: 'uno-input uno-input--code', type: 'text', value: codeDraft,
              attrs: { maxlength: '4', placeholder: 'ABCD', 'aria-label': '房间码' },
              ref: (node) => { codeInput = node; },
              on: { input: (event) => { codeDraft = event.target.value.toUpperCase(); } },
            })),
          h('div', { class: 'uno-lobby__actions' },
            h('button', {
              class: 'uno-btn', type: 'button', text: busy ? '请稍候…' : '加入房间',
              disabled: busy,
              on: {
                click: () => {
                  const name = (nameInput?.value || nameDraft || '').trim();
                  const code = (codeInput?.value || codeDraft || '').trim();
                  busy = true; lobbyError = ''; render();
                  void client.join(code, name).then((session) => {
                    view = emptyRoomView(session);
                    lastHandIds = new Set();
                    busy = false; lobbyError = ''; render(); client.connect();
                  }).catch((error) => { busy = false; lobbyError = error.message; render(); });
                },
              },
            }))),
        lobbyError ? h('p', { class: 'uno-lobby__error', attrs: { role: 'alert' }, text: lobbyError }) : null,
        h('button', {
          class: 'uno-lobby__back', type: 'button', text: '← 返回人机练习',
          on: { click: () => switchMode('local') },
        }));
    }

    const isHost = view.seat === view.hostSeat;
    const isLobby = view.phase === 'lobby';
    const roomUrl = `${window.location.origin}/games/uno?room=${view.roomId}`;
    return h('section', { class: 'uno-lobby uno-lobby--waiting' },
      h('div', { class: 'uno-room-code' },
        h('div', { class: 'uno-room-code__label', text: '房间码 · 发给同学即可加入' }),
        h('div', { class: 'uno-room-code__value', text: view.roomId || '----' }),
        h('div', { class: 'uno-room-code__actions' },
          h('button', {
            class: 'uno-btn uno-btn--small', type: 'button', text: '复制邀请链接',
            on: {
              click: () => {
                void navigator.clipboard?.writeText(roomUrl).then(() => {
                  copyHint = '链接已复制'; render();
                }).catch(() => { copyHint = `手动复制：${roomUrl}`; render(); });
              },
            },
          }),
          h('button', {
            class: 'uno-btn uno-btn--small', type: 'button', text: '退出房间',
            on: { click: () => { client.leave(); view = { ...view, phase: 'lobby', seats: [] }; lobbyError = ''; render(); } },
          }))),
      copyHint ? h('p', { class: 'uno-lobby__hint', text: copyHint }) : null,
      isLobby
        ? h('div', { class: 'uno-waiting' },
          h('h2', { text: `等待玩家加入 · ${view.seats?.length || 0}/4` }),
          h('div', { class: 'uno-waiting__seats' },
            ...(view.seats || []).map((entry, index) => h('div', { class: 'uno-waiting__seat' },
              h('img', {
                class: 'uno-waiting__avatar',
                src: avatarImage(avatarKeys[index] || AVATARS[0]),
                alt: '', attrs: { decoding: 'async' },
              }),
              h('span', { text: entry.name }),
              entry.kind === 'ai' ? h('span', { class: 'uno-tag uno-tag--ai', text: '电脑' }) : null,
              index === view.hostSeat ? h('span', { class: 'uno-tag uno-tag--host', text: '房主' }) : null)),
            ...Array.from({ length: Math.max(0, 4 - (view.seats?.length || 0)) }, () =>
              h('div', { class: 'uno-waiting__seat is-empty' }, h('span', { text: '空位' })))),
          h('div', { class: 'uno-waiting__rule' },
            isHost
              ? ruleSelector(view.winCondition || 'first', {
                onChange: (value) => send('rule', { winCondition: value }),
                disabled: busy,
              })
              : h('p', { class: 'uno-lobby__hint', text: `胜负判定：${view.winCondition === 'elimination' ? '玩到倒数第二位出完' : '有人先出完即结束'}（房主设定）` })),
          isHost
            ? h('div', { class: 'uno-waiting__actions' },
              h('button', {
                class: 'uno-btn', type: 'button', text: '＋ 添加电脑',
                disabled: busy || !view.canAddAi,
                on: { click: () => send('addAi') },
              }),
              h('button', {
                class: 'uno-btn', type: 'button', text: '－ 移除电脑',
                disabled: busy || !(view.seats?.length > 1 && view.seats[view.seats.length - 1]?.kind === 'ai'),
                on: { click: () => send('removeAi') },
              }),
              h('button', {
                class: 'uno-btn uno-btn--primary', type: 'button', text: '开始游戏',
                disabled: busy || !view.canStart,
                on: { click: () => send('start') },
              }))
            : h('p', { class: 'uno-lobby__hint', text: '等房主开局…' }))
        : null,
      lobbyError ? h('p', { class: 'uno-lobby__error', attrs: { role: 'alert' }, text: lobbyError }) : null);
  }

  // ---- 弹窗 -------------------------------------------------------------
  function colorModal() {
    const choices = COLORS.map((color) => h('button', {
      class: `uno-color-choice uno-swatch--${color}`,
      type: 'button',
      attrs: { 'aria-label': `选择${COLOR_LABELS[color]}色` },
      on: {
        click: () => {
          if (mode === 'local') { modal = null; commitLocal(chooseColor(state, color)); }
          else send('color', { color }); // 联机由服务端 needColor 决定弹窗显隐，避免重复弹出
        },
      },
    }, colorSwatch(color), h('span', { text: COLOR_NAMES[color] })));
    return h('div', {
      class: 'uno-modal',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': '选择颜色' },
    }, h('div', { class: 'uno-modal__panel uno-modal__panel--color' },
      h('h2', { class: 'uno-modal__title', text: '接下来跟什么颜色？' }),
      h('p', { class: 'uno-modal__hint', text: '打出变色 / 加四后，由你指定下一位必须跟的颜色。' }),
      h('div', { class: 'uno-colors' }, ...choices)));
  }

  function rulesModal() {
    const lines = [
      '牌组为标准 108 张：四色 0–9、每色加二 / 禁止 / 反转各两张，另有变色与加四各四张。',
      '只能打出与底牌同色、同数字或同类型的牌；变色与加四随时可出，打出后由出牌者指定颜色。',
      '加二让下家罚抽 2 张并跳过、加四罚抽 4 张并跳过；禁止跳过一位；反转改变出牌方向（两人局按禁止处理）。',
      '手里剩两张、即将打出倒数第二张时，要先点手牌区的「喊 UNO!」；忘了喊就出到剩一张，会立刻罚抽 2 张（电脑会自动喊）。出完牌按其他玩家剩余手牌计分（数字按面值、功能牌 20、万能牌 50）。',
      '联机模式由服务端判定，你看不到别人的手牌；断线 30 秒后该席位由电脑托管，重连即收回。房间数据只在内存，服务器重启即清空。',
      '罚牌可叠加：被 +2/+4 时，手里有 +2 可以继续叠（罚牌越叠越多）；+4 仅当手里没有当前色牌才能出，且下家可「质疑」——质疑成功罚出牌者自己抽牌，质疑失败罚质疑者抽 6 张。主动抽牌：若摸到能出的牌，可立即出掉，也可点「过」跳过；摸到的牌不能出则自动跳过。首张功能牌不触发效果。',
      '胜负判定可选（人机练习在牌桌上方切换，联机由房主在开局前设定）：①「有人先出完即结束」——标准玩法，第一位出完手牌者获胜；②「玩到倒数第二位出完」——淘汰赛，出完牌的人离桌、其余人继续，直到只剩最后一人（垫底）才结束，最先出完者夺冠。淘汰制下会给出完整名次表，并按名次记入联机战绩。',
      '淘汰制下出完牌的那一张功能牌照常结算：禁止会跳过一位、反转会改方向（只剩两人时按禁止处理）、加二 / 加四照常罚给在场下家；出牌者已离桌且手里只剩这一张万能牌，+4 必然合法，因此不再开质疑窗口。',
      '聊天记录与输入框已内置在牌桌左上角，出牌记录在右上角，都不必滚到页面底部查看；消息会从发言者的 Q 版头像旁冒出气泡，并沿牌桌顶部飘过弹幕（气泡与弹幕只在牌桌范围内显示）。可在「本局规则」条右侧一键关闭浮层。人机练习也能发本地弹幕自娱（只在本机显示、不联网、不留存）。',
      '全部牌面为南京大学红十字会学生分会「南小红」原创手绘，本游戏为非官方、非商业用途的内部娱乐功能。',
    ];
    return h('div', {
      class: 'uno-modal',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': '玩法说明' },
    }, h('div', { class: 'uno-modal__panel' },
      h('h2', { class: 'uno-modal__title', text: '玩法与规则口径' }),
      h('ul', { class: 'uno-rules' }, ...lines.map((line) => h('li', { text: line }))),
      h('button', {
        class: 'uno-btn uno-btn--primary', type: 'button', text: '知道了',
        on: { click: () => { modal = null; render(); } },
      })));
  }

  function resultNode() {
    if (view.phase !== 'over' || view.winner === null || view.winner === undefined) return null;
    const winner = view.seats[view.winner];
    const isMe = view.winner === view.seat;
    const isHost = view.seat === view.hostSeat;
    const isElim = view.winCondition === 'elimination';
    // 名次表与战绩入库共用 engine.rankingOf 的同一份口径；联机优先用服务端投影。
    const order = view.ranking?.length ? view.ranking : rankingOf(view);
    const ranking = order.map((seat, i) => ({ seat, rank: i + 1 }));
    const rankList = isElim && ranking.length
      ? h('ol', { class: 'uno-result__ranks' },
        ...ranking.map(({ seat, rank }) => h('li', {
          class: `uno-result__rank ${seat === view.seat ? 'is-me' : ''} ${seat === view.loser ? 'is-loser' : ''}`,
        },
        h('span', { class: 'uno-result__rank-no', text: `第 ${rank} 名` }),
        h('span', { text: view.seats[seat]?.name || '玩家' }),
        seat === view.winner ? h('span', { class: 'uno-tag uno-tag--out', text: '冠军' }) : null,
        seat === view.loser ? h('span', { class: 'uno-tag uno-tag--loser', text: '垫底' }) : null)))
      : null;
    return h('div', { class: 'uno-result', attrs: { role: 'status' } },
      h('div', { class: `uno-result__panel ${isElim ? 'uno-result__panel--elim' : ''}` },
        h('p', { class: 'uno-result__eyebrow', text: isMe ? '恭喜！' : `第 ${view.round} 局结束` }),
        h('h2', { text: isElim
          ? `淘汰赛结束 · ${winner?.name || '玩家'} 夺冠`
          : `${winner?.name || '玩家'} 出完了所有牌` }),
        h('p', { text: isElim
          ? '一直玩到只剩最后一人：最先出完者夺冠，最后留在手上的垫底。'
          : `${winner?.name || '玩家'} 累计 ${view.scores?.[view.winner] ?? 0} 分。计分只保存在当前对局，服务器重启即清零。` }),
        rankList,
        mode === 'local'
          ? h('button', {
            class: 'uno-btn uno-btn--primary', type: 'button', text: '再来一局',
            on: { click: newLocalRound },
          })
          : isHost
            ? h('button', {
              class: 'uno-btn uno-btn--primary', type: 'button', text: '再来一局',
              disabled: busy,
              on: { click: () => send('restart') },
            })
            : h('p', { class: 'uno-result__hint', text: '等房主开下一局…' })));
  }

  // ---- 聊天（牌桌内嵌输入 + 记录 + 头像气泡 / 弹幕）-----------------------
  let chatInputNode = null;

  /** 人机与联机共用的发送逻辑：本地只存内存，联机交给服务端广播。 */
  function submitChat(raw) {
    const text = String(raw || '').trim().slice(0, 200);
    if (!text) return;
    chatDraft = '';
    if (chatInputNode) chatInputNode.value = '';
    if (mode === 'local') {
      localMessages.push({
        id: `local-${localSerial += 1}`,
        seat: view.seat ?? 0,
        name: view.seats?.[view.seat ?? 0]?.name || '你',
        text,
        ts: Date.now(),
      });
      if (localMessages.length > 50) localMessages = localMessages.slice(-50);
    } else {
      void client.sendChat(text);
    }
    render();
  }

  /** docked=true 时作为牌桌左上角的角落面板（麻将式信息区）；大厅里仍是独立面板。 */
  function chatNode(docked = false) {
    const messages = currentMessages().slice(-50);
    const isLocal = mode === 'local';
    const list = h('div', { class: 'uno-chat__list', attrs: { 'aria-live': 'polite' } },
      ...messages.map((m) => h('div', { class: `uno-chat__msg ${m.seat === view.seat ? 'is-me' : ''}` },
        h('img', {
          class: 'uno-chat__avatar',
          src: avatarImage(avatarKeys[Number(m.seat) || 0] || AVATARS[0]),
          alt: '', attrs: { decoding: 'async' },
        }),
        h('span', { class: 'uno-chat__name', text: m.name }),
        h('span', { class: 'uno-chat__text', text: m.text }))),
      messages.length === 0
        ? h('p', {
          class: 'uno-chat__empty',
          text: isLocal
            ? '牌桌弹幕：打字试试，消息会从头像冒泡并飘过牌桌（仅本机可见）。'
            : '房间聊天：约同学一起打牌，随时招呼。消息也会出现在牌桌上。',
        }) : null);
    return h('aside', { class: `uno-chat ${docked ? 'uno-chat--corner' : ''}` },
      h('h2', {
        class: 'uno-chat__title',
        text: isLocal ? '牌桌弹幕 · 仅本机可见' : '房间聊天',
      }),
      list,
      h('form', {
        class: 'uno-chat__form',
        on: { submit: (event) => { event.preventDefault(); submitChat(chatInputNode?.value || chatDraft); } },
      },
      h('input', {
        class: 'uno-chat__input', type: 'text', value: chatDraft,
        attrs: { maxlength: '200', placeholder: isLocal ? '发条弹幕…' : '说点什么…', 'aria-label': '聊天内容' },
        ref: (node) => { chatInputNode = node; },
        on: { input: (event) => { chatDraft = event.target.value; } },
      }),
      h('button', { class: 'uno-btn uno-btn--small uno-btn--primary', type: 'submit', text: '发送' })));
  }

  // 对局中的规则条：人机模式可切换（切换即重开一局），联机模式只读展示房主设定。
  function ruleBarNode() {
    const isElim = view.winCondition === 'elimination';
    return h('div', { class: 'uno-rulebar' },
      h('span', { class: 'uno-rulebar__label', text: '本局规则' }),
      mode === 'local'
        ? ruleSelector(view.winCondition || 'first', { onChange: localSetWinCondition })
        : h('span', {
          class: `uno-rulebar__value ${isElim ? 'is-elim' : ''}`,
          text: isElim ? '淘汰赛 · 玩到倒数第二位出完，最后一人垫底' : '标准 · 有人先出完即结束',
        }),
      mode === 'local'
        ? h('span', { class: 'uno-rulebar__note', text: '切换规则会重开一局' })
        : null,
      h('button', {
        class: `uno-btn uno-btn--small uno-float-toggle ${floatingChatOn ? 'is-on' : ''}`,
        type: 'button',
        text: floatingChatOn ? '牌桌弹幕 · 开' : '牌桌弹幕 · 关',
        attrs: { 'aria-pressed': floatingChatOn ? 'true' : 'false', 'aria-label': '切换牌桌聊天气泡与弹幕' },
        on: { click: () => { floatingChatOn = !floatingChatOn; render(); } },
      }));
  }

  // ---- 主渲染 -----------------------------------------------------------
  function render() {
    const chatFocused = document.activeElement?.classList?.contains('uno-chat__input');
    const inGame = mode === 'local' || isOnlinePlaying();
    const showLobby = mode === 'online' && (!client.joined || !view.roomId || view.phase === 'lobby');
    const message = view.flash || view.status || '';
    avatarKeys = avatarKeysFor(view.seats);

    const head = h('header', { class: 'uno-head' },
      h('div', { class: 'uno-head__copy' },
        h('p', { class: 'uno-eyebrow', text: 'NJU RED CROSS · 内建桌游' }),
        h('h1', { class: 'uno-title', text: '南小红UNO' }),
        h('p', {
          class: 'uno-subtitle',
          text: mode === 'local'
            ? '同学手绘的一副牌，休息时来一局。当前为人机练习，不记录成绩、不联网。'
            : `联机房间 ${view.roomId || ''} · 服务端判定，你看不到别人的手牌。房间数据只在内存，重启即清空。`,
        })),
      h('div', { class: 'uno-head__actions' },
        h('div', { class: 'uno-tabs', attrs: { role: 'tablist', 'aria-label': '游戏模式' } },
          h('button', {
            class: `uno-tab ${mode === 'local' ? 'is-active' : ''}`, type: 'button', text: '人机练习',
            attrs: { role: 'tab', 'aria-selected': mode === 'local' ? 'true' : 'false' },
            on: { click: () => switchMode('local') },
          }),
          h('button', {
            class: `uno-tab ${mode === 'online' ? 'is-active' : ''}`, type: 'button', text: '联机房间',
            attrs: { role: 'tab', 'aria-selected': mode === 'online' ? 'true' : 'false' },
            on: { click: () => switchMode('online') },
          })),
        h('button', {
          class: 'uno-btn', type: 'button', text: '玩法说明',
          on: { click: () => { modal = 'rules'; render(); } },
        }),
        mode === 'local'
          ? h('button', {
            class: 'uno-btn uno-btn--primary', type: 'button', text: '开新一局',
            on: { click: newLocalRound },
          })
          : null));

    const status = inGame && !showLobby
      ? h('section', {
        class: `uno-status ${view.pendingDraw > 0 ? 'is-penalty' : ''} ${view.myTurn ? 'is-mine' : ''}`,
        attrs: { 'aria-live': 'polite' },
      },
      h('div', { class: 'uno-status__main' },
        h('span', {
          class: `uno-status__dot ${view.direction === 1 ? '' : 'is-reverse'}`,
          attrs: { 'aria-hidden': 'true' },
        }),
        h('strong', { text: message })),
      h('div', { class: 'uno-status__meta' },
        h('span', { text: view.myTurn ? '你的回合' : `等待 ${view.seats?.[view.turn]?.name || '—'} 出牌` }),
        h('span', { text: `牌堆 ${view.drawPileCount} 张` }),
        h('span', { text: `第 ${view.round} 局` }),
        view.pendingDraw > 0
          ? h('span', { class: 'uno-status__penalty', text: `待罚 ${view.pendingDraw} 张` })
          : null))
      : null;

    const foot = h('footer', { class: 'uno-foot' },
      h('span', { text: view.selfHand?.length
        ? `你手里剩余牌面值 ${scoreHand(view.selfHand)} 分 · 累计 ${view.scores?.[view.seat] ?? 0} 分`
        : '原创牌面 · 非官方 · 仅内部娱乐' }),
      h('span', { text: mode === 'online' ? '同源 SSE 实时同步 · 无需登录' : '原创牌面 · 非官方 · 仅内部娱乐' }));

    const showColor = mode === 'online'
      ? (view.needColor && !showLobby)
      : (modal === 'color' || (view.needColor && !modal));
    const overlay = modal === 'rules' ? rulesModal() : showColor ? colorModal() : null;

    // 出牌记录与聊天记录都已内嵌在牌桌左右上角；只有大厅聊天仍放在牌桌下方。
    const below = showLobby ? chatNode() : null;

    // 100% 缩放同屏：头 → 规则条 → 状态 → 牌桌（含手牌、左上聊天、右上出牌记录）全部挤进首屏。
    root.replaceChildren(...[
      head,
      showLobby ? lobbyNode() : null,
      inGame && !showLobby ? ruleBarNode() : null,
      inGame && !showLobby ? status : null,
      inGame && !showLobby ? boardNode() : null,
      below,
      foot,
      inGame && !showLobby ? resultNode() : null,
      overlay,
    ].filter(Boolean));

    // 动画标记只在本帧有效，渲染完立即对齐基线。
    lastTopId = view.top?.id || null;
    lastHandIds = new Set((view.selfHand || []).map((card) => card.id));
    lastRound = view.round;
    dealing = false;
    // 若渲染前正在聊天输入框打字，重建后恢复焦点（避免联机广播刷新丢焦点）。
    if (chatFocused) root.querySelector('.uno-chat__input')?.focus();
    // 新消息弹气泡（须在牌桌重建之后，才能按席位实际坐标定位）。
    noticeMessages(inGame && !showLobby);
  }

  // URL 带 ?room=XXXX 时预填房间码，方便分享邀请链接。
  const invited = new URLSearchParams(window.location.search).get('room');
  if (invited) {
    codeDraft = invited.toUpperCase();
    mode = 'online';
  }
  render();
  if (mode === 'local') scheduleAi();
  else if (client.joined) client.connect();

  return {
    title: '南小红UNO · 牌桌',
    node: root,
    dispose() {
      disposed = true;
      clearTimer();
      client.close();
      floatingLayer.replaceChildren();
      floatingLayer.remove();
    },
  };
}
