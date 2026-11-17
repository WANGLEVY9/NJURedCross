import test from 'node:test';
import assert from 'node:assert/strict';
import { createVenueService, venueOverlap, isOccupyingVenue, VENUE_APPLICATION_STATUS, VENUE_ROOM_STATUS } from '../lib/materials/venue-service.js';
import { VENUE_ROOM_TABLE, VENUE_APPLICATION_TABLE } from '../lib/materials/venue-schema.js';

function fixture() {
  const tables = {
    [VENUE_ROOM_TABLE]: [
      { _id: 'room-a', '场地名称': '会议室A', '地点': '大活305', '可借开始时间': '08:00', '可借结束时间': '22:00', '容量': 30, '状态': '启用', '备注': '' },
      { _id: 'room-b', '场地名称': '活动室B', '地点': '大活306', '可借开始时间': '08:00', '可借结束时间': '22:00', '容量': 50, '状态': '停用', '备注': '' },
    ],
    [VENUE_APPLICATION_TABLE]: [],
  };
  let sequence = 0;
  const writes = [];
  const client = {
    async appendRow(table, row) { const result = { ...structuredClone(row), _id: `${table === VENUE_ROOM_TABLE ? 'room' : 'app'}-${++sequence}` }; tables[table].push(result); writes.push({ type: 'append', table, id: result._id }); return structuredClone(result); },
    async updateRow(table, id, patch) { const row = tables[table].find(item => item._id === id); if (!row) throw new Error('not-found'); Object.assign(row, structuredClone(patch)); writes.push({ type: 'update', table, id }); return structuredClone(row); },
  };
  const listRows = async table => { const rows = structuredClone(tables[table]); Object.defineProperty(rows, 'readMeta', { value: { total: rows.length, truncated: false } }); return rows; };
  const options = { client, listRows, actor: '测试管理员', now: () => '2026-11-17 10:00', locks: new Map() };
  const createService = overrides => createVenueService({ ...options, ...overrides });
  const service = createService();
  const apply = (roomId, start, end, purpose, submitter) => service.submitApplication({ roomId, start, end, purpose }, submitter);
  return { tables, client, listRows, service, createService, apply, writes, locks: options.locks };
}

test('场地清单返回可借时段、容量与状态，公众端只取启用场地', async () => {
  const f = fixture();
  const result = await f.service.rooms();
  assert.equal(result.integration.status, 'pending');
  const rooms = result.rooms;
  assert.equal(rooms.length, 2);
  const a = rooms.find(r => r.id === 'room-a');
  assert.equal(a.name, '会议室A'); assert.equal(a.capacity, 30); assert.equal(a.enabled, true);
  assert.equal(rooms.find(r => r.id === 'room-b').enabled, false);
  assert.equal((await f.service.rooms(true)).rooms.length, 1);
});

test('venueOverlap 半开区间：重叠拦截，首尾相接放行', () => {
  assert.equal(venueOverlap('10:00', '12:00', '11:00', '13:00'), true);
  assert.equal(venueOverlap('10:00', '12:00', '11:00', '11:30'), true);
  assert.equal(venueOverlap('10:00', '12:00', '12:00', '13:00'), false);
  assert.equal(venueOverlap('10:00', '12:00', '08:00', '10:00'), false);
  assert.equal(isOccupyingVenue(VENUE_APPLICATION_STATUS.APPROVED), true);
  assert.equal(isOccupyingVenue(VENUE_APPLICATION_STATUS.PENDING), true);
  assert.equal(isOccupyingVenue(VENUE_APPLICATION_STATUS.REJECTED), false);
});

test('提交借用申请创建待审批记录并写入提交时间', async () => {
  const f = fixture();
  const result = await f.apply('room-a', '2026-11-20 10:00', '2026-11-20 12:00', '急救培训', { account: 'u1', realName: '张三' });
  assert.equal(result.application.status, VENUE_APPLICATION_STATUS.PENDING);
  assert.equal(result.application.roomName, '会议室A');
  assert.equal(result.application.applicant, '张三');
  assert.equal(f.tables[VENUE_APPLICATION_TABLE].length, 1);
  assert.equal(f.tables[VENUE_APPLICATION_TABLE][0]['提交时间'], '2026-11-17 10:00');
});

test('同场地重叠时段冲突被拦截，相邻时段允许', async () => {
  const f = fixture();
  await f.apply('room-a', '2026-11-20 10:00', '2026-11-20 12:00', '甲', { account: 'u1', realName: '张三' });
  await assert.rejects(f.apply('room-a', '2026-11-20 11:00', '2026-11-20 13:00', '乙', { account: 'u2', realName: '李四' }), /冲突/);
  await f.apply('room-a', '2026-11-20 12:00', '2026-11-20 13:00', '丙', { account: 'u3', realName: '王五' });
  assert.equal(f.tables[VENUE_APPLICATION_TABLE].length, 2);
});

