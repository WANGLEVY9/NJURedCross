/* ==========================================================================
   南小红UNO —— 联机房间（服务端权威判定）
   - 房间状态只在进程内存，战绩按平台账号记本地 JSON（可选镜像到 SeaTable，见 uno-stats-sink.js）。
   - 已登录用户进入房间时，席位直接绑定其平台账号（昵称取自账号），
     未登录仍可填昵称匿名游玩；房主/动作仍以席位凭证（token）为准。
   - 规则引擎与浏览器共用 public/app/games/uno/engine.js 同一份文件，
     避免「前端一套规则、服务端另一套」；这里只负责席位、隐藏手牌与同步。
   - 传输用同源 SSE（EventSource）+ 普通 POST：平台 CSP 的
     connect-src 'self' 已允许，无需改安全头，也无需 nginx 的 Upgrade 转发。
   - 多实例部署时房间不共享（需 Redis 或粘滞会话）；本地/单进程足够。
   ========================================================================== */
import { randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { setInterval, clearInterval, setTimeout, clearTimeout } from 'node:timers';
import { json, securityHeaders } from '../http/response.js';
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
// 电脑玩家出牌间隔：默认 1200ms（原来 720ms 太快，真人来不及看清）。
// 生产可用 UNO_AI_DELAY_MS 覆盖，钳制在 300–4000ms。
const AI_DELAY_MS = (() => {
  const raw = Number(process.env.UNO_AI_DELAY_MS);
  return Number.isFinite(raw) && raw > 0
    ? Math.min(4000, Math.max(300, Math.round(raw))) : 1200;
})();
const BODY_LIMIT = 16384;          // 语音信令的 SDP offer 可达数 KB，UNO action 单独放宽
const RTC_SIGNAL_TTL_MS = 20 * 1000;   // 语音信令只保留最近 20 秒，避免 SDP 长期驻留内存
const RTC_PROJECT_LIMIT = 12;           // 单次投影最多回传 12 条信令
const MESSAGE_PROJECT_LIMIT = 30;       // 单次投影最多回传 30 条聊天
const PRESENCE_BROADCAST_MS = 80;       // 连接/断开广播去抖窗口
const ROOM_SWEEP_MS = 5 * 60 * 1000;   // 定时回收空房间
const MAX_SEATS = 4;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混的 I/O/0/1

// ---- 第十三版：运营三闸 / 房主转移 / 难度 / +4 防滥用 ----
// 房主掉线宽限：SSE 自带 2s 重连，先宽限一段时间再转移房主，避免抖动。
const HOST_GRACE_MS = (() => { const v = Number(process.env.UNO_HOST_GRACE_MS); return v > 0 ? v : 10000; })();
// 单席位动作令牌桶：突发上限 + 用尽后按间隔恢复，防单客户端狂刷动作。
const ACTION_BURST = (() => { const v = Number(process.env.UNO_ACTION_BURST); return v > 0 ? v : 12; })();
const ACTION_INTERVAL_MS = (() => { const v = Number(process.env.UNO_ACTION_INTERVAL_MS); return v > 0 ? v : 100; })();
// 每 IP 滑动窗口限速（环回地址豁免，不影响本地测试与单机部署）。
const IP_WINDOW_MS = (() => { const v = Number(process.env.UNO_IP_WINDOW_MS); return v > 0 ? v : 10000; })();
const IP_MAX_REQUESTS = (() => { const v = Number(process.env.UNO_IP_MAX_REQUESTS); return v > 0 ? v : 120; })();

/** @type {Map<string, object>} */
const rooms = new Map();

/** 定时回收无活动且无 SSE 连接的房间，并显式释放信令/聊天/牌局引用。
 *  原来只靠「房间数达上限或 2% 概率」清理，空房间会长期驻留内存。 */
function sweepRooms() {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [id, room] of rooms) {
    if (room.lastActivity >= cutoff || room.listeners.size !== 0) continue;
    if (room.aiTimer) clearTimeout(room.aiTimer);
    if (room.broadcastTimer) clearTimeout(room.broadcastTimer);
    room.rtcSignals.length = 0;
    room.messages.length = 0;
    room.state = null;
    room.statsCache = null;
    rooms.delete(id);
  }
}
const sweepTimer = setInterval(sweepRooms, ROOM_SWEEP_MS);
sweepTimer.unref();

