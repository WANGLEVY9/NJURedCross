import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { validateBirthdayCalendar, lunarDateOn, isBirthdayOn, birthdayCalendarSchemaReady } from '../lib/community/birthday-calendar.js';
import { planBirthdaySchema } from '../lib/community/birthday-schema.js';
import { inspectBirthdaySchema, BIRTHDAY_TABLE_NAMES } from '../lib/community/birthday-rollout.js';
import { notifyBlessingDelivered } from '../lib/community/author-notifications.js';
import { STATE_SCHEMA } from '../lib/production-schema.js';

test('calendar validates lunar days separately and rejects malformed calendars and dates', () => {
  assert.equal(validateBirthdayCalendar('02-30', 'lunar'), 'lunar');
  assert.equal(validateBirthdayCalendar('02-29'), 'solar');
  for (const [date, kind] of [['02-30', 'solar'], ['04-31', 'lunar'], ['13-01', 'lunar'], ['00-01', 'lunar'], ['01-00', 'lunar'], ['1-1', 'lunar'], ['01-01', 'other'], ['01-01', {}]]) {
    assert.throws(() => validateBirthdayCalendar(date, kind), { statusCode: 400 });
  }
});

test('HKO data matches known new years and mid-autumn dates throughout the bounded range', () => {
  for (const date of ['2026-02-17', '2027-02-06', '2028-01-26', '2029-02-13', '2030-02-03']) {
    assert.equal(isBirthdayOn({ birthdayCalendar: 'lunar', birthdayMonthDay: '01-01' }, date), true, date);
  }
  assert.equal(isBirthdayOn({ birthdayCalendar: 'lunar', birthdayMonthDay: '08-15' }, '2026-09-25'), true);
  for (const date of ['2025-12-31', '2031-01-01', '2026-02-30', '2026-2-17', 'bad']) assert.equal(lunarDateOn(date), null);
  assert.equal(isBirthdayOn({ birthdayCalendar: 'lunar', birthdayMonthDay: '01-01' }, '2031-01-01'), false);
  assert.equal(isBirthdayOn({ birthdayMonthDay: '01-01' }, '2031-01-01'), true);
});

test('a thirty-day birthday uses the 29th of short months and never duplicates in leap months', () => {
  const member = { birthdayCalendar: 'lunar', birthdayMonthDay: '05-30' };
  assert.deepEqual(lunarDateOn('2028-06-23'), { month: 5, day: 1, leap: true, days: 29 });
  assert.equal(isBirthdayOn(member, '2028-06-22'), true);
  assert.equal(isBirthdayOn(member, '2028-07-21'), false);
  assert.equal(isBirthdayOn({ birthdayCalendar: 'lunar', birthdayMonthDay: '02-30' }, '2026-04-16'), true);
  assert.equal(isBirthdayOn({ birthdayCalendar: 'lunar', birthdayMonthDay: '02-30' }, '2026-04-15'), false);
  assert.equal(isBirthdayOn({ birthdayMonthDay: '02-17' }, '2026-02-17'), true);
  assert.equal(isBirthdayOn({ birthdayCalendar: 'corrupt', birthdayMonthDay: '02-17' }, '2026-02-17'), false);
});

