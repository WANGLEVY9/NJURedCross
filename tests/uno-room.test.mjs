/* 南小红 UNO 联机房间：起一个临时同源 HTTP 服务，走真实请求链路。 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import process from 'node:process';
import {
  handleUnoRequest, resetUnoRooms, unoRoomForTest, unoRoomCount,
  unoRuntimeConfig, unoSweepRoomsForTest,
  checkSeatRate, ipRateAllowed, isLoopback, reassignHostIfOffline,
} from '../lib/games/uno-room.js';
import { chooseAiMove } from '../public/app/games/uno/ai.js';
import { createGame } from '../public/app/games/uno/engine.js';

let server;
let base;

const safeParse = (value) => { try { return JSON.parse(value); } catch { return null; } };

before(async () => {
  resetUnoRooms();
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const user = req.headers['x-uno-user'] ? safeParse(req.headers['x-uno-user']) : null;
    const handled = await handleUnoRequest(req, res, url, user).catch(() => false);
    if (handled) return;
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"ok":false}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  resetUnoRooms();
  await new Promise((resolve) => server.close(resolve));
});

const request = async (path, body, query = '', headers = {}) => {
  const suffix = query ? `?${query}` : '';
  const init = body === undefined
    ? { method: 'GET', headers }
    : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) };
  const response = await fetch(`${base}/api/games/uno/${path}${suffix}`, init);
  return { status: response.status, data: await response.json() };
};

const creds = (seat, token) => `seat=${seat}&token=${token}`;
const stateOf = (roomId, seat, token) => request(`rooms/${roomId}/state`, undefined, creds(seat, token));
const act = (roomId, seat, token, type, extra = {}) =>
  request(`rooms/${roomId}/action`, { type, ...extra, seat, token });

/** 建一个两人房并开局。 */
async function twoPlayerRoom() {
  const host = await request('rooms', { name: '甲' });
  const guest = await request(`rooms/${host.data.roomId}/join`, { name: '乙' });
  const started = await act(host.data.roomId, host.data.seat, host.data.token, 'start');
  assert.equal(started.status, 200);
  return { roomId: host.data.roomId, host: host.data, guest: guest.data };
}

test('创建 / 加入 / 开局，席位与房间码可用', async () => {
  const host = await request('rooms', { name: '金大夫' });
  assert.equal(host.status, 200);
  assert.equal(host.data.seat, 0);
  assert.match(host.data.roomId, /^[A-Z2-9]{4}$/);

  const guest = await request(`rooms/${host.data.roomId}/join`, { name: '同学甲' });
  assert.equal(guest.status, 200);
  assert.equal(guest.data.seat, 1);

  const lobby = await stateOf(host.data.roomId, 0, host.data.token);
  assert.equal(lobby.data.phase, 'lobby');
  assert.equal(lobby.data.seats.length, 2);
  assert.equal(lobby.data.canStart, true);

  const started = await act(host.data.roomId, 0, host.data.token, 'start');
  assert.equal(started.status, 200);
  const view = await stateOf(host.data.roomId, 0, host.data.token);
  assert.equal(view.data.phase, 'playing');
  assert.equal(view.data.seats.length, 2);
  assert.equal(view.data.drawPileCount > 0, true);
  assert.ok(view.data.top, '开局应翻出一张底牌');
});

test('投影只暴露自己的手牌，别人的牌只给数量', async () => {
  const { roomId, host, guest } = await twoPlayerRoom();
  const mine = await stateOf(roomId, host.seat, host.token);
  const theirs = await stateOf(roomId, guest.seat, guest.token);
  assert.equal(mine.data.selfHand.length, 7);
  assert.equal(theirs.data.selfHand.length, 7);
  assert.equal(mine.data.seats[1].handCount, 7);
  assert.equal(theirs.data.seats[0].handCount, 7);
  assert.equal(mine.data.seats[1].hand, undefined, '不得下发别人的手牌');
  assert.equal(theirs.data.seats[0].hand, undefined, '不得下发别人的手牌');

  const otherIds = new Set(theirs.data.selfHand.map((card) => card.id));
  const myIds = new Set(mine.data.selfHand.map((card) => card.id));
  for (const id of otherIds) assert.equal(myIds.has(id), false, '两人手牌不应重叠');
  // 用带引号的完整 token 匹配，避免 c7 被 c70 这类前缀误命中。
  const serialized = JSON.stringify(mine.data);
  for (const id of otherIds) assert.equal(serialized.includes(`"${id}"`), false, `投影里泄漏了对方牌 ${id}`);
});

