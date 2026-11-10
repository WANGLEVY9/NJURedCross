/* ==========================================================================
   南小红UNO —— 联机房间（服务端权威判定）
   - 房间状态只在进程内存，战绩按平台账号记本地 JSON（可选镜像到 SeaTable，见 uno-stats-sink.js）。
   - 已登录用户进入房间时，席位直接绑定其平台账号（昵称取自账号），
     未登录仍可填昵称匿名游玩；房主/动作仍以席位凭证（token）为准。
   - 规则引擎与浏览器共用 public/app/games/uno/engine.js 同一份文件，
     避免「前端一套规则、服务端另一套」；这里只负责席位、隐藏手牌与同步。
   - 传输用同源短轮询 + 普通 POST：平台 CSP 的
     connect-src 'self' 已允许，无需改安全头，也无需 nginx 的 Upgrade 转发。
   - 多实例部署时房间不共享（需 Redis 或粘滞会话）；本地/单进程足够。
   ========================================================================== */
import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { json } from '../http/response.js';
import {
  createGame, nextRound, playCard, chooseColor, drawCard, passTurn, callUno,
  legalMoves, canPlay, topCard, statusText, rankingOf, COLORS, challengeCard,
} from '../../public/app/games/uno/engine.js';
import { chooseAiMove } from '../../public/app/games/uno/ai.js';
import { recordResult, statsFor } from './uno-stats-sink.js';

const PREFIX = '/api/games/uno/';
const ROOM_LIMIT = 64;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;   // 2 小时无活动回收
const SEAT_TTL_MS = 30 * 1000;            // 断线 30 秒后由电脑托管
const AI_DELAY_MS = 720;
const BODY_LIMIT = 4096;
const MAX_SEATS = 4;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混的 I/O/0/1

/** @type {Map<string, object>} */
const rooms = new Map();

const newToken = () => randomBytes(12).toString('hex');

function newRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i += 1) {
    code += CODE_ALPHABET[randomBytes(1)[0] % CODE_ALPHABET.length];
  }
  return rooms.has(code) ? newRoomCode() : code;
}

function cleanName(value) {
  return String(value || '').replace(/[\r\n<>]/g, '').trim().slice(0, 12) || '同学';
}

function makeRoom(name, user = null) {
  const room = {
    id: newRoomCode(),
    createdAt: Date.now(),
    lastActivity: Date.now(),
    hostSeat: 0,
    phase: 'lobby',           // lobby | playing | over
    seats: [{
      token: newToken(),
      name: user?.name || cleanName(name),
      userId: user?.username || null,
      kind: 'human', connected: true, lastSeen: Date.now(), auto: false,
    }],
    state: null,
    version: 0,
    listeners: new Map(),     // seat -> Set<res>
    aiTimer: null,
    messages: [],             // 联机聊天记录（仅内存，最多保留 200 条）
    difficulty: 'normal',
    rematchVotes: new Set(),
    winCondition: 'first',    // 'first' 有人先出完即结束 | 'elimination' 玩到倒数第二位出完
  };
  rooms.set(room.id, room);
  return room;
}

function touch(room) {
  room.lastActivity = Date.now();
}

function seatByToken(room, seat, token) {
  const index = Number(seat);
  if (!Number.isInteger(index) || index < 0 || index >= room.seats.length) return -1;
  if (!token || room.seats[index].token !== token) return -1;
  return index;
}

