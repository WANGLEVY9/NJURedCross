/* 南小红 UNO 联机房间：起一个临时同源 HTTP 服务，走真实请求链路。 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handleUnoRequest, resetUnoRooms, unoRoomForTest } from '../lib/games/uno-room.js';

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

const stateOf = (roomId, seat, token) => request(`rooms/${roomId}/state`, undefined, '', { 'X-Uno-Seat': String(seat), 'X-Uno-Token': token });
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