test('拒绝或取消的申请释放时段，后续申请可重叠', async () => {
  const f = fixture();
  const first = await f.apply('room-a', '2026-11-20 10:00', '2026-11-20 12:00', '甲', { account: 'u1', realName: '张三' });
  await f.service.reviewApplication(first.application.id, { approve: false, reason: '时间冲突' });
  await f.apply('room-a', '2026-11-20 10:00', '2026-11-20 12:00', '乙', { account: 'u2', realName: '李四' });
  assert.equal(f.tables[VENUE_APPLICATION_TABLE].length, 2);
});

test('审批通过写审批人与时间，拒绝需理由，非待审批不可审批', async () => {
  const f = fixture();
  const app = await f.apply('room-a', '2026-11-20 10:00', '2026-11-20 12:00', '甲', { account: 'u1', realName: '张三' });
  const id = app.application.id;
  const approved = await f.service.reviewApplication(id, { approve: true });
  assert.equal(approved.application.status, VENUE_APPLICATION_STATUS.APPROVED);
  assert.equal(approved.application.reviewer, '测试管理员');
  assert.equal(approved.application.reviewedAt, '2026-11-17 10:00');
  await assert.rejects(f.service.reviewApplication(id, { approve: true }), /只能审批待审批/);
  const app2 = await f.apply('room-a', '2026-11-21 10:00', '2026-11-21 12:00', '乙', { account: 'u2', realName: '李四' });
  await assert.rejects(f.service.reviewApplication(app2.application.id, { approve: false }), /理由/);
});

test('停用与不存在的场地拒绝申请', async () => {
  const f = fixture();
  await assert.rejects(f.apply('room-b', '2026-11-20 10:00', '2026-11-20 12:00', '甲', { account: 'u1', realName: '张三' }), /停用/);
  await assert.rejects(f.apply('nope', '2026-11-20 10:00', '2026-11-20 12:00', '甲', { account: 'u1', realName: '张三' }), /不存在/);
});

test('取消仅限本人或管理员，终态不可取消', async () => {
  const f = fixture();
  const app = await f.apply('room-a', '2026-11-20 10:00', '2026-11-20 12:00', '甲', { account: 'u1', realName: '张三' });
  const id = app.application.id;
  await assert.rejects(f.service.cancelApplication(id, 'u2'), /本人/);
  assert.equal((await f.service.cancelApplication(id, 'u1')).application.status, VENUE_APPLICATION_STATUS.CANCELLED);
  await assert.rejects(f.service.cancelApplication(id, 'u1'), /不可取消/);
  const app2 = await f.apply('room-a', '2026-11-21 10:00', '2026-11-21 12:00', '乙', { account: 'u3', realName: '王五' });
  assert.equal((await f.service.cancelApplication(app2.application.id, null, { admin: true })).application.status, VENUE_APPLICATION_STATUS.CANCELLED);
});

test('占用日历只含有效申请并按开始时间排序', async () => {
  const f = fixture();
  await f.apply('room-a', '2026-11-20 10:00', '2026-11-20 12:00', '甲', { account: 'u1', realName: '张三' });
  const second = await f.apply('room-a', '2026-11-21 10:00', '2026-11-21 12:00', '乙', { account: 'u2', realName: '李四' });
  await f.service.reviewApplication(second.application.id, { approve: false, reason: '冲突' });
  const cal = await f.service.calendar();
  assert.equal(cal.bookings.length, 1);
  assert.equal(cal.bookings[0].purpose, '甲');
});

test('创建与更新场地，容量与状态校验', async () => {
  const f = fixture();
  const created = await f.service.createRoom({ name: '阶梯教室', location: '教学楼101', openTime: '08:00', closeTime: '21:00', capacity: 100, note: '' });
  assert.equal(created.room.name, '阶梯教室'); assert.equal(created.room.capacity, 100);
  const updated = await f.service.updateRoom(created.room.id, { status: VENUE_ROOM_STATUS.DISABLED, capacity: 80 });
  assert.equal(updated.room.enabled, false); assert.equal(updated.room.capacity, 80);
  await assert.rejects(f.service.createRoom({ name: 'x', capacity: -1 }), /容量/);
  await assert.rejects(f.service.updateRoom(created.room.id, { status: '未知' }), /启用或停用/);
});

test('截断的操作数据拒绝读取与写入', async () => {
  const f = fixture();
  const truncated = f.createService({ listRows: async table => { const rows = structuredClone(f.tables[table]); Object.defineProperty(rows, 'readMeta', { value: { total: rows.length, truncated: true } }); return rows; } });
  await assert.rejects(truncated.rooms(), error => error.statusCode === 503);
  await assert.rejects(truncated.submitApplication({ roomId: 'room-a', start: '2026-11-20 10:00', end: '2026-11-20 12:00', purpose: '甲' }, { account: 'u1', realName: '张三' }), error => error.statusCode === 503);
});
