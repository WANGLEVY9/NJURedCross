import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../server.js', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');

function functionSource(name) {
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

function fixture({ view = 'active', aggregationError = null } = {}) {
  const calls = [];
  const rows = [
    {
      _id: 'row-1',
      投稿ID: 'CARE-1',
      项目: 'birthday',
      内容: '生日快乐',
      语气: '温暖',
      提交人: 'author',
      状态: '待审核',
      提交时间: '2026-11-06T00:00:00.000Z',
    },
  ];
  const context = vm.createContext({
    COMMUNITY_SUBMISSION_VIEW_STATUSES: {
      active: ['待审核'],
      revision: ['需修改'],
      approved: ['已通过'],
      rejected: ['已拒绝'],
    },
    communitySubmissionTable: '温暖连接投稿表',
    submissionStatusPending: '待审核',
    submissionStatusApproved: '已通过',
    submissionStatusReturned: '需修改',
    submissionStatusRejected: '已拒绝',
    displayRead: async (_client, _key, load) => load(),
    scopedWarmthRows: async (_client, _table, filter) => {
      calls.push(['scoped', filter]);
      if (filter['投稿ID']) {
        const ids = Array.isArray(filter['投稿ID']) ? filter['投稿ID'] : [filter['投稿ID']];
        return rows.filter(row => ids.includes(row['投稿ID']));
      }
      return rows.filter(row => filter['状态'].includes(row['状态']));
    },
    warmthRows: async () => {
      calls.push(['full']);
      return rows;
    },
    readCommunityStatusCounts: async () => {
      calls.push(['counts']);
      if (aggregationError) throw aggregationError;
      return { 待审核: 1, 已通过: 2, 需修改: 3, 已拒绝: 4 };
    },
    readCommunitySubmissions: null,
    httpError: (statusCode, message) => Object.assign(new Error(message), { statusCode }),
    reviewFromRow: () => null,
    byDateDesc: field => (left, right) => String(right[field] || '').localeCompare(String(left[field] || '')),
  });
  for (const name of [
    'readCommunitySubmissions',
    'communitySubmissionStatsFromCounts',
    'communitySubmissionStatsFromRows',
    'readCommunitySubmissionStats',
    'readCommunitySubmissionById',
  ]) {
    vm.runInContext(functionSource(name), context);
  }
  return { context, calls, rows, view };
}

test('admin review views query only the requested status', async () => {
  const f = fixture();
  const submissions = await f.context.readCommunitySubmissions({}, { view: f.view });
  assert.equal(submissions.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [['scoped', { 状态: ['待审核'] }]]);
  await assert.rejects(
    f.context.readCommunitySubmissions({}, { view: 'unknown' }),
    { statusCode: 400 },
  );
});

test('review lookup reads only the requested submission ID', async () => {
  const f = fixture();
  const submission = await f.context.readCommunitySubmissionById({}, 'CARE-1');
  assert.equal(submission._id, 'row-1');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [['scoped', { 投稿ID: 'CARE-1' }]]);
});

test('review totals come from aggregate counts without a full-table read', async () => {
  const f = fixture();
  assert.deepEqual(JSON.parse(JSON.stringify(await f.context.readCommunitySubmissionStats({}))), {
    total: 10,
    pending: 1,
    returned: 3,
    approved: 2,
    rejected: 4,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [['counts']]);
});

test('aggregate failure preserves exact totals with a bounded full-read fallback', async () => {
  const f = fixture({ aggregationError: new Error('unsupported aggregate') });
  assert.deepEqual(JSON.parse(JSON.stringify(await f.context.readCommunitySubmissionStats({}))), {
    total: 1,
    pending: 1,
    returned: 0,
    approved: 0,
    rejected: 0,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [['counts'], ['full']]);
});
