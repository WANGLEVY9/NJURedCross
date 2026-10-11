import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MORNING_TAG_TABLE,
  ensureMorningTags,
  listMorningTags,
  morningTagRoutes,
  normalizeMorningTag,
} from '../lib/morning/tags.js';

function row(overrides = {}) {
  return {
    _id: 'tag-1',
    标签ID: 'MNG-TAG-1',
    标签: '攀岩',
    来源账号ID: 'ACC-1',
    状态: '启用',
    创建时间: '2026-10-09T00:00:00.000Z',
    更新时间: '2026-10-09T00:00:00.000Z',
    ...overrides,
  };
}

function harness(rows = []) {
  const res = { statusCode: 0, payload: null };
  const audits = [];
  const client = {
    async appendRow(table, value) {
      assert.equal(table, MORNING_TAG_TABLE);
      rows.push({ ...value, _id: `tag-${rows.length + 1}` });
    },
  };
  const ctx = {
    getBase: async () => client,
    listRows: async (_client, table) => {
      assert.equal(table, MORNING_TAG_TABLE);
      return rows;
    },
    assertCompleteRows: () => {},
    readJsonObject: async () => ({ tag: '攀岩' }),
    requirePortalSession: () => ({ username: 'local-member', role: 'member' }),
    requirePortalWrite: () => ({ username: 'local-member', role: 'member' }),
    actor: () => 'ACC-1',
    recordAudit: (...args) => audits.push(args),
    json: (response, statusCode, payload) => {
      response.statusCode = statusCode;
      response.payload = payload;
      return payload;
    },
  };
  return { ctx, res, rows, audits };
}

test('早安晚安标签词条规范校验', () => {
  assert.equal(normalizeMorningTag(' 攀岩 '), '攀岩');
  assert.throws(() => normalizeMorningTag(''), /不能为空/);
  assert.throws(() => normalizeMorningTag('这个标签名称过长过长过长过长过长过'), /不能超过/);
});

test('早安晚安标签列表合并预设与词条库', async () => {
  const tags = await listMorningTags({}, async () => [row(), row({ _id: 'tag-2', 标签: '摄影' })]);
  assert.ok(tags.includes('摄影'));
  assert.ok(tags.includes('攀岩'));
  assert.equal(tags.filter((tag) => tag === '摄影').length, 1);
});

test('早安晚安新建标签写入词条库且去重', async () => {
  const rows = [row()];
  const client = { appendRow: async (_table, value) => rows.push({ ...value, _id: 'tag-2' }) };
  await ensureMorningTags(client, ['攀岩', '攀岩', '攀冰'], 'ACC-1', async () => rows);
  assert.equal(rows.filter((item) => item['标签'] === '攀岩').length, 1);
  assert.equal(rows.filter((item) => item['标签'] === '攀冰').length, 1);
});

test('早安晚安标签接口支持读取与新建', async () => {
  const getState = harness();
  await morningTagRoutes({ method: 'GET' }, getState.res, new URL('http://example.test/api/morning/tags'), getState.ctx);
  assert.equal(getState.res.statusCode, 200);
  assert.ok(getState.res.payload.tags.includes('摄影'));

  const postState = harness();
  await morningTagRoutes({ method: 'POST' }, postState.res, new URL('http://example.test/api/morning/tags'), postState.ctx);
  assert.equal(postState.res.statusCode, 201);
  assert.equal(postState.rows[0]['标签'], '攀岩');
  assert.equal(postState.audits[0][2], 'morning.tag.ensure');
});