/** 只向该席位暴露自己的手牌，其他席位一律只给数量 —— 联机的基本信息隔离。 */
function project(room, seat) {
  const state = room.state;
  const seats = room.seats.map((entry, index) => ({
    name: entry.name,
    kind: entry.kind,
    connected: entry.kind === 'ai' || Date.now() - entry.lastSeen <= SEAT_TTL_MS,
    auto: Boolean(entry.auto),
    isAccount: Boolean(entry.userId),
    stats: statsFor(entry.userId),
    handCount: state ? state.players[index].hand.length : 0,
    saidUno: state ? state.players[index].saidUno : false,
    finished: state ? Boolean(state.players[index].finished) : false,
    score: state ? state.scores[index] : 0,
    isHost: index === room.hostSeat,
  }));
  const base = {
    roomId: room.id,
    seat,
    phase: room.phase,
    seats,
    hostSeat: room.hostSeat,
    version: room.version,
    canStart: room.phase === 'lobby' && room.seats.length >= 2,
    canAddAi: room.phase === 'lobby' && room.seats.length < MAX_SEATS,
    winCondition: room.winCondition,
    difficulty: room.difficulty,
    rematchVotes: [...room.rematchVotes],
    rematchNeeded: room.seats.filter((entry) => entry.kind === 'human' && Date.now() - entry.lastSeen <= SEAT_TTL_MS).length,
    // 聊天记录贯穿大厅与对局，必须无条件投影（否则大厅阶段的消息看不到）。
    messages: room.messages.slice(-50),
  };
  if (!state) return base;

  const top = topCard(state);
  const myTurn = seat !== null && seat >= 0 && state.turn === seat && state.phase !== 'over'
    && (room.seats[seat]?.kind === 'human');
  return {
    ...base,
    round: state.round,
    scores: state.scores.slice(),
    turn: state.turn,
    direction: state.direction,
    currentColor: state.currentColor,
    pendingDraw: state.pendingDraw,
    drawPileCount: state.drawPile.length,
    discardCount: state.discardPile.length,
    top,
    secondTop: state.discardPile.length > 1 ? state.discardPile[state.discardPile.length - 2] : null,
    status: statusText(state),
    log: state.log.slice(-6),
    flash: state.flash || '',
    messages: room.messages.slice(-50),
    winner: state.winner,
    selfHand: seat !== null && seat >= 0 ? state.players[seat].hand.slice() : [],
    legal: myTurn ? legalMoves(state, seat) : [],
    myTurn,
    selfSaidUno: seat !== null && seat >= 0 ? Boolean(state.players[seat]?.saidUno) : false,
    canCallUno: Boolean(myTurn && state.players[seat]?.hand.length === 2 && !state.players[seat]?.saidUno),
    winCondition: state.winCondition,
    finishedOrder: state.finishedOrder.slice(),
    ranking: state.phase === 'over' ? rankingOf(state) : [],
    loser: state.loser,
    drewCard: state.drewCard || null,
    needColor: state.phase === 'choosing' && myTurn,
    canChallenge: myTurn && Boolean(state.pendingChallenge) && state.pendingChallenge.target === seat,
    challengeColor: state.pendingChallenge ? state.pendingChallenge.color : null,
  };
}

function broadcast(room) {
  room.version += 1;
  for (const [seat, set] of room.listeners) {
    const payload = JSON.stringify(project(room, seat));
    for (const res of set) {
      if (res.writableEnded || res.destroyed) { set.delete(res); continue; }
      try { res.write(`event: state\ndata: ${payload}\n\n`); } catch { set.delete(res); }
    }
  }
  touch(room);
}

/** 电脑席位（或断线托管的真人席位）自动走一步，直到轮到在线真人或终局。 */
function advanceAi(room) {
  if (room.aiTimer) { clearTimeout(room.aiTimer); room.aiTimer = null; }
  if (room.phase !== 'playing' || !room.state) return;
  const state = room.state;
  if (state.phase === 'over') { room.phase = 'over'; return; }
  const index = state.turn;
  const entry = room.seats[index];
  if (!entry) return;
  const offline = entry.kind === 'human' && Date.now() - entry.lastSeen > SEAT_TTL_MS;
  if (entry.kind !== 'ai' && !offline) {
    room.aiTimer = setTimeout(() => advanceAi(room), Math.max(1, SEAT_TTL_MS - (Date.now() - entry.lastSeen) + 1));
    room.aiTimer.unref();
    return;
  }
  if (offline && !entry.auto) { entry.auto = true; broadcast(room); }

  room.aiTimer = setTimeout(() => {
    room.aiTimer = null;
    if (room.phase !== 'playing' || !room.state) return;
    const current = room.state;
    let next;
    if (current.phase === 'choosing') {
      const card = current.players[current.turn].hand.find((item) => item.id === current.pendingCardId);
      const hand = current.players[current.turn].hand;
      const tally = Object.fromEntries(COLORS.map((color) => [color, 0]));
      for (const item of hand) if (item.color) tally[item.color] += 1;
      const color = COLORS.reduce((best, item) => (tally[item] > tally[best] ? item : best), COLORS[0]);
      next = chooseColor(current, card ? color : COLORS[0]);
    } else {
      const move = chooseAiMove(current, current.turn, room.difficulty);
      if (move.type === 'uno') {
        next = callUno(current, current.turn);
      } else if (move.type === 'play') {
        next = playCard(current, current.turn, move.cardId, move.chosenColor);
      } else if (move.type === 'pass') {
        next = passTurn(current, current.turn);
      } else {
        next = drawCard(current, current.turn);
      }
    }
    if (next === current || !next) return;
    room.state = next;
    finishIfOver(room, next);
    broadcast(room);
    advanceAi(room);
  }, AI_DELAY_MS);
  room.aiTimer.unref();
}