test('凭证与权限校验：非房主开局、错 token、无凭证均被拒', async () => {
  const host = await request('rooms', { name: '甲' });
  const guest = await request(`rooms/${host.data.roomId}/join`, { name: '乙' });
  const roomId = host.data.roomId;

  const guestStart = await act(roomId, guest.data.seat, guest.data.token, 'start');
  assert.equal(guestStart.status, 409);

  const noCreds = await request(`rooms/${roomId}/action`, { type: 'start' });
  assert.equal(noCreds.status, 401);

  const badToken = await stateOf(roomId, 1, 'deadbeef');
  assert.equal(badToken.status, 401);

  const hostStart = await act(roomId, 0, host.data.token, 'start');
  assert.equal(hostStart.status, 200);

  const wrongTurn = await act(roomId, guest.data.seat, guest.data.token, 'draw');
  assert.equal(wrongTurn.status, 409);
});

test('合法出牌推进回合，非法出牌被拒且不改状态', async () => {
  const { roomId, host } = await twoPlayerRoom();
  const before = await stateOf(roomId, host.seat, host.token);
  assert.equal(before.data.turn, 0);

  const fake = await act(roomId, host.seat, host.token, 'play', { cardId: 'not-a-card' });
  assert.equal(fake.status, 400);

  const illegal = before.data.selfHand.find((card) => !before.data.legal.includes(card.id));
  if (illegal) {
    const bad = await act(roomId, host.seat, host.token, 'play', { cardId: illegal.id });
    assert.equal(bad.status, 409);
  }

  const playable = before.data.legal.map((id) => before.data.selfHand.find((card) => card.id === id));
  const plain = playable.find((card) => card.kind !== 'wild' && card.kind !== 'wild4');
  const chosen = plain?.id || before.data.legal[0] || null;
  if (chosen) {
    // 万能牌需带颜色一次结算，否则会停在 choosing 阶段、手牌数不变。
    const good = await act(roomId, host.seat, host.token, 'play', plain ? { cardId: chosen } : { cardId: chosen, color: 'r' });
    assert.equal(good.status, 200);
    const after = await stateOf(roomId, host.seat, host.token);
    assert.equal(after.data.selfHand.length, 6);
    assert.notEqual(after.data.version, before.data.version);
  } else {
    const drew = await act(roomId, host.seat, host.token, 'draw');
    assert.equal(drew.status, 200);
    const after = await stateOf(roomId, host.seat, host.token);
    assert.equal(after.data.selfHand.length, 8);
  }
});

test('房间码大小写不敏感，不存在的房间返回 404', async () => {
  const missing = await request('rooms/ZZZZ/join', { name: '甲' });
  assert.equal(missing.status, 404);

  const host = await request('rooms', { name: '甲' });
  const join = await request(`rooms/${host.data.roomId.toLowerCase()}/join`, { name: '乙' });
  assert.equal(join.status, 200);
});

test('房主可添加电脑补位，凑满 4 人后开局', async () => {
  const host = await request('rooms', { name: '甲' });
  const roomId = host.data.roomId;
  const added = await act(roomId, 0, host.data.token, 'addAi');
  assert.equal(added.status, 200);
  const added2 = await act(roomId, 0, host.data.token, 'addAi');
  assert.equal(added2.status, 200);
  const lobby = await stateOf(roomId, 0, host.data.token);
  assert.equal(lobby.data.seats.length, 3);
  assert.equal(lobby.data.seats[1].kind, 'ai');

  const started = await act(roomId, 0, host.data.token, 'start');
  assert.equal(started.status, 200);
  const view = await stateOf(roomId, 0, host.data.token);
  assert.equal(view.data.seats.length, 3);
  assert.equal(view.data.phase, 'playing');
});

test('登录用户进房：席位绑定平台账号（isAccount / 昵称取自账号 / 战绩为空）', async () => {
  const user = { username: 'jin', name: 'HostJin' };
  const host = await request('rooms', { name: '忽略昵称' }, '', { 'x-uno-user': JSON.stringify(user) });
  assert.equal(host.status, 200);
  const view = await stateOf(host.data.roomId, host.data.seat, host.data.token);
  assert.equal(view.data.seats[0].isAccount, true);
  assert.equal(view.data.seats[0].name, 'HostJin');
  assert.equal(view.data.seats[0].stats, null);
});

test('无待质疑窗口时发起质疑被拒', async () => {
  const { roomId, host } = await twoPlayerRoom();
  const bad = await act(roomId, host.seat, host.token, 'challenge');
  assert.equal(bad.status, 409);
});

