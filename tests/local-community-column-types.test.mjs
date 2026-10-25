import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { localCommunityColumnType } from '../scripts/local-community-column-types.mjs';

const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve('seatable-api'));
const { formatQueryResult } = sdkRequire('./utils');

test('local birthday lease retains its full expiry through the installed SDK', () => {
  const expiry = '2026-10-24T13:25:30.123Z';
  const queryResult = type => formatQueryResult({
    metadata: [{ key: 'expiry', name: '过期时间', type, data: {} }],
    results: [{ _id: 'local-lock', expiry }],
  });
  assert.equal(queryResult('date')[0]['过期时间'], '2026-10-24');
  const type = localCommunityColumnType('温暖连接操作锁表', '过期时间', 'date');
  const result = queryResult(type)[0];
  assert.equal(result['过期时间'], expiry);
  assert.ok(Date.parse(result['过期时间']) > Date.parse('2026-10-24T13:24:00Z'));
});

test('local morning timestamps and revision numbers follow the declared text schema', () => {
  assert.equal(localCommunityColumnType('早安晚安邀约表', '过期时间', 'date'), 'text');
  assert.equal(localCommunityColumnType('早安晚安名片表', '发布时间', 'date'), 'text');
  assert.equal(localCommunityColumnType('早安晚安名片修订表', '版本号', 'number'), 'text');
  assert.equal(localCommunityColumnType('温暖连接参加表', '提交时间', 'date'), 'text');
  assert.equal(localCommunityColumnType('其他业务表', '开始时间', 'date'), 'date');
});