/** 终局统一结算：房间相位 + 战绩（含名次/规则/垫底），供所有能结束对局的动作复用。 */
function finishIfOver(room, next) {
  if (next.phase !== 'over') return;
  room.phase = 'over';
  recordResult(room.seats, next.winner, next.scores, {
    ranking: rankingOf(next),
    winCondition: next.winCondition,
    loser: next.loser,
  });
}

function startGame(room) {
  const count = Math.max(2, Math.min(MAX_SEATS, room.seats.length));
  room.state = createGame({ playerCount: count, seed: randomBytes(4).readUInt32LE(0), winCondition: room.winCondition });
  room.seats.forEach((entry, index) => {
    const player = room.state.players[index];
    player.name = entry.name;
    player.isHuman = entry.kind === 'human';
  });
  room.phase = 'playing';
}

function applyAction(room, seat, body) {
  const type = String(body?.type || '');
  const entry = room.seats[seat];
  const now = Date.now();
  const rate = entry.rate || { tokens: 12, time: now };
  rate.tokens = Math.min(12, rate.tokens + Math.max(0, now - rate.time) / 100);
  rate.time = now;
  entry.rate = rate;
  if (rate.tokens < 1) return { code: 429, message: '操作太频繁，请稍后再试' };
  rate.tokens -= 1;
  const state = room.state;
  // 统一在函数顶部声明：challenge 分支位于下方 `let next` 之前，
  // 若在那里才声明会因 TDZ 抛 ReferenceError。
  let next;

  if (type === 'addAi') {
    if (room.phase !== 'lobby' || seat !== room.hostSeat) return { code: 409, message: '只有房主在等待时才能添加电脑' };
    if (room.seats.length >= MAX_SEATS) return { code: 409, message: '房间已满' };
    const used = new Set(room.seats.map((item) => item.name));
    const names = ['小南', '苏荷', '格格'];
    const name = names.find((item) => !used.has(item)) || `电脑 ${room.seats.length}`;
    room.seats.push({ token: newToken(), name, kind: 'ai', connected: true, lastSeen: Date.now(), auto: false });
    broadcast(room);
    return { ok: true };
  }
  if (type === 'removeAi') {
    if (room.phase !== 'lobby' || seat !== room.hostSeat) return { code: 409, message: '只有房主在等待时才能移除电脑' };
    const last = room.seats[room.seats.length - 1];
    if (!last || last.kind !== 'ai') return { code: 409, message: '没有可移除的电脑' };
    room.seats.pop();
    broadcast(room);
    return { ok: true };
  }
  if (type === 'start') {
    if (room.phase !== 'lobby' || seat !== room.hostSeat) return { code: 409, message: '只有房主能开局' };
    if (room.seats.length < 2) return { code: 409, message: '至少需要两位玩家，可先添加电脑' };
    startGame(room);
    broadcast(room);
    advanceAi(room);
    return { ok: true };
  }
  if (type === 'rule') {
    if (room.phase !== 'lobby' || seat !== room.hostSeat) return { code: 409, message: '只有房主在等待时能改规则' };
    const value = String(body?.winCondition || '');
    if (value !== 'first' && value !== 'elimination') return { code: 400, message: '胜负判定方式无效' };
    room.winCondition = value;
    broadcast(room);
    return { ok: true };
  }
  if (type === 'difficulty') {
    if (room.phase !== 'lobby' || seat !== room.hostSeat) return { code: 409, message: '只有房主在等待时能设难度' };
    if (!['easy', 'normal', 'hard'].includes(body?.difficulty)) return { code: 400, message: '难度无效' };
    room.difficulty = body.difficulty;
    broadcast(room);
    return { ok: true };
  }
  if (type === 'rematch') {
    if (room.phase !== 'over') return { code: 409, message: '本局尚未结束' };
    room.rematchVotes.add(seat);
    const online = room.seats.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.kind === 'human' && Date.now() - entry.lastSeen <= SEAT_TTL_MS);
    if (online.length && online.every(({ index }) => room.rematchVotes.has(index))) {
      room.rematchVotes.clear();
      room.state = nextRound(room.state, randomBytes(4).readUInt32LE(0));
      room.seats.forEach((entry, index) => { room.state.players[index].name = entry.name; room.state.players[index].isHuman = entry.kind === 'human'; });
      room.phase = 'playing';
      broadcast(room);
      advanceAi(room);
    } else broadcast(room);
    return { ok: true };
  }
  if (type === 'ping') {
    const entry = room.seats[seat];
    if (entry) { entry.lastSeen = Date.now(); entry.connected = true; entry.auto = false; }
    return { ok: true };
  }

  // 聊天：任意阶段、已入座即可发送（大厅与对局都可用），纯内存、不落库。
  if (type === 'chat') {
    const text = String(body?.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!text) return { code: 400, message: '消息为空' };
    const entry = room.seats[seat];
    if (!entry) return { code: 409, message: '你还没入座' };
    room.messages.push({
      id: newToken(),
      seat,
      userId: entry.userId || null,
      name: entry.name,
      text,
      ts: Date.now(),
    });
    if (room.messages.length > 200) room.messages = room.messages.slice(-200);
    broadcast(room);
    return { ok: true };
  }

  // 喊 UNO：手里剩两张、轮到自己时先喊；忘喊会在出到剩一张时被罚抽 2 张。
  if (type === 'uno') {
    if (!state || (state.phase !== 'playing' && state.phase !== 'choosing')) {
      return { code: 409, message: '现在不能喊 UNO' };
    }
    if (state.turn !== seat) return { code: 409, message: '现在还没轮到你' };
    const me = state.players[seat];
    if (!me || me.hand.length < 1 || me.hand.length > 2) {
      return { code: 409, message: '手里剩两张牌时才需要喊 UNO' };
    }
    if (me.saidUno) return { code: 409, message: '已经喊过 UNO 了' };
    room.state = callUno(state, seat);
    broadcast(room);
    return { ok: true };
  }

  if (type === 'challenge') {
    if (!state || !state.pendingChallenge) return { code: 409, message: '现在不能质疑' };
    if (state.pendingChallenge.target !== seat || state.turn !== seat) return { code: 409, message: '现在不是你能质疑的时机' };
    next = challengeCard(state, seat);
    room.state = next;
    finishIfOver(room, next);
    broadcast(room);
    advanceAi(room);
    return { ok: true };
  }

  if (room.phase !== 'playing' || !state) return { code: 409, message: '对局尚未开始' };
  if (state.phase === 'over') return { code: 409, message: '本局已结束' };
  if (state.turn !== seat) return { code: 409, message: '现在还没轮到你' };

  if (type === 'play') {
    const cardId = String(body?.cardId || '');
    const card = state.players[seat].hand.find((item) => item.id === cardId);
    if (!card) return { code: 400, message: '找不到这张牌' };
    if (!canPlay(card, state)) {
      return { code: 409, message: state.pendingDraw > 0 ? `先抽 ${state.pendingDraw} 张牌` : '这张牌现在不能出' };
    }
    const color = body?.color ? String(body.color) : null;
    next = playCard(state, seat, cardId, color);
  } else if (type === 'color') {
    if (state.phase !== 'choosing') return { code: 409, message: '现在不需要选颜色' };
    const color = String(body?.color || '');
    if (!COLORS.includes(color)) return { code: 400, message: '颜色无效' };
    next = chooseColor(state, color);
  } else if (type === 'draw') {
    next = drawCard(state, seat);
  } else if (type === 'pass') {
    if (!state.drewCard) return { code: 409, message: '现在不需要过' };
    next = passTurn(state, seat);
  } else {
    return { code: 400, message: '不支持的操作' };
  }

  room.state = next;
  finishIfOver(room, next);
  broadcast(room);
  advanceAi(room);
  return { ok: true };
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new Error('body_too_large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function fail(res, status, message) {
  if (res.headersSent) return;
  json(res, status, { ok: false, message });
}