test('all ordinary lunar birthdays occur exactly once per complete downloaded lunar year', () => {
  for (const [start, end] of [['2026-02-17', '2027-02-06'], ['2027-02-06', '2028-01-26'], ['2028-01-26', '2029-02-13'], ['2029-02-13', '2030-02-03']]) {
    const hits = new Map();
    for (let stamp = Date.parse(start); stamp < Date.parse(end); stamp += 86400000) {
      const date = new Date(stamp).toISOString().slice(0, 10);
      const lunar = lunarDateOn(date);
      if (lunar.leap) continue;
      for (const day of new Set([lunar.day, ...(lunar.day === 29 && lunar.days === 29 ? [30] : [])])) {
        const monthDay = `${String(lunar.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        assert.equal(isBirthdayOn({ birthdayCalendar: 'lunar', birthdayMonthDay: monthDay }, date), true);
        hits.set(monthDay, (hits.get(monthDay) || 0) + 1);
      }
    }
    assert.equal(hits.size, 360, start);
    assert.ok([...hits.values()].every(count => count === 1));
  }
});

const metadata = () => ({ tables: STATE_SCHEMA.filter(table => BIRTHDAY_TABLE_NAMES.includes(table.name)).map(table => ({ name: table.name, columns: table.columns.map(name => ({ name, type: 'text' })) })) });
test('migration adds calendar field while legacy birthday readiness remains available', () => {
  const old = metadata();
  old.tables[0].columns = old.tables[0].columns.filter(column => column.name !== '生日历法');
  assert.equal(inspectBirthdaySchema(old).ready, true);
  assert.equal(birthdayCalendarSchemaReady(old), false);
  assert.deepEqual(planBirthdaySchema(old)[0].columns, ['生日历法']);
  const full = metadata();
  assert.equal(birthdayCalendarSchemaReady(full), true);
  full.tables[0].columns.find(column => column.name === '生日历法').type = 'number';
  assert.equal(birthdayCalendarSchemaReady(full), false);
  assert.throws(() => planBirthdaySchema(full), /type_mismatch/);
});

const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
function enrollmentHarness({ schemaReady = true, owner = 'ACC-1', calendar = 'lunar' } = {}) {
  const writes = [];
  const row = { 登记ID: 'WARM-1', 来源: '官网', 项目: 'birthday', 参与者标识: owner, 状态: '已确认', 生日历法: calendar };
  const context = vm.createContext({
    requirePortalWrite: () => ({ username: 'writer' }), businessAccountRef: () => 'ACC-1',
    enforcePublicLimit() {}, readJsonObject: async req => req.body, cleanText: value => value,
    accountsByUsername: new Map([['writer', { email: 'writer@example.test' }]]),
    assertPublicEmail: value => value, WARMTH_CAMPUS_OPTIONS: ['鼓楼'],
    validateBirthdayCalendar, birthdayCalendarSchemaReady,
    httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode }),
    json: (_res, status, body) => ({ status, body }),
    withWarmthLock: async (_client, _key, fn) => fn(), isWarmthBlacklisted: async () => false,
    readWarmthInterests: async () => [], readEnrollmentRows: async () => [row],
    isActiveEnrollmentStatus: status => status === '已确认', isConfirmedEnrollmentStatus: status => status === '已确认',
    saveEnrollment: async (_client, _id, patch) => writes.push(patch), updateEnrollment: async (_client, _id, patch) => writes.push(patch),
    portalEnrollmentSource: '官网', enrollmentStatusConfirmed: '已确认', enrollmentStatusPending: '待人工确认',
    eventIdentifier: () => 'WARM-NEW', recordAudit: async () => {},
    client: { getMetadata: async () => schemaReady ? metadata() : { tables: [] } },
  });
  const helper = source.slice(source.indexOf('async function birthdayCalendarPatch('), source.indexOf('async function readWarmthInterests('));
  const block = source.slice(source.lastIndexOf("  if (req.method === 'POST' && url.pathname === '/api/public/warmth/interest')"), source.indexOf('  const warmthInterestWithdraw'));
  vm.runInContext(`${helper}\nglobalThis.route = async (req, res, url) => { ${block} };`, context);
  return { writes, route: (body, update = false) => context.route({ method: 'POST', body: { program: 'birthday', consent: true, campus: '鼓楼', birthdayMonthDay: '02-30', ...body } }, {}, new URL(update ? '/api/public/warmth/interests/WARM-1/update' : '/api/public/warmth/interest', 'https://test')) };
}

test('join and update persist lunar choice and updates preserve omitted calendar without weakening ownership', async () => {
  for (const update of [false, true]) {
    const h = enrollmentHarness();
    const result = await h.route({ birthdayCalendar: 'lunar' }, update);
    assert.ok([200, 201].includes(result.status));
    assert.equal(h.writes[0].生日历法, 'lunar');
    assert.equal(h.writes[0].生日月日, '02-30');
  }
  const preserved = enrollmentHarness();
  assert.equal((await preserved.route({}, true)).status, 200);
  assert.equal(preserved.writes[0].生日历法, 'lunar');
  const other = enrollmentHarness({ owner: 'OTHER' });
  assert.equal((await other.route({ birthdayCalendar: 'lunar' }, true)).status, 403);
  assert.equal(other.writes.length, 0);
});

test('missing optional schema rejects lunar writes but allows legacy solar registration', async () => {
  for (const update of [false, true]) {
    const h = enrollmentHarness({ schemaReady: false });
    await assert.rejects(h.route({ birthdayCalendar: 'lunar' }, update), { statusCode: 503 });
    assert.equal(h.writes.length, 0);
    assert.ok([200, 201].includes((await h.route({ birthdayMonthDay: '02-28', birthdayCalendar: 'solar' }, update)).status));
    assert.equal('生日历法' in h.writes[0], false);
  }
});

test('birthday delivery selects lunar members by Shanghai date and remains idempotent', async () => {
  const deliveries = [], mails = [], sentKeys = new Set();
  const library = [{ id: 'LIB-1', submissionId: 'CARE-1', content: '生日快乐', nickname: '朋友', submitter: 'other', category: '祝福仓库', status: '可用' }];
  const { birthdayDeliveryQuota } = await import('../lib/community/birthday-delivery.js');
  const context = vm.createContext({
    shanghaiMonthDay: date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date).slice(5),
    shanghaiYear: date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date).slice(0, 4),
    isBirthdayOn, birthdayDeliveryQuota,
    notifyBlessingDelivered, communityNoticeAccount: async () => ({ email: "author@example.test" }), publicBaseUrl: "https://example.test",
    readWarmthInterests: async () => [{ participantRef: 'ACC-1', program: 'birthday', status: '已确认', birthdayCalendar: 'lunar', birthdayMonthDay: '01-01' }],
    readBlessingLibrary: async () => library, warmthRows: async (_client, name) => name === 'deliveries' ? deliveries : [],
    readWarmthBlacklist: async () => [], BLACKLIST_ACTIVE: '生效',
    isConfirmedEnrollmentStatus: status => status === '已确认',
    accountByBusinessRef: () => ({ studentId: 'SID-1', username: 'recipient', email: 'recipient@example.test' }),
    blessingDeliveryTable: 'deliveries', blessingLibraryTable: 'library', LIBRARY_STATUS_ACTIVE: '可用',
    LIBRARY_CATEGORY_RANDOM: '一对一随机', DELIVERY_SITE_DONE: '已投递', pickRandom: (items, size) => items.slice(0, size),
    sendMail: async message => { if (!sentKeys.has(message.idempotencyKey)) { mails.push(message); sentKeys.add(message.idempotencyKey); } return { ok: true, transport: "smtp" }; }, eventIdentifier: () => 'DLV-1',
  });
  const block = source.slice(source.indexOf('async function runWarmthBirthdayDeliveryUnlocked('), source.indexOf('/**\n * v3 文创类型字典'));
  vm.runInContext(`${block}\nglobalThis.run = runWarmthBirthdayDeliveryUnlocked;`, context);
  const client = { appendRow: async (_table, row) => deliveries.push(row), updateRow: async () => {} };
  assert.equal((await context.run(client, { now: new Date('2026-02-16T15:59:00Z') })).delivered, 0);
  assert.equal((await context.run(client, { now: new Date('2026-02-17T00:00:00Z') })).delivered, 1);
  assert.equal((await context.run(client, { now: new Date('2026-02-17T01:00:00Z') })).delivered, 0);
  assert.equal(mails.length, 2);
  assert.equal(mails[1].to, "author@example.test");
  assert.ok(!mails[1].text.includes("recipient@example.test"));
  assert.equal(deliveries[0].触发日期, '02-17');
});