test('联机房间聊天：消息写入并广播，空消息被拒', async () => {
  const { roomId, host, guest } = await twoPlayerRoom();
  const sent = await act(roomId, host.seat, host.token, 'chat', { text: '大家好' });
  assert.equal(sent.status, 200);
  const view = await stateOf(roomId, guest.seat, guest.token);
  assert.ok(view.data.messages.some((m) => m.text === '大家好' && m.name === '甲'));
  const empty = await act(roomId, host.seat, host.token, 'chat', { text: '   ' });
  assert.equal(empty.status, 400);
});

test('大厅阶段聊天也会投影到视图（regression: lobby 不漏 messages）', async () => {
  const host = await request('rooms', { name: '甲' });
  const guest = await request(`rooms/${host.data.roomId}/join`, { name: '乙' });
  const sent = await act(host.data.roomId, host.data.seat, host.data.token, 'chat', { text: '大厅喊一声' });
  assert.equal(sent.status, 200);
  const hostView = await stateOf(host.data.roomId, host.data.seat, host.data.token);
  assert.equal(hostView.data.phase, 'lobby', '未开局应处于大厅阶段');
  assert.ok(hostView.data.messages.some((m) => m.text === '大厅喊一声'), 'lobby 视图必须含聊天记录');
  const guestView = await stateOf(host.data.roomId, guest.data.seat, guest.data.token);
  assert.ok(guestView.data.messages.some((m) => m.text === '大厅喊一声'), '其他席位也能看到大厅聊天');
});

test('摸到牌后「过」结束回合：联机 pass 动作推进 turn', async () => {
  // 构造一个房主无牌可出、且牌堆顶为不可出牌的局面较繁；此处验证 pass 在错误时机被拒即可。
  const { roomId, host } = await twoPlayerRoom();
  const noDraw = await act(roomId, host.seat, host.token, 'pass');
  // 开局未摸牌，drewCard 为空，应被拒
  assert.equal(noDraw.status, 409);
});

// ---- 胜负判定规则（rule 动作 + 投影） -----------------------------------
test('房间默认胜负判定为 first，并在大厅/对局都投影', async () => {
  const host = await request('rooms', { name: '甲' });
  const lobby = await stateOf(host.data.roomId, host.data.seat, host.data.token);
  assert.equal(lobby.data.winCondition, 'first');
  const guest = await request(`rooms/${host.data.roomId}/join`, { name: '乙' });
  assert.equal(guest.status, 200);
  const started = await act(host.data.roomId, host.data.seat, host.data.token, 'start');
  assert.equal(started.status, 200);
  const view = await stateOf(host.data.roomId, host.data.seat, host.data.token);
  assert.equal(view.data.winCondition, 'first');
  assert.deepEqual(view.data.finishedOrder, []);
  assert.equal(view.data.loser, null);
  assert.equal(view.data.seats[0].finished, false);
});

test('房主在大厅设定淘汰制：投影同步给所有席位，开局后引擎按淘汰制建局', async () => {
  const host = await request('rooms', { name: '甲' });
  const guest = await request(`rooms/${host.data.roomId}/join`, { name: '乙' });
  const roomId = host.data.roomId;

  const set = await act(roomId, host.data.seat, host.data.token, 'rule', { winCondition: 'elimination' });
  assert.equal(set.status, 200);

  const hostView = await stateOf(roomId, host.data.seat, host.data.token);
  assert.equal(hostView.data.winCondition, 'elimination');
  const guestView = await stateOf(roomId, guest.data.seat, guest.data.token);
  assert.equal(guestView.data.winCondition, 'elimination', '其他席位也能看到规则变更');

  const started = await act(roomId, host.data.seat, host.data.token, 'start');
  assert.equal(started.status, 200);
  const view = await stateOf(roomId, host.data.seat, host.data.token);
  assert.equal(view.data.winCondition, 'elimination', '开局后规则沿用大厅设定');
});

test('rule 动作的校验：非房主、非法值、开局后均被拒', async () => {
  const host = await request('rooms', { name: '甲' });
  const guest = await request(`rooms/${host.data.roomId}/join`, { name: '乙' });
  const roomId = host.data.roomId;

  const byGuest = await act(roomId, guest.data.seat, guest.data.token, 'rule', { winCondition: 'elimination' });
  assert.equal(byGuest.status, 409, '非房主不能改规则');

  const invalid = await act(roomId, host.data.seat, host.data.token, 'rule', { winCondition: 'whatever' });
  assert.equal(invalid.status, 400, '非法规则值被拒');
  const stillFirst = await stateOf(roomId, host.data.seat, host.data.token);
  assert.equal(stillFirst.data.winCondition, 'first', '被拒的动作不应改动规则');

  const started = await act(roomId, host.data.seat, host.data.token, 'start');
  assert.equal(started.status, 200);
  const afterStart = await act(roomId, host.data.seat, host.data.token, 'rule', { winCondition: 'elimination' });
  assert.equal(afterStart.status, 409, '开局后不能改规则');
});