const newToken = () => randomBytes(12).toString('hex');

function newRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i += 1) {
    code += CODE_ALPHABET[randomBytes(1)[0] % CODE_ALPHABET.length];
  }
  return rooms.has(code) ? newRoomCode() : code;
}

function cleanName(value) {
  // 上限放宽到 48：平台账号昵称可能是长邮箱，12 字会把名字在数据层就截断、
  // 前端再怎么换行也救不回来。仍过滤换行/尖括号并保留长度上限防撑破布局。
  return String(value || '').replace(/[\r\n<>]/g, '').trim().slice(0, 48) || '同学';
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
    broadcastTimer: null,     // presence 广播去抖
    statsCache: null,         // 按 version 缓存 statsFor 结果，减少临时对象
    statsCacheVersion: -1,
    messages: [],             // 联机聊天记录（仅内存，最多保留 200 条）
    rtcSignals: [],           // 语音连麦 WebRTC 信令（仅内存，最多保留 120 条 / 20 秒）
    winCondition: 'first',    // 'first' 有人先出完即结束 | 'elimination' 玩到倒数第二位出完
    difficulty: 'normal',     // 'easy' | 'normal' | 'hard'，房主在大厅设定，控制电脑对手强度
    rematchVotes: new Set(),  // 终局后「再来一局」投票（在线真人席位集合）
    hostReassignTimer: null,  // 房主掉线后转移房主的宽限定时器
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

/** 单席位动作令牌桶：初始 ACTION_BURST 个额度，之后每 ACTION_INTERVAL_MS 恢复 1 个。
 *  返回 false 表示超过限额，调用方应拒绝（HTTP 429）。防御单客户端狂刷动作。 */
function checkSeatRate(entry) {
  if (!entry) return true;
  const now = Date.now();
  if (!entry.rate) { entry.rate = { tokens: ACTION_BURST - 1, ts: now }; return true; }
  const elapsed = now - entry.rate.ts;
  entry.rate.tokens = Math.min(ACTION_BURST, entry.rate.tokens + elapsed / ACTION_INTERVAL_MS);
  entry.rate.ts = now;
  if (entry.rate.tokens < 1) return false;
  entry.rate.tokens -= 1;
  return true;
}

/** 每 IP 滑动窗口限速：环回地址（127.0.0.1 / ::1 等）豁免，不影响本地测试与单机部署。 */
const ipHits = new Map();
function isLoopback(ip) {
  if (!ip) return false;
  const norm = ip.replace(/^::ffff:/, '');
  return norm === '127.0.0.1' || norm === '::1' || norm === 'localhost';
}
function ipRateAllowed(ip) {
  if (isLoopback(ip)) return true;
  const now = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < IP_WINDOW_MS);
  if (hits.length >= IP_MAX_REQUESTS) { ipHits.set(ip, hits); return false; }
  hits.push(now);
  ipHits.set(ip, hits);
  return true;
}

/** 房主已离线时，把房主转移给另一个在线真人。返回是否发生了转移。 */
function reassignHostIfOffline(room) {
  const seat = room.hostSeat;
  const entry = room.seats[seat];
  if (entry && entry.connected) return false;
  const next = room.seats.findIndex((e, i) => i !== seat && e.kind === 'human' && e.connected);
  if (next >= 0) { room.hostSeat = next; broadcast(room); return true; }
  return false;
}

/** 房主掉线宽限后，把房主转移给另一个在线真人；避免 SSE 重连抖动误转移。
 *  宽限期内房主重连则取消转移；一旦转移完成则新房主接管（房主重连不再夺回）。 */
