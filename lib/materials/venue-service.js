/* ==========================================================================
   venue-service.js — activity-room borrowing (D3 场地借用 v1).
   Self-contained platform loop: room list + borrowable windows, application
   lifecycle (待审批 → 审批通过 / 审批不通过 / 已取消), same-room overlap
   conflict check, and an occupancy calendar. No third-party scheduling;
   指间管理 integration is flagged `pending` for a later adapter.
   Times use `YYYY-MM-DD HH:mm` (zero-padded, lexicographically ordered), so
   overlap reduces to string comparison with the shared half-open formula.
   ========================================================================== */

import { assertCompleteRows } from '../events/safety.js';
import { VENUE_ROOM_TABLE, VENUE_APPLICATION_TABLE, VENUE_ROOM_COLUMNS, VENUE_APPLICATION_COLUMNS, VENUE_APPLICATION_STATUS, VENUE_ROOM_STATUS, VENUE_INTEGRATION_STATUS, venueFailure } from './venue-schema.js';

const text = value => String(value ?? '').trim();
const safeNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const TIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

function fail(status, message, code = 'venue_invalid') { const error = new Error(message); error.statusCode = status; error.code = code; throw error; }

export const VENUE_ACTIVE_STATUS = new Set([VENUE_APPLICATION_STATUS.PENDING, VENUE_APPLICATION_STATUS.APPROVED]);
export function isOccupyingVenue(status) { return VENUE_ACTIVE_STATUS.has(text(status)); }
export function venueOverlap(aStart, aEnd, bStart, bEnd) { return aStart < bEnd && aEnd > bStart; }

function validTime(value) {
  const valueText = text(value);
  return TIME_RE.test(valueText) && !Number.isNaN(Date.parse(valueText.replace(' ', 'T')));
}