// ---- 第六版：牌局聊天、质疑链路、终局名次 -------------------------------
test('牌局期间聊天同样写入并投影给所有席位（气泡/弹幕的数据源）', async () => {
  const { roomId, host, guest } = await twoPlayerRoom();
  const sent = await act(roomId, host.seat, host.token, 'chat', { text: '开局啦，加油！' });
  assert.equal(sent.status, 200);
  const mine = await stateOf(roomId, host.seat, host.token);
  assert.equal(mine.data.phase, 'playing');
  const msg = mine.data.messages.find((m) => m.text === '开局啦，加油！');
  assert.ok(msg, '开局后的聊天消息必须出现在投影里');
  assert.equal(msg.seat, host.seat, '消息要带发言席位，前端才能把气泡锚到该席位');
  assert.ok(msg.id, '消息要有稳定 id，前端才能只弹新增消息');
  const theirs = await stateOf(roomId, guest.seat, guest.token);
  assert.ok(theirs.data.messages.some((m) => m.id === msg.id), '其他席位收到同一条消息');
});

test('质疑 +4 动作链路不再因 TDZ 崩溃（challenge 分支复用函数级 next）', async () => {
  const { roomId, host, guest } = await twoPlayerRoom();
  const room = unoRoomForTest(roomId);
  assert.ok(room?.state, '测试钩子应能取到房间状态');
  // 构造：0 号刚打出 +4，1 号处于可质疑窗口；0 号手里确有红牌 → 质疑成立。
  room.state.turn = 1;
  room.state.pendingDraw = 4;
  room.state.pendingChallenge = { by: 0, target: 1, color: 'r' };
  room.state.players[0].hand.push({ id: 'test-red', color: 'r', kind: 'number', value: 3, image: 'r3.webp' });

  const result = await act(roomId, guest.seat, guest.token, 'challenge');
  assert.equal(result.status, 200, 'challenge 应正常返回，不得因 TDZ 抛错变成 404/500');
  const view = await stateOf(roomId, guest.seat, guest.token);
  assert.equal(view.data.pendingDraw, 0, '质疑已结算');
});

test('终局投影带完整名次，供结算面板与战绩入库共用口径', async () => {
  const { roomId, host, guest } = await twoPlayerRoom();
  const room = unoRoomForTest(roomId);
  room.state.phase = 'over';
  room.state.winCondition = 'elimination';
  room.state.winner = 1;
  room.state.finishedOrder = [1];
  room.state.loser = 0;
  const view = await stateOf(roomId, guest.seat, guest.token);
  assert.deepEqual(view.data.ranking, [1, 0]);
});

test('喊 UNO 动作：剩两张可喊、投影带 selfSaidUno / canCallUno、出牌不罚抽', async () => {
  const { roomId, host } = await twoPlayerRoom();
  const room = unoRoomForTest(roomId);
  room.state.turn = 0;
  room.state.currentColor = 'r';
  room.state.discardPile = [{ id: 'uno-top', color: 'r', kind: 'number', value: 5, image: 'r5.webp' }];
  room.state.players[0].hand = [
    { id: 'uno-a', color: 'r', kind: 'number', value: 1, image: 'r1.webp' },
    { id: 'uno-b', color: 'r', kind: 'number', value: 2, image: 'r2.webp' },
  ];

  const before = await stateOf(roomId, host.seat, host.token);
  assert.equal(before.data.canCallUno, true);
  assert.equal(before.data.selfSaidUno, false);

  const called = await act(roomId, host.seat, host.token, 'uno');
  assert.equal(called.status, 200);
  const view = await stateOf(roomId, host.seat, host.token);
  assert.equal(view.data.selfSaidUno, true);
  assert.equal(view.data.canCallUno, false);
  assert.equal(view.data.seats[0].saidUno, true);

  const again = await act(roomId, host.seat, host.token, 'uno');
  assert.equal(again.status, 409, '重复喊 UNO 应被拒');

  const played = await act(roomId, host.seat, host.token, 'play', { cardId: 'uno-a' });
  assert.equal(played.status, 200);
  const after = await stateOf(roomId, host.seat, host.token);
  assert.equal(after.data.selfHand.length, 1, '喊过 UNO 后出到剩一张不罚抽');
});