function scheduleHostReassign(room, seat) {
  if (seat !== room.hostSeat || room.hostReassignTimer) return;
  room.hostReassignTimer = setTimeout(() => {
    room.hostReassignTimer = null;
    if (room.hostSeat !== seat) return;
    reassignHostIfOffline(room);
  }, HOST_GRACE_MS);
  room.hostReassignTimer?.unref?.();
}
function cancelHostReassign(room, seat) {
  if (room.hostReassignTimer && room.hostSeat === seat) {
    clearTimeout(room.hostReassignTimer);
    room.hostReassignTimer = null;
  }
}

/** 按 version 缓存战绩投影：statsFor 是纯内存读，但每次广播要对 4 个席位
 *  各生成一份浅拷贝，缓存后同一帧只算一次。 */
function roomStats(room) {
  if (room.statsCacheVersion !== room.version || !room.statsCache) {
    room.statsCache = room.seats.map((entry) => statsFor(entry.userId));
    room.statsCacheVersion = room.version;
  }
  return room.statsCache;
}

/** 只向该席位暴露自己的手牌，其他席位一律只给数量 —— 联机的基本信息隔离。 */
function project(room, seat) {
  const state = room.state;
  const stats = roomStats(room);
  const seats = room.seats.map((entry, index) => ({
    name: entry.name,
    kind: entry.kind,
    connected: entry.connected || entry.kind === 'ai',
    auto: Boolean(entry.auto),
    isAccount: Boolean(entry.userId),
    stats: stats[index],
    handCount: state ? state.players[index].hand.length : 0,
    saidUno: state ? state.players[index].saidUno : false,
    finished: state ? Boolean(state.players[index].finished) : false,
    score: state ? state.scores[index] : 0,
    isHost: index === room.hostSeat,
  }));
  // 语音信令只回传最近 20 秒的，且按目标席位过滤、限量 12 条：
  // SDP offer/answer/candidate 单条可达数 KB，全量回传是联机加载慢的主因。
  const cutoff = Date.now() - RTC_SIGNAL_TTL_MS;
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
    difficulty: room.difficulty,                       // 电脑难度，房主在大厅设定
    rematchVotes: room.rematchVotes ? Array.from(room.rematchVotes) : [],
    rematchNeeded: room.seats.filter((e) => e.kind === 'human' && e.connected).length,
    // 聊天记录与语音信令贯穿大厅与对局，必须无条件投影（否则大厅阶段看不到）。
    messages: room.messages.slice(-MESSAGE_PROJECT_LIMIT),
    rtc: room.rtcSignals
      .filter((signal) => signal.ts >= cutoff
        && signal.from !== seat && (signal.to === null || signal.to === seat))
      .slice(-RTC_PROJECT_LIMIT),
  };
  if (!state) return base;

  const top = topCard(state);
  const myTurn = seat !== null && seat >= 0 && state.turn === seat && state.phase !== 'over'
    && (room.seats[seat]?.kind === 'human');
  // +4 防滥用投影：手里还有当前色非万能牌时，前端不再把 +4 显示为可出，避免误点被服务端拒。
  let legal = myTurn ? legalMoves(state, seat) : [];
  if (myTurn && state.currentColor) {
    const hand = state.players[seat].hand;
    const hasColorCard = hand.some((c) => c.color === state.currentColor
      && c.kind !== 'wild' && c.kind !== 'wild4');
    if (hasColorCard) {
      legal = legal.filter((id) => hand.find((c) => c.id === id)?.kind !== 'wild4');
    }
  }
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
    winner: state.winner,
    canRematch: room.phase === 'over',
    selfHand: seat !== null && seat >= 0 ? state.players[seat].hand.slice() : [],
    legal,
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

/** presence（连上/断开）类广播去抖：EventSource 重连会成对产生 close+open，
 *  合并成一帧，避免每人都收到两次无状态变化的全量投影。游戏动作仍即时广播。 */
function scheduleBroadcast(room, delay = 0) {
  if (delay <= 0) { broadcast(room); return; }
  if (room.broadcastTimer) return;
  room.broadcastTimer = setTimeout(() => {
    room.broadcastTimer = null;
    broadcast(room);
  }, delay);
  room.broadcastTimer.unref?.();
}