function nowStamp(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const parts = fmt.formatToParts(now);
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function roomSummary(row, applications) {
  const related = applications.filter(application => text(application['场地ID']) === row._id);
  const active = related.filter(application => isOccupyingVenue(application['状态']));
  return {
    id: row._id, name: text(row['场地名称']) || '未命名场地', location: text(row['地点']) || '未标注',
    openTime: text(row['可借开始时间']) || null, closeTime: text(row['可借结束时间']) || null,
    capacity: safeNumber(row['容量']), status: text(row['状态']) || VENUE_ROOM_STATUS.ENABLED,
    enabled: text(row['状态']) !== VENUE_ROOM_STATUS.DISABLED, note: text(row['备注']),
    activeBookings: active.length,
  };
}

function applicationSummary(row, rooms) {
  const room = rooms.find(item => item._id === text(row['场地ID']));
  return {
    id: row._id, code: `ROOM-${row._id}`, roomId: text(row['场地ID']),
    roomName: text(row['场地名称']) || room?.name || '未标注',
    applicant: text(row['申请人姓名']) || '未填写', applicantAccount: text(row['申请人账号']),
    start: text(row['开始时间']), end: text(row['结束时间']), purpose: text(row['用途']) || '未填写',
    status: text(row['状态']) || VENUE_APPLICATION_STATUS.PENDING,
    reviewer: text(row['审批人']) || '', reviewedAt: text(row['审批时间']) || '',
    rejectReason: text(row['不通过理由']) || '', note: text(row['备注']),
    submittedAt: text(row['提交时间']) || '',
    ended: Boolean(row['结束时间']) && text(row['结束时间']) < nowStamp(),
  };
}

export function createVenueService({ client, listRows, actor = '管理员', locks = new Map(), now = () => nowStamp() } = {}) {
  const list = async table => { try { return await listRows(table); } catch { fail(502, '数据服务读取失败，请稍后重试。', 'venue_storage_failed'); } };
  const append = async (table, row) => {
    let result;
    try { result = await client.appendRow(table, row); } catch { fail(502, '数据服务写入失败，请稍后重试。', 'venue_storage_failed'); }
    if (!result?._id) fail(502, '数据服务未确认记录结果，请核查后重试。', 'venue_storage_failed');
    return result;
  };
  const update = async (table, id, patch) => {
    let result;
    try { result = await client.updateRow(table, id, patch); } catch { fail(502, '数据服务更新失败，请稍后重试。', 'venue_storage_failed'); }
    if (result?.success === false || result?.updated_row_count === 0) fail(502, '数据服务未确认更新结果，请核查后重试。', 'venue_storage_failed');
    const rows = await list(table); assertCompleteRows(rows);
    const persisted = rows.find(row => row._id === id);
    const confirmed = persisted && Object.entries(patch).every(([key, value]) => String(persisted[key] ?? '') === String(value ?? ''));
    if (!confirmed) fail(502, '数据服务更新结果尚未确认，请刷新核查后重试。', 'venue_storage_failed');
    return result;
  };
  async function withLocks(keys, task) {
    const ordered = [...new Set(keys.filter(Boolean))].sort();
    async function acquire(index) {
      if (index === ordered.length) return task();
      const key = ordered[index], previous = locks.get(key) || Promise.resolve();
      let release; const current = new Promise(resolve => { release = resolve; }); locks.set(key, current);
      await previous;
      try { return await acquire(index + 1); } finally { release(); if (locks.get(key) === current) locks.delete(key); }
    }
    return acquire(0);
  }
  function actorName() { return typeof actor === 'function' ? actor() : actor; }

  async function bundle() {
    const [rooms, applications] = await Promise.all([list(VENUE_ROOM_TABLE), list(VENUE_APPLICATION_TABLE)]);
    assertCompleteRows(rooms, applications);
    return { rooms, applications };
  }

  async function rooms(enabledOnly = false) {
    const data = await bundle();
    const visible = enabledOnly ? data.rooms.filter(row => text(row['状态']) !== VENUE_ROOM_STATUS.DISABLED) : data.rooms;
    return { ok: true, integration: { status: VENUE_INTEGRATION_STATUS, external: null, note: '第三方「指间管理」尚未对接，占用日历仅在本平台内维护。' }, rooms: visible.map(row => roomSummary(row, data.applications)) };
  }

  async function listApplications(params = {}) {
    const get = key => text(typeof params.get === 'function' ? params.get(key) : params[key]);
    const data = await bundle();
    let rows = data.applications.slice().sort((a, b) => text(b['开始时间']).localeCompare(text(a['开始时间'])));
    if (get('status')) rows = rows.filter(row => text(row['状态']) === get('status'));
    if (get('roomId')) rows = rows.filter(row => text(row['场地ID']) === get('roomId'));
    if (get('q')) rows = rows.filter(row => [row['用途'], row['申请人姓名'], row['场地名称']].some(value => text(value).toLowerCase().includes(get('q').toLowerCase())));
    return { ok: true, applications: rows.map(row => applicationSummary(row, data.rooms)), total: rows.length };
  }

  async function calendar(params = {}) {
    const get = key => text(typeof params.get === 'function' ? params.get(key) : params[key]);
    const data = await bundle();
    let active = data.applications.filter(row => isOccupyingVenue(row['状态']));
    if (get('from')) active = active.filter(row => text(row['结束时间']) >= get('from'));
    if (get('to')) active = active.filter(row => text(row['开始时间']) <= get('to'));
    const bookings = active.map(row => applicationSummary(row, data.rooms)).sort((a, b) => a.start.localeCompare(b.start));
    return { ok: true, integration: { status: VENUE_INTEGRATION_STATUS, external: null }, rooms: data.rooms.map(row => roomSummary(row, data.applications)), bookings };
  }

  function validateTimes(body) {
    const start = text(body.start), end = text(body.end);
    if (!validTime(start) || !validTime(end)) fail(400, '借用时段应为 YYYY-MM-DD HH:mm 格式的完整时间');
    if (start >= end) fail(400, '结束时间必须晚于开始时间');
    return { start, end };
  }

  async function submitApplication(body, submitter) {
    const roomId = text(body.roomId);
    if (!roomId) fail(400, '请选择要借用的场地');
    const { start, end } = validateTimes(body);
    const purpose = text(body.purpose);
    if (!purpose || purpose.length > 200) fail(400, '用途应为 1 至 200 个字符');
    const note = text(body.note);
    if (note.length > 500) fail(400, '备注不能超过 500 个字符');
    return withLocks([`venue:${roomId}`], async () => {
      const data = await bundle();
      const room = data.rooms.find(row => row._id === roomId);
      if (!room) fail(404, '场地不存在');
      if (text(room['状态']) === VENUE_ROOM_STATUS.DISABLED) fail(409, '该场地已停用，暂不可借用');
      const conflict = data.applications.find(row => isOccupyingVenue(row['状态']) && text(row['场地ID']) === roomId && venueOverlap(start, end, text(row['开始时间']), text(row['结束时间'])));
      if (conflict) fail(409, `该时段与「${text(conflict['用途']) || '已有申请'}」冲突，请调整借用时间`);
      const name = submitter?.realName || text(submitter?.name) || '未填写';
      const account = submitter?.account || submitter?.id || '';
      const row = { '申请人姓名': name, '申请人账号': account, '场地ID': roomId, '场地名称': text(room['场地名称']), '开始时间': start, '结束时间': end, '用途': purpose, '状态': VENUE_APPLICATION_STATUS.PENDING, '备注': note, '提交时间': now() };
      const result = await append(VENUE_APPLICATION_TABLE, row);
      data.applications.push({ ...row, ...result });
      return { ok: true, application: applicationSummary({ ...row, ...result }, data.rooms), message: '申请已提交，等待审批。' };
    });
  }

  async function reviewApplication(id, { approve = false, reason = '' } = {}) {
    return withLocks([`venue:${id}`], async () => {
      const data = await bundle();
      const row = data.applications.find(item => item._id === id);
      if (!row) fail(404, '借用申请不存在');
      if (text(row['状态']) !== VENUE_APPLICATION_STATUS.PENDING) fail(409, '只能审批待审批的申请');
      let patch;
      if (approve) {
        const roomId = text(row['场地ID']);
        const conflict = data.applications.find(item => item._id !== id && isOccupyingVenue(item['状态']) && text(item['场地ID']) === roomId && venueOverlap(text(row['开始时间']), text(row['结束时间']), text(item['开始时间']), text(item['结束时间'])));
        if (conflict) fail(409, `审批通过前发现时段冲突：与「${text(conflict['用途']) || '已有申请'}」重叠`);
        patch = { '状态': VENUE_APPLICATION_STATUS.APPROVED, '审批人': actorName(), '审批时间': now(), '不通过理由': '' };
      } else {
        const reasonText = text(reason);
        if (!reasonText || reasonText.length > 200) fail(400, '不通过理由应为 1 至 200 个字符');
        patch = { '状态': VENUE_APPLICATION_STATUS.REJECTED, '审批人': actorName(), '审批时间': now(), '不通过理由': reasonText };
      }
      await update(VENUE_APPLICATION_TABLE, id, patch);
      return { ok: true, application: applicationSummary({ ...row, ...patch }, data.rooms), message: approve ? '申请已通过审批。' : '申请已拒绝。' };
    });
  }

  async function cancelApplication(id, actorRef, { admin = false } = {}) {
    return withLocks([`venue:${id}`], async () => {
      const data = await bundle();
      const row = data.applications.find(item => item._id === id);
      if (!row) fail(404, '借用申请不存在');
      const status = text(row['状态']);
      if (![VENUE_APPLICATION_STATUS.PENDING, VENUE_APPLICATION_STATUS.APPROVED].includes(status)) fail(409, '该申请当前状态不可取消');
      if (!admin && !['', text(row['申请人账号'])].includes(text(actorRef)) && text(row['申请人账号']) !== text(actorRef)) fail(403, '只能取消本人提交的申请');
      const patch = { '状态': VENUE_APPLICATION_STATUS.CANCELLED };
      await update(VENUE_APPLICATION_TABLE, id, patch);
      return { ok: true, application: applicationSummary({ ...row, ...patch }, data.rooms), message: '申请已取消。' };
    });
  }

  async function createRoom(body) {
    const name = text(body.name);
    if (!name || name.length > 120) fail(400, '场地名称应为 1 至 120 个字符');
    const location = text(body.location);
    if (location.length > 200) fail(400, '地点不能超过 200 个字符');
    const openTime = text(body.openTime), closeTime = text(body.closeTime);
    if ((openTime || closeTime) && !(openTime && closeTime && openTime < closeTime)) fail(400, '可借时段需同时填写开始与结束时间，且开始早于结束');
    const capacity = safeNumber(body.capacity);
    if (!Number.isSafeInteger(capacity) || capacity < 0) fail(400, '容量应为非负整数');
    const row = { '场地名称': name, '地点': location, '可借开始时间': openTime, '可借结束时间': closeTime, '容量': capacity, '状态': VENUE_ROOM_STATUS.ENABLED, '备注': text(body.note) };
    const result = await append(VENUE_ROOM_TABLE, row);
    return { ok: true, room: roomSummary({ ...row, ...result }, []), message: '场地已创建。' };
  }

  async function updateRoom(id, body) {
    return withLocks([`room:${id}`], async () => {
      const data = await bundle();
      const row = data.rooms.find(item => item._id === id);
      if (!row) fail(404, '场地不存在');
      const allowed = ['name', 'location', 'openTime', 'closeTime', 'capacity', 'status', 'note'];
      if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length || Object.keys(body).some(key => !allowed.includes(key))) fail(400, '仅允许修改场地名称、地点、可借时段、容量、状态与备注');
      const patch = {};
      if (Object.hasOwn(body, 'status')) {
        const status = text(body.status);
        if (![VENUE_ROOM_STATUS.ENABLED, VENUE_ROOM_STATUS.DISABLED].includes(status)) fail(400, '场地状态只能为启用或停用');
        patch['状态'] = status;
      }
      if (Object.hasOwn(body, 'capacity')) {
        const capacity = safeNumber(body.capacity);
        if (!Number.isSafeInteger(capacity) || capacity < 0) fail(400, '容量应为非负整数');
        patch['容量'] = capacity;
      }
      if (Object.hasOwn(body, 'name')) {
        const name = text(body.name);
        if (!name || name.length > 120) fail(400, '场地名称应为 1 至 120 个字符');
        patch['场地名称'] = name;
      }
      if (Object.hasOwn(body, 'location')) {
        const location = text(body.location);
        if (location.length > 200) fail(400, '地点不能超过 200 个字符');
        patch['地点'] = location;
      }
      if (Object.hasOwn(body, 'note')) patch['备注'] = text(body.note);
      if (Object.hasOwn(body, 'openTime') || Object.hasOwn(body, 'closeTime')) {
        const openTime = Object.hasOwn(body, 'openTime') ? text(body.openTime) : text(row['可借开始时间']);
        const closeTime = Object.hasOwn(body, 'closeTime') ? text(body.closeTime) : text(row['可借结束时间']);
        if (!(openTime && closeTime && openTime < closeTime)) fail(400, '可借时段需同时填写开始与结束时间，且开始早于结束');
        patch['可借开始时间'] = openTime;
        patch['可借结束时间'] = closeTime;
      }
      await update(VENUE_ROOM_TABLE, id, patch);
      return { ok: true, room: roomSummary({ ...row, ...patch }, data.applications), message: '场地已更新。' };
    });
  }

  return { rooms, listApplications, submitApplication, reviewApplication, cancelApplication, calendar, createRoom, updateRoom };
}

export { VENUE_ROOM_COLUMNS, VENUE_APPLICATION_COLUMNS, VENUE_ROOM_STATUS, VENUE_APPLICATION_STATUS };
