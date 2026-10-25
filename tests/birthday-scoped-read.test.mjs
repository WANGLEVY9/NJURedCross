import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { readCommunityRows } from '../lib/community/scoped-rows.js';

const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
function functionSource(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

function harness(studentId = 'SID-1') {
  const queries = [];
  const tables = {
    温暖祝福投递表: [
      { _id: 'd1', 投递ID: 'D1', 投稿ID: 'CARE-1', 收件人学号: 'SID-1', 收件人标识: 'ACC-1', 站内状态: '已投递', 投递时间: '2026-10-24' },
      { _id: 'd2', 投递ID: 'D2', 投稿ID: 'CARE-2', 收件人学号: 'SID-OTHER', 收件人标识: 'ACC-OTHER', 站内状态: '已投递' },
    ],
    温暖祝福库表: [
      { _id: 'l1', 入库ID: 'L1', 投稿ID: 'CARE-1', 内容: '给你的祝福', 署名昵称: '朋友', 来源投稿人: 'author', 状态: '作者已删除', 分类: '一对一随机' },
      { _id: 'l2', 入库ID: 'L2', 投稿ID: 'CARE-2', 内容: '其他人的私密祝福', 来源投稿人: 'other' },
    ],
    温暖祝福举报表: [
      { _id: 'r1', 举报ID: 'R1', 投稿ID: 'CARE-1', 举报人标识: 'ACC-1', 状态: '已处理', 处理意见: '已核对' },
      { _id: 'r2', 举报ID: 'R2', 投稿ID: 'CARE-1', 举报人标识: 'ACC-OTHER', 原因: '他人的举报' },
    ],
    温暖连接投稿表: [{ _id: 's1', 投稿ID: 'CARE-1', 项目: 'birthday', 提交人: 'author', 提交时间: '2026-10-23', 状态: '已通过' }],
    温暖连接参加表: [
      { _id: 'e1', 登记ID: 'E1', 来源: '官网', 项目: 'birthday', 参与者标识: 'OLD-SID-AUTHOR', 校区: '苏州', 昵称: '朋友' },
      { _id: 'e2', 登记ID: 'E2', 来源: '官网', 项目: 'birthday', 参与者标识: 'ACC-1', 昵称: '公开收件昵称' },
    ],
  };
  const accounts = new Map([
    ['viewer', { accountId: 'ACC-1', username: 'viewer', studentId, realName: '本人' }],
    ['author', { accountId: 'ACC-AUTHOR', username: 'author', studentId: 'OLD-SID-AUTHOR' }],
  ]);
  const client = { query: async sql => {
    queries.push(sql);
    const name = sql.match(/FROM `([^`]+)`/)[1];
    assert.ok(tables[name], name);
    assert.ok(sql.includes(' WHERE '));
    const predicates = [...sql.matchAll(/`([^`]+)` IN \(([^)]+)\)/g)].map(([, field, values]) =>
      [field, [...values.matchAll(/'([^']*)'/g)].map(match => match[1])]);
    return tables[name].filter(row => predicates.every(([field, values]) => values.includes(String(row[field] || ''))));
  } };
  const failScan = () => { throw Error('unexpected full-table read'); };
  const context = vm.createContext({
    readCommunityRows, loadAllRows: failScan, warmthRows: failScan, warmthStateMaxRows: () => 20000,
    accountsByUsername: accounts, accountByBusinessRef: ref => [...accounts.values()].find(a => [a.accountId, a.username, a.studentId].includes(ref)),
    communitySubmissionTable: '温暖连接投稿表', communityEnrollmentTable: '温暖连接参加表',
    blessingLibraryTable: '温暖祝福库表', blessingDeliveryTable: '温暖祝福投递表', blessingReportTable: '温暖祝福举报表',
    portalEnrollmentSource: '官网', submissionStatusPending: '待审核', WARMTH_DELIVERY_READY: '可投递', WARMTH_DELIVERY_KEYS: {},
    DELIVERY_SITE_DONE: '已投递', LIBRARY_STATUS_ACTIVE: '在库', LIBRARY_STATUS_WITHDRAWN: '已撤下',
    LIBRARY_CATEGORY_RANDOM: '一对一随机', LIBRARY_CATEGORY_SENT: '一对一已发过的', LIBRARY_CATEGORY_OFFLINE: '已下线的',
    REPORT_STATUS_PENDING: '待处理',
    byDateDesc: field => (a, b) => String(b[field] || '').localeCompare(String(a[field] || '')),
    shanghaiOriginLabel: value => value,
    businessAccountRef: session => accounts.get(session.username).accountId,
    requirePortalSession: () => ({ username: 'viewer' }),
    json: (_res, status, body) => ({ status, body }), client,
  });
  for (const name of ['scopedWarmthRows', 'readWarmthDeliveries', 'readBlessingLibrary', 'readWarmthReports', 'readWarmthInterests', 'readEnrollmentRows', 'readWarmthBlessings']) {
    vm.runInContext(functionSource(name), context);
  }
  function route(path) {
    const start = source.indexOf(`  if (req.method === 'GET' && url.pathname === '${path}')`);
    assert.ok(start >= 0);
    const block = source.slice(start, source.indexOf('\n  }', start) + 4);
    vm.runInContext(`globalThis.run = async function(req, res, url) { const client = globalThis.client; ${block} };`, context);
    return context.run({ method: 'GET' }, {}, new URL('http://test' + path));
  }
  return { route, queries, context, tables };
}

test('received blessings query recipient first, then linked IDs and author aliases only', async () => {
  const h = harness();
  const result = await h.route('/api/public/warmth/blessings/delivered');
  assert.equal(result.status, 200);
  assert.equal(result.body.blessings.length, 1);
  assert.equal(result.body.blessings[0].senderCampus, '苏州');
  assert.equal(result.body.blessings[0].content, '给你的祝福');
  assert.equal(result.body.blessings[0].withdrawn, false, 'author deletion retains received content');
  assert.equal(result.body.blessings[0].reportStatus, '已处理');
  assert.equal(JSON.stringify(result).includes('其他人'), false);
  assert.equal(JSON.stringify(result).includes('他人的举报'), false);
  assert.equal(h.queries.length, 5);
  assert.match(h.queries[0], /`收件人学号` IN \('SID-1'\)/);
  assert.equal(h.queries.filter(sql => sql.includes('FROM `温暖祝福投递表`')).length, 1);
  for (const sql of h.queries.slice(1, 4)) assert.match(sql, /`投稿ID` IN \('CARE-1'\)/);
});

test('missing student ID and empty inbox perform no unrelated reads', async () => {
  const missing = harness('');
  assert.equal((await missing.route('/api/public/warmth/blessings/delivered')).body.blessings.length, 0);
  assert.equal(missing.queries.length, 0);
  const empty = harness('SID-NONE');
  assert.equal((await empty.route('/api/public/warmth/blessings/delivered')).body.blessings.length, 0);
  assert.equal(empty.queries.length, 1);
});

test('sent blessings retain recipient nickname privacy while scoping all three reads', async () => {
  const h = harness();
  h.context.requirePortalSession = () => ({ username: 'author' });
  const result = await h.route('/api/public/warmth/blessings/sent');
  assert.equal(result.status, 200);
  assert.equal(result.body.sent.length, 1);
  assert.equal(JSON.stringify(result).includes('SID-'), false);
  assert.equal(JSON.stringify(result).includes('本人'), false);
  assert.equal(h.queries.length, 3);
  assert.match(h.queries[0], /`来源投稿人` IN \('author'\)/);
  assert.match(h.queries[1], /`投稿ID` IN \('CARE-1'\)/);
  assert.match(h.queries[2], /`参与者标识` IN \('ACC-1'\)/);
});
