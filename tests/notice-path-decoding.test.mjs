import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsOpsRoutes } from '../lib/events/api.js';
import { NOTICE_TABLE } from '../lib/events/notice.js';

function fixture(ids) {
  const rows = ids.map((id, index) => ({
    _id: `synthetic-row-${index}`,
    通知ID: id,
    状态: '草稿',
  }));
  const writes = [];
  const audits = [];

  const client = {
    async listRows(table, _view, _order, _direction, start, limit) {
      assert.equal(table, NOTICE_TABLE);
      return rows.slice(start, start + limit);
    },
    async updateRow(table, id, patch) {
      writes.push({ table, id, patch });
    },
  };

  const ctx = {
    requireConsoleAccess(_req, _res, scope) {
      assert.equal(scope, 'events');
      return { username: 'synthetic-admin' };
    },
    requireCsrf: () => true,
    getBase: async () => client,
    recordAudit: async (_req, _session, action, id) => {
      audits.push({ action, id });
    },
    json: (_res, status, body) => ({ status, body }),
  };

  return {
    rows,
    writes,
    audits,
    publish(id) {
      return eventsOpsRoutes(
        { method: 'POST', headers: {} },
        null,
        new URL(
          `http://localhost/api/event-notices/${encodeURIComponent(id)}/publish`,
        ),
        ctx,
      );
    },
  };
}

test('notice IDs containing a literal percent sign can be published', async () => {
  const f = fixture(['notice%']);
  const result = await f.publish('notice%');

  assert.equal(result.status, 200);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].id, f.rows[0]._id);
  assert.equal(f.writes[0].patch.状态, '已发布');
  assert.equal(f.audits[0].id, 'notice%');
});

test('encoded-looking IDs cannot be decoded again into another notice', async () => {
  const f = fixture(['notice%41', 'noticeA']);
  const result = await f.publish('notice%41');

  assert.equal(result.status, 200);
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].id, f.rows[0]._id);
  assert.notEqual(f.writes[0].id, f.rows[1]._id);
  assert.equal(f.audits[0].id, 'notice%41');
});

test('ordinary and Chinese notice IDs retain publication behavior', async () => {
  for (const id of ['notice-normal', '合成通知']) {
    const f = fixture([id]);
    const result = await f.publish(id);

    assert.equal(result.status, 200);
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].id, f.rows[0]._id);
    assert.equal(f.audits[0].id, id);
  }
});