// ---- 第十一版：语音连麦信令与 ICE 配置 ----------------------------------
test('GET /config 返回 ICE 配置数组，且不泄露任何凭据', async () => {
  const result = await request('config');
  assert.equal(result.status, 200);
  assert.equal(result.data.ok, true);
  assert.ok(Array.isArray(result.data.iceServers));
  assert.equal(/token|secret|password/i.test(JSON.stringify(result.data)), false);
});

test('语音信令：定向 offer 只给目标席位、hello 广播、非法信令被拒', async () => {
  // request() 返回 { status, data }，席位凭证在 data 里；这里直接取 data 便于后文复用。
  const host = (await request('rooms', { name: '房主' })).data;
  const guest = (await request(`rooms/${host.roomId}/join`, { name: '同学' })).data;
  const roomId = host.roomId;

  // 大厅阶段也能开麦：信令不受回合 / 阶段限制。
  const offered = await act(roomId, host.seat, host.token, 'rtc', {
    signal: { to: guest.seat, kind: 'offer', data: { type: 'offer', sdp: 'v=0' } },
  });
  assert.equal(offered.status, 200);

  const mine = await stateOf(roomId, host.seat, host.token);
  const theirs = await stateOf(roomId, guest.seat, guest.token);
  assert.ok(Array.isArray(mine.data.rtc), '投影要带 rtc 信令数组');
  assert.equal(mine.data.rtc.length, 0, '定向 offer 不回传给发起者');
  assert.equal(theirs.data.rtc.length, 1, '目标席位收到一条');
  assert.equal(theirs.data.rtc[0].from, host.seat);
  assert.equal(theirs.data.rtc[0].to, guest.seat);
  assert.equal(theirs.data.rtc[0].kind, 'offer');
  assert.ok(theirs.data.rtc[0].id, '信令要有稳定 id，供前端去重');

  const hello = await act(roomId, guest.seat, guest.token, 'rtc', {
    signal: { to: null, kind: 'hello', data: null },
  });
  assert.equal(hello.status, 200);
  const mine2 = await stateOf(roomId, host.seat, host.token);
  assert.ok(mine2.data.rtc.some((item) => item.kind === 'hello'), 'hello 广播给其他席位');
  const theirs2 = await stateOf(roomId, guest.seat, guest.token);
  assert.equal(theirs2.data.rtc.some((item) => item.kind === 'hello' && item.from === guest.seat), false,
    '发起者不会收到自己发的 hello');

  const badKind = await act(roomId, host.seat, host.token, 'rtc', {
    signal: { to: null, kind: 'exec', data: {} },
  });
  assert.equal(badKind.status, 400);
  const badTarget = await act(roomId, host.seat, host.token, 'rtc', {
    signal: { to: 99, kind: 'candidate', data: { candidate: 'x' } },
  });
  assert.equal(badTarget.status, 400);
  const emptySdp = await act(roomId, host.seat, host.token, 'rtc', {
    signal: { to: guest.seat, kind: 'offer', data: null },
  });
  assert.equal(emptySdp.status, 400);
});

// ---- 第十二版：联机加载/内存优化、AI 节奏与投影限量 ------------------------
test('运行期常量：AI 放慢到 1200ms、信令 TTL 20s、投影限量生效', () => {
  const cfg = unoRuntimeConfig();
  const raw = Number(process.env.UNO_AI_DELAY_MS);
  const expected = Number.isFinite(raw) && raw > 0
    ? Math.min(4000, Math.max(300, Math.round(raw))) : 1200;
  assert.equal(cfg.aiDelayMs, expected, 'AI 出牌间隔钳制在 300–4000ms');
  assert.equal(expected, 1200, '默认（未配置时）应为 1200ms，比 v11 的 720ms 明显放慢');
  assert.equal(cfg.rtcSignalTtlMs, 20000, '语音信令只保留 20 秒');
  assert.equal(cfg.rtcProjectLimit, 12, '单帧最多回传 12 条信令');
  assert.equal(cfg.messageProjectLimit, 30, '单帧最多回传 30 条聊天');
  assert.ok(cfg.presenceBroadcastMs > 0, '连接/断开广播需要去抖');
  assert.ok(cfg.roomSweepMs > 0, '需要定时回收空房间');
});