function broadcast(room) {
  room.version += 1;
  // 过期语音信令直接丢弃：SDP 只用于协商期，留着既占内存又撑大每帧投影。
  const cutoff = Date.now() - RTC_SIGNAL_TTL_MS;
  if (room.rtcSignals.length && room.rtcSignals[0].ts < cutoff) {
    room.rtcSignals = room.rtcSignals.filter((signal) => signal.ts >= cutoff);
  }
  for (const [seat, set] of room.listeners) {
    if (!set.size) { room.listeners.delete(seat); continue; }
    const payload = JSON.stringify(project(room, seat));
    for (const res of set) {
      if (res.writableEnded || res.destroyed) { set.delete(res); continue; }
      try { res.write(`event: state\ndata: ${payload}\n\n`); } catch { set.delete(res); }
    }
    if (!set.size) room.listeners.delete(seat);
  }
  touch(room);
}

function writeStream(room, seat, req, res) {
  res.writeHead(200, {
    ...securityHeaders(),
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Content-Encoding': 'identity',
  });
  res.write('retry: 2000\n\n');
  if (!room.listeners.has(seat)) room.listeners.set(seat, new Set());
  room.listeners.get(seat).add(res);
  const entry = room.seats[seat];
  const wasConnected = entry ? entry.connected : true;
  if (entry) { entry.connected = true; entry.lastSeen = Date.now(); entry.auto = false; }
  // 房主重连：取消待执行的房主转移，房主仍归本人。
  if (entry && seat === room.hostSeat) cancelHostReassign(room, seat);
  res.write(`event: state\ndata: ${JSON.stringify(project(room, seat))}\n\n`);

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) { try { res.write(': ping\n\n'); } catch { /* closed */ } }
  }, 30000);
  heartbeat.unref();

  const close = () => {
    clearInterval(heartbeat);
    const set = room.listeners.get(seat);
    set?.delete(res);
    // 关键：清掉空的 Set，否则 room.listeners.size 永远 > 0，
    // 过期房间永远无法回收，SSE 断线还会持续泄漏内存。
    if (set && !set.size) room.listeners.delete(seat);
    if (entry) { entry.connected = false; entry.lastSeen = Date.now(); }
    // 房主掉线：进入宽限转移流程（宽限期内重连则自动取消）。
    if (entry && seat === room.hostSeat) scheduleHostReassign(room, seat);
    touch(room);
    scheduleBroadcast(room, PRESENCE_BROADCAST_MS);
  };
  req.once('close', close);
  res.once('close', close);
  // 只有「从离线变在线」才需要让全桌看到，重复重连不再广播。
  if (!wasConnected) scheduleBroadcast(room, PRESENCE_BROADCAST_MS);
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
  const offline = entry.kind === 'human' && !entry.connected
    && Date.now() - entry.lastSeen > SEAT_TTL_MS;
  if (entry.kind !== 'ai' && !offline) return;
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
    if (next.phase === 'over') room.phase = 'over';
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
  room.rematchVotes = new Set();
  room.phase = 'playing';
}