/**
 * 处理 /api/games/uno/ 下的请求。返回 true 表示已处理。
 * 由 server.js 在业务中间件之前直接调用，房间逻辑完全不碰 SeaTable。
 */
export async function handleUnoRequest(req, res, url, user = null) {
  const path = url.pathname.slice(PREFIX.length);
  if (!url.pathname.startsWith(PREFIX)) return false;

  if (rooms.size >= ROOM_LIMIT || Math.random() < 0.02) {
    const cutoff = Date.now() - ROOM_TTL_MS;
    for (const [id, room] of rooms) {
      if (room.lastActivity < cutoff && room.listeners.size === 0) rooms.delete(id);
    }
  }

  // POST /rooms —— 创建房间
  if (path === 'rooms' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { fail(res, 413, '请求内容过大或格式错误'); return true; }
    if (rooms.size >= ROOM_LIMIT) { fail(res, 503, '房间已满，请稍后再试'); return true; }
    const room = makeRoom(body?.name, user);
    json(res, 200, { ok: true, roomId: room.id, seat: 0, token: room.seats[0].token });
    return true;
  }

  // 客户端路径为 rooms/:id/... —— 去掉字面量 rooms 段后，parts[0] 才是房间码。
  const rawParts = path.split('/');
  const parts = rawParts[0] === 'rooms' ? rawParts.slice(1) : rawParts;
  const roomId = String(parts[0] || '').toUpperCase();
  const room = rooms.get(roomId);
  if (!room) {
    if (parts.length === 2 && parts[1] === 'join' && req.method === 'POST') {
      fail(res, 404, '房间不存在，请核对房间码'); return true;
    }
    return false;
  }

  // POST /rooms/:id/join —— 加入房间（无需 token）
  if (parts.length === 2 && parts[1] === 'join' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { fail(res, 413, '请求内容过大或格式错误'); return true; }
    if (room.phase !== 'lobby') { fail(res, 409, '对局已开始，无法加入'); return true; }
    if (room.seats.length >= MAX_SEATS) { fail(res, 409, '房间已满'); return true; }
    const seat = room.seats.length;
    room.seats.push({ token: newToken(), name: user?.name || cleanName(body?.name), userId: user?.username || null, kind: 'human', connected: true, lastSeen: Date.now(), auto: false });
    broadcast(room);
    json(res, 200, { ok: true, roomId, seat, token: room.seats[seat].token });
    return true;
  }

  const seat = seatByToken(room, req.headers['x-uno-seat'], req.headers['x-uno-token']);

  // GET /rooms/:id/state —— 轮询兜底（EventSource 不可用时客户端自动降级）
  if (parts.length === 2 && parts[1] === 'state' && req.method === 'GET') {
    if (seat < 0) { fail(res, 401, '席位凭证无效'); return true; }
    room.seats[seat].lastSeen = Date.now();
    room.seats[seat].auto = false;
    const host = room.seats[room.hostSeat];
    if (host && Date.now() - host.lastSeen > SEAT_TTL_MS && seat !== room.hostSeat) { room.hostSeat = seat; broadcast(room); }
    touch(room);
    json(res, 200, { ok: true, ...project(room, seat) });
    return true;
  }

  // POST /rooms/:id/action —— 所有游戏动作（凭证在请求体，不进 URL）
  if (parts.length === 2 && parts[1] === 'action' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { fail(res, 413, '请求内容过大或格式错误'); return true; }
    const actionSeat = seat >= 0 ? seat : seatByToken(room, body?.seat, body?.token);
    if (actionSeat < 0) { fail(res, 401, '席位凭证无效'); return true; }
    const result = applyAction(room, actionSeat, body);
    if (!result.ok) { fail(res, result.code || 400, result.message); return true; }
    json(res, 200, { ok: true, version: room.version });
    return true;
  }

  return false;
}

/** 供测试与优雅关闭使用。 */
export function resetUnoRooms() {
  for (const room of rooms.values()) if (room.aiTimer) clearTimeout(room.aiTimer);
  rooms.clear();
}

export function unoRoomCount() {
  return rooms.size;
}

/** 仅供测试：取房间对象以构造特定局面（如 +4 质疑窗口），不在生产路径使用。 */
export function unoRoomForTest(roomId) {
  return rooms.get(String(roomId).toUpperCase()) || null;
}