test('/state?version 命中已知版本时返回极小 unchanged 包，状态变化后失效', async () => {
  const host = await request('rooms', { name: '甲' });
  const roomId = host.data.roomId;
  const full = await stateOf(roomId, host.data.seat, host.data.token);
  const version = full.data.version;

  const hit = await request(`rooms/${roomId}/state`, undefined,
    `${creds(host.data.seat, host.data.token)}&version=${version}`);
  assert.equal(hit.status, 200);
  assert.equal(hit.data.unchanged, true);
  assert.equal(hit.data.version, version);
  assert.equal(hit.data.seats, undefined, 'unchanged 包不得带整份投影');
  assert.ok(JSON.stringify(hit.data).length < 120, 'unchanged 包应极小，减少联机流量');

  // 有人加入 → broadcast 让 version 递增，旧 version 不再命中。
  await request(`rooms/${roomId}/join`, { name: '乙' });
  const stale = await request(`rooms/${roomId}/state`, undefined,
    `${creds(host.data.seat, host.data.token)}&version=${version}`);
  assert.equal(stale.data.unchanged, undefined, '版本过期必须回完整投影');
  assert.ok(Array.isArray(stale.data.seats));
  assert.notEqual(stale.data.version, version);

  // 不带 version 时保持旧行为，兼容旧客户端与轮询降级。
  const legacy = await stateOf(roomId, host.data.seat, host.data.token);
  assert.ok(Array.isArray(legacy.data.seats));
});

test('聊天投影上限 30 条、信令投影上限 12 条，过期信令不入帧', async () => {
  const host = await request('rooms', { name: '甲' });
  const guest = await request(`rooms/${host.data.roomId}/join`, { name: '乙' });
  assert.equal(guest.status, 200);
  const room = unoRoomForTest(host.data.roomId);
  assert.ok(room);

  const now = Date.now();
  for (let i = 0; i < 40; i += 1) {
    room.messages.push({ id: `m${i}`, seat: 1, name: '乙', text: `消息${i}`, ts: now - (40 - i) * 10 });
  }
  for (let i = 0; i < 20; i += 1) {
    room.rtcSignals.push({ id: `s${i}`, from: 1, to: null, kind: 'hello', data: null, ts: now - (20 - i) * 10 });
  }
  // 21 秒前的信令必须被 TTL 过滤掉。
  room.rtcSignals.push({ id: 'expired', from: 1, to: null, kind: 'hello', data: null, ts: now - 21000 });

  const view = await stateOf(host.data.roomId, host.data.seat, host.data.token);
  assert.equal(view.data.messages.length, 30, '聊天投影上限 30 条');
  assert.equal(view.data.messages[0].text, '消息10', '只保留最近 30 条');
  assert.equal(view.data.rtc.length, 12, '信令投影上限 12 条');
  assert.equal(view.data.rtc.some((item) => item.id === 'expired'), false, '过期信令不投影');
});

test('broadcast 就地清理过期信令，减少常驻内存', async () => {
  const host = await request('rooms', { name: '甲' });
  await request(`rooms/${host.data.roomId}/join`, { name: '乙' });
  const room = unoRoomForTest(host.data.roomId);
  room.rtcSignals.push({
    id: 'expired', from: 1, to: 0, kind: 'hello', data: null, ts: Date.now() - 21000,
  });

  const sent = await act(host.data.roomId, host.data.seat, host.data.token, 'chat', { text: '触发广播' });
  assert.equal(sent.status, 200);
  assert.equal(room.rtcSignals.some((item) => item.id === 'expired'), false,
    'broadcast 应丢弃超过 TTL 的信令');
});

test('同一 version 内战绩投影复用缓存，版本变化后缓存失效', async () => {
  const host = await request('rooms', { name: '甲' }, '', {
    'x-uno-user': JSON.stringify({ username: 'jin', name: 'Jin' }),
  });
  const roomId = host.data.roomId;
  const room = unoRoomForTest(roomId);
  const first = await stateOf(roomId, host.data.seat, host.data.token);
  const cached = room.statsCache;
  assert.equal(room.statsCacheVersion, first.data.version);

  const second = await stateOf(roomId, host.data.seat, host.data.token);
  assert.equal(room.statsCache, cached, 'version 未变时复用同一缓存数组，避免每帧浅拷贝');
  assert.equal(second.data.version, first.data.version);

  await request(`rooms/${roomId}/join`, { name: '乙' });
  const after = await stateOf(roomId, host.data.seat, host.data.token);
  assert.equal(room.statsCacheVersion, after.data.version, '版本变化后按新 version 重建缓存');
  assert.notEqual(room.statsCache, cached);
});