function applyAction(room, seat, body) {
  const type = String(body?.type || '');
  const state = room.state;
  // 统一在函数顶部声明：challenge 分支位于下方 `let next` 之前，
  // 若在那里才声明会因 TDZ 抛 ReferenceError。
  let next;

  // 运营三闸之一：单席位动作令牌桶限速（防单客户端狂刷动作/聊天/信令）。
  if (!checkSeatRate(room.seats[seat])) {
    return { code: 429, message: '操作太频繁，请稍后再试' };
  }

  // 语音连麦信令：与聊天一样不受回合/阶段限制，只校验席位凭证与格式。
  // 服务端只做转发，不理解 SDP；浏览器之间自行完成 WebRTC 协商。
  if (type === 'rtc') {
    const entry = room.seats[seat];
    if (!entry) return { code: 409, message: '你还没入座' };
    const payload = body?.signal;
    if (!payload || typeof payload !== 'object') return { code: 400, message: '信令格式无效' };
    const kind = String(payload.kind || '');
    if (!['hello', 'bye', 'offer', 'answer', 'candidate'].includes(kind)) {
      return { code: 400, message: '不支持的信令类型' };
    }
    const to = payload.to === null || payload.to === undefined ? null : Number(payload.to);
    if (to !== null && (!Number.isInteger(to) || to < 0 || to >= room.seats.length)) {
      return { code: 400, message: '目标席位无效' };
    }
    const data = payload.data && typeof payload.data === 'object' ? payload.data : null;
    if (['offer', 'answer', 'candidate'].includes(kind) && !data) {
      return { code: 400, message: '信令内容为空' };
    }
    if (JSON.stringify({ kind, to, data }).length > 12000) {
      return { code: 413, message: '信令内容过大' };
    }
    room.rtcSignals.push({ id: newToken(), from: seat, to, kind, data, ts: Date.now() });
    if (room.rtcSignals.length > 120) room.rtcSignals = room.rtcSignals.slice(-120);
    broadcast(room);
    return { ok: true };
  }

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
    const value = String(body?.difficulty || '');
    if (!['easy', 'normal', 'hard'].includes(value)) return { code: 400, message: '难度无效' };
    room.difficulty = value;
    broadcast(room);
    return { ok: true };
  }
  if (type === 'restart') {
    if (room.phase !== 'over' || seat !== room.hostSeat) return { code: 409, message: '本局尚未结束' };
    room.rematchVotes = new Set();
    room.state = nextRound(room.state, randomBytes(4).readUInt32LE(0));
    room.seats.forEach((entry, index) => {
      room.state.players[index].name = entry.name;
      room.state.players[index].isHuman = entry.kind === 'human';
    });
    room.phase = 'playing';
    broadcast(room);
    advanceAi(room);
    return { ok: true };
  }
  if (type === 'rematch') {
    if (room.phase !== 'over') return { code: 409, message: '本局尚未结束' };
    const entry = room.seats[seat];
    if (!entry) return { code: 409, message: '你还没入座' };
    if (entry.kind !== 'human') return { code: 409, message: '只有真人能投票' };
    if (!room.rematchVotes) room.rematchVotes = new Set();
    room.rematchVotes.add(seat);
    // 在线真人（断线者不计入）全部投同意即重开；单人房自己投即开。
    const humans = room.seats.map((e, i) => ({ e, i }))
      .filter((x) => x.e.kind === 'human' && x.e.connected);
    const allVoted = humans.length > 0 && humans.every((x) => room.rematchVotes.has(x.i));
    if (allVoted) {
      room.rematchVotes = new Set();
      room.state = nextRound(room.state, randomBytes(4).readUInt32LE(0));
      room.seats.forEach((en, index) => {
        room.state.players[index].name = en.name;
        room.state.players[index].isHuman = en.kind === 'human';
      });
      room.phase = 'playing';
      broadcast(room);
      advanceAi(room);
      return { ok: true };
    }
    broadcast(room);
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
    // +4 防滥用（服务端二次校验）：手里还有当前色的非万能牌时，不允许出 +4（标准 UNO 规则）。
    // 引擎 canPlay 仍保留「万能牌随时可出」的简化口径（保持客户端可用性与既有测试），
    // 此处为权威兜底，且 project 已把非法 +4 从 legal 中剔除，前端不会诱导误点。
    if (card.kind === 'wild4' && state.currentColor) {
      const hasColorCard = state.players[seat].hand
        .some((item) => item.color === state.currentColor && item.kind !== 'wild' && item.kind !== 'wild4');
      if (hasColorCard) return { code: 409, message: '你手里还有同色牌，不能出 +4（UNO 规则）' };
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
 * 处理 /api/games/uno/ 下的请求。返回 true 表示已处理（含 SSE 长连接）。
 * 由 server.js 在业务中间件之前直接调用，房间逻辑完全不碰 SeaTable。
 */
export async function handleUnoRequest(req, res, url, user = null) {
  const path = url.pathname.slice(PREFIX.length);
  if (!url.pathname.startsWith(PREFIX)) return false;

  // 运营三闸之一：每 IP 滑动窗口限速（环回地址豁免，不影响本地测试与单机部署）。
  const clientIp = req.socket?.remoteAddress || '';
  if (!ipRateAllowed(clientIp)) { fail(res, 429, '请求过于频繁，请稍后再试'); return true; }

  if (rooms.size >= ROOM_LIMIT || Math.random() < 0.02) sweepRooms();

  // POST /rooms —— 创建房间
  if (path === 'rooms' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { fail(res, 413, '请求内容过大或格式错误'); return true; }
    if (rooms.size >= ROOM_LIMIT) { fail(res, 503, '房间已满，请稍后再试'); return true; }
    const room = makeRoom(body?.name, user);
    json(res, 200, { ok: true, roomId: room.id, seat: 0, token: room.seats[0].token });
    return true;
  }

  // GET /config —— 语音连麦 ICE 配置（可选）。生产可通过 UNO_RTC_ICE_JSON 下发
  // 自建 STUN/TURN；未配置时返回空数组，前端退回内置公共 STUN。不返回任何账号凭据。
  if (path === 'config' && req.method === 'GET') {
    let iceServers = [];
    try {
      const raw = process.env.UNO_RTC_ICE_JSON;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) iceServers = parsed;
      }
    } catch { /* 配置写错时静默退回默认，不影响房间功能 */ }
    json(res, 200, { ok: true, iceServers });
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

  const seat = seatByToken(room, url.searchParams.get('seat'), url.searchParams.get('token'));

  // GET /rooms/:id/events —— SSE 长连接
  if (parts.length === 2 && parts[1] === 'events' && req.method === 'GET') {
    if (seat < 0) { fail(res, 401, '席位凭证无效'); return true; }
    writeStream(room, seat, req, res);
    return true;
  }

  // GET /rooms/:id/state —— 轮询兜底（EventSource 不可用时客户端自动降级）
  if (parts.length === 2 && parts[1] === 'state' && req.method === 'GET') {
    if (seat < 0) { fail(res, 401, '席位凭证无效'); return true; }
    // 客户端带上已知 version：状态没变就回一个极小的包，省掉整份投影。
    // 不传 version 参数时保持旧行为（完整投影），兼容旧客户端与测试。
    const known = url.searchParams.get('version');
    if (known !== null && Number(known) === room.version) {
      json(res, 200, { ok: true, unchanged: true, version: room.version });
      return true;
    }
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
  for (const room of rooms.values()) {
    if (room.aiTimer) clearTimeout(room.aiTimer);
    if (room.broadcastTimer) clearTimeout(room.broadcastTimer);
  }
  rooms.clear();
}

export function unoRoomCount() {
  return rooms.size;
}

/** 仅供测试：取房间对象以构造特定局面（如 +4 质疑窗口），不在生产路径使用。 */
export function unoRoomForTest(roomId) {
  return rooms.get(String(roomId).toUpperCase()) || null;
}

/** 仅供测试与运维自检：当前生效的运行期常量（第十二版性能/节奏口径）。 */
export function unoRuntimeConfig() {
  return {
    aiDelayMs: AI_DELAY_MS,
    rtcSignalTtlMs: RTC_SIGNAL_TTL_MS,
    rtcProjectLimit: RTC_PROJECT_LIMIT,
    messageProjectLimit: MESSAGE_PROJECT_LIMIT,
    presenceBroadcastMs: PRESENCE_BROADCAST_MS,
    roomSweepMs: ROOM_SWEEP_MS,
    hostGraceMs: HOST_GRACE_MS,
    actionBurst: ACTION_BURST,
    actionIntervalMs: ACTION_INTERVAL_MS,
    ipWindowMs: IP_WINDOW_MS,
    ipMaxRequests: IP_MAX_REQUESTS,
  };
}

/** 仅供测试：立即执行一次空房间回收（避免等待 5 分钟定时器）。 */
export function unoSweepRoomsForTest() {
  sweepRooms();
}

// 仅供测试：暴露内部限速/房主转移实现，便于单测（生产路径不依赖这些导出）。
export { checkSeatRate, ipRateAllowed, isLoopback, reassignHostIfOffline };