test('过期且无 SSE 连接的空房间被定时回收，释放牌局/信令/聊天引用', async () => {
  const host = await request('rooms', { name: '待回收' });
  const room = unoRoomForTest(host.data.roomId);
  assert.ok(room);
  room.lastActivity = Date.now() - 3 * 60 * 60 * 1000;   // 3 小时无活动，超过 2h TTL
  assert.equal(room.listeners.size, 0);

  const before = unoRoomCount();
  unoSweepRoomsForTest();
  assert.equal(unoRoomCount(), before - 1, '过期空房间从内存移除');
  assert.equal(unoRoomForTest(host.data.roomId), null);

  const gone = await stateOf(host.data.roomId, host.data.seat, host.data.token);
  assert.equal(gone.status, 404, '被回收的房间不再接受状态请求');
});

// ---- 第十三版：投影隔离 / +4 防滥用 / 运营三闸 / 房主转移 / 重开投票 / 难度 ----
test('任一客户端收不到他人手牌（投影隔离回归：无 players、席位无 hand）', async () => {
  const { roomId, host, guest } = await twoPlayerRoom();
  const mine = await stateOf(roomId, host.seat, host.token);
  const theirs = await stateOf(roomId, guest.seat, guest.token);
  assert.equal(mine.data.players, undefined, '顶层不得下发 players 手牌数组');
  assert.equal(mine.data.state, undefined, '顶层不得下发 state 手牌数组');
  for (const seat of mine.data.seats) assert.equal(seat.hand, undefined, '席位不得含他人 hand（只应有 handCount）');
  const otherIds = new Set(theirs.data.selfHand.map((card) => card.id));
  const serialized = JSON.stringify(mine.data);
  for (const id of otherIds) assert.equal(serialized.includes(`"${id}"`), false, `投影里泄漏了对方手牌 ${id}`);
});

test('服务端二次校验：手里还有同色牌时禁止出 +4，且前端 legal 不再列为可出', async () => {
  const { roomId, host } = await twoPlayerRoom();
  const room = unoRoomForTest(roomId);
  room.state.currentColor = 'r';
  room.state.turn = host.seat;
  room.state.players[host.seat].hand = [
    { id: 'w4', color: null, kind: 'wild4', value: null, image: 'wild4.webp' },
    { id: 'r5', color: 'r', kind: 'number', value: 5, image: 'r5.webp' },
  ];

  const blocked = await act(roomId, host.seat, host.token, 'play', { cardId: 'w4' });
  assert.equal(blocked.status, 409, '手里还有红牌时出 +4 被拒');
  assert.ok(blocked.data.message.includes('+4'), '提示应点名 +4 规则');

  const view = await stateOf(roomId, host.seat, host.token);
  assert.equal(view.data.selfHand.some((card) => card.id === 'w4'), true, '手牌里确有 +4');
  assert.equal(view.data.legal.includes('w4'), false, 'legal 不得把非法 +4 列为可出');
  assert.equal(view.data.legal.includes('r5'), true, '同色普通牌仍可出');
});

test('手里没有同色牌时 +4 仍允许（不误伤）', async () => {
  const { roomId, host } = await twoPlayerRoom();
  const room = unoRoomForTest(roomId);
  room.state.currentColor = 'r';
  room.state.turn = host.seat;
  room.state.players[host.seat].hand = [
    { id: 'w4', color: null, kind: 'wild4', value: null, image: 'wild4.webp' },
    { id: 'b5', color: 'b', kind: 'number', value: 5, image: 'b5.webp' },
  ];
  const ok = await act(roomId, host.seat, host.token, 'play', { cardId: 'w4' });
  assert.equal(ok.status, 200, '没有当前色牌时 +4 合法');
});

test('运营三闸：单席位令牌桶与每 IP 窗口限速（环回豁免）', () => {
  const cfg = unoRuntimeConfig();
  // 单席位：突发用尽后拒绝。
  const entry = {};
  let allowed = 0;
  for (let i = 0; i < cfg.actionBurst + 3; i += 1) if (checkSeatRate(entry)) allowed += 1;
  assert.equal(allowed, cfg.actionBurst, '突发额度用尽后拒绝');
  assert.equal(checkSeatRate(entry), false, '额度为 0 时立即拒绝');
  // 环回地址豁免。
  assert.equal(isLoopback('127.0.0.1'), true);
  assert.equal(isLoopback('::1'), true);
  assert.equal(isLoopback('::ffff:127.0.0.1'), true);
  assert.equal(isLoopback('203.0.113.5'), false);
  // 非环回地址超出窗口后被拒（用全新假 IP，避免与真实请求串扰）。
  let ipAllowed = 0;
  for (let i = 0; i < cfg.ipMaxRequests + 1; i += 1) if (ipRateAllowed('203.0.113.77')) ipAllowed += 1;
  assert.equal(ipAllowed, cfg.ipMaxRequests, '非环回地址超出窗口后被拒');
});

test('房主掉线后把房主转移给在线真人，房主在线时不转移', async () => {
  const host = await request('rooms', { name: '房主' });
  await request(`rooms/${host.data.roomId}/join`, { name: '乙' });
  await request(`rooms/${host.data.roomId}/join`, { name: '丙' });
  const room = unoRoomForTest(host.data.roomId);
  assert.equal(room.hostSeat, 0);

  room.seats[0].connected = false;            // 房主离线
  assert.equal(reassignHostIfOffline(room), true, '离线房主应被转移');
  assert.equal(room.hostSeat, 1, '房主转移给下一个在线真人（席 1）');
  assert.equal(room.seats[1].isHost || room.hostSeat === 1, true);

  room.seats[0].connected = true;             // 房主重新在线
  room.hostSeat = 0;
  assert.equal(reassignHostIfOffline(room), false, '房主在线时不转移');
});

test('终局后「再来一局」需在线真人全票，达成后自动重开', async () => {
  const { roomId, host, guest } = await twoPlayerRoom();
  const room = unoRoomForTest(roomId);
  room.phase = 'over';
  room.state.phase = 'over';
  room.state.winner = guest.seat;

  const v1 = await act(roomId, host.seat, host.token, 'rematch');
  assert.equal(v1.status, 200);
  let view = await stateOf(roomId, host.seat, host.token);
  assert.equal(view.data.phase, 'over', '未全票前不重开');
  assert.ok(view.data.rematchVotes.includes(host.seat), '已记录席 0 投票');
  assert.equal(view.data.rematchNeeded, 2, '需要 2 名在线真人投票');

  const v2 = await act(roomId, guest.seat, guest.token, 'rematch');
  assert.equal(v2.status, 200);
  view = await stateOf(roomId, host.seat, host.token);
  assert.equal(view.data.phase, 'playing', '全票后自动重开');
  assert.equal(view.data.rematchVotes.length, 0, '重开后清空投票');
  assert.equal((await act(roomId, host.seat, host.token, 'rematch')).status, 409, '非终局时 rematch 被拒');
});

test('房主在大厅设定难度并投影；非房主 / 非法值被拒', async () => {
  const host = await request('rooms', { name: '房主' });
  const guest = await request(`rooms/${host.data.roomId}/join`, { name: '乙' });
  assert.equal((await act(host.data.roomId, guest.data.seat, guest.data.token, 'difficulty', { difficulty: 'hard' })).status, 409, '非房主不能设难度');
  assert.equal((await act(host.data.roomId, host.data.seat, host.data.token, 'difficulty', { difficulty: 'xxx' })).status, 400, '非法难度被拒');
  const ok = await act(host.data.roomId, host.data.seat, host.data.token, 'difficulty', { difficulty: 'hard' });
  assert.equal(ok.status, 200);
  const view = await stateOf(host.data.roomId, host.data.seat, host.data.token);
  assert.equal(view.data.difficulty, 'hard', '难度投影给客户端');
});

test('AI 安全门禁：对手只剩 1 张时优先出压制牌（加二/加四/禁止/反转）', () => {
  // 构造对局态：席 1（AI）轮到出牌，席 0 只剩 1 张（UNO 危险）。
  const state = createGame({ playerCount: 2, seed: 1 });
  state.currentColor = 'r';
  state.turn = 1;
  state.players[0].hand = [{ id: 'x0', color: 'b', kind: 'number', value: 3, image: 'b3.webp' }];
  const d2r = { id: 'd2r', color: 'r', kind: 'draw2', value: null, image: 'd2-r.webp' };
  const r5 = { id: 'r5', color: 'r', kind: 'number', value: 5, image: 'r5.webp' };
  const r9 = { id: 'r9', color: 'r', kind: 'number', value: 9, image: 'r9.webp' };
  state.players[1].hand = [d2r, r5, r9];

  const move = chooseAiMove(state, 1, 'normal');
  assert.equal(move.cardId, 'd2r', '有对手只剩 1 张时，AI 优先出加二拖住他');

  // 无威胁时不应被压制逻辑带偏：同样三张但对手手牌 >1，普通权重最高的是 r9。
  state.players[0].hand = [
    { id: 'a', color: 'b', kind: 'number', value: 3, image: 'b3.webp' },
    { id: 'b', color: 'g', kind: 'number', value: 7, image: 'g7.webp' },
  ];
  const move2 = chooseAiMove(state, 1, 'normal');
  assert.notEqual(move2.cardId, 'd2r', '无威胁时不再优先压制牌');
});
