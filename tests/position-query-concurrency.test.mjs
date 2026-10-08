import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflow, WF } from '../lib/events/workflow.js';

function fixture(count, queryResult) {
  const sourceRows = Array.from({ length: count }, (_, index) => ({
    _id: `synthetic-position-${index}`,
    日期: '2026-10-12',
    点位: '新街口中央',
    活动时间: '上午 11~15点',
    周次: 46,
    学号: String(999990001 + index),
    姓名: `合成成员${index}`,
    邮箱: `source-${index}@example.test`,
    报名结果: '成功',
  }));

  const tables = Object.fromEntries(
    Object.values(WF).map(table => [table, []]),
  );
  tables['synthetic-source'] = sourceRows;

  const stats = { active: 0, peak: 0, queries: 0, writes: 0 };

  const base = {
    async listRows(table, _view, _order, _direction, start, limit) {
      return structuredClone((tables[table] || []).slice(start, start + limit));
    },
    async query(sql) {
      const match = sql.match(/WHERE `学号` = '(\d+)' LIMIT 3$/);
      assert.ok(match);
      const source = sourceRows.find(row => row.学号 === match[1]);
      assert.ok(source);

      stats.queries++;
      stats.active++;
      stats.peak = Math.max(stats.peak, stats.active);

      try {
        await new Promise(resolve => setImmediate(resolve));

        return queryResult
          ? queryResult(source)
          : [{
            _id: `synthetic-profile-${source.学号}`,
            学号: source.学号,
            姓名: source.姓名,
            院系: '合成院系',
          }];
      } finally {
        stats.active--;
      }
    },
    async appendRow() {
      stats.writes++;
      throw new Error('Unexpected synthetic write');
    },
    async updateRow() {
      stats.writes++;
      throw new Error('Unexpected synthetic write');
    },
  };

  const workflow = createWorkflow(base, {
    bloodSourceTable: 'synthetic-source',
    now: () => Date.parse('2026-10-06T00:00:00+08:00'),
  });

  return {
    stats,
    sourceRows,
    async positions() {
      const event = (await workflow.publicRead()).events[0];
      assert.ok(event);
      return workflow.positions(event._id);
    },
  };
}

test('actual position reads bound queries to four and preserve order', async () => {
  const f = fixture(12);
  const positions = await f.positions();

  assert.equal(f.stats.peak, 4);
  assert.equal(f.stats.active, 0);
  assert.equal(f.stats.queries, 12);
  assert.equal(f.stats.writes, 0);

  assert.deepEqual(
    positions.map(position => position.position),
    Array.from({ length: 12 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    positions.map(position => position.profile.学号),
    f.sourceRows.map(row => row.学号),
  );
  assert.ok(positions.every(position => position.profile.院系 === '合成院系'));
});

test('truncated query results fail without admitting the remaining positions', async () => {
  const f = fixture(12, () => {
    const rows = [];
    Object.defineProperty(rows, 'readMeta', {
      value: { truncated: true },
    });
    return rows;
  });

  await assert.rejects(
    f.positions(),
    error => error.code === 'profile_query_unavailable',
  );

  assert.ok(f.stats.queries <= 4);
  assert.equal(f.stats.active, 0);
  assert.equal(f.stats.writes, 0);
});

test('name mismatch cannot replace the source participant profile', async () => {
  const f = fixture(1, source => [{
    _id: 'synthetic-other-profile',
    学号: source.学号,
    姓名: '其他合成成员',
    邮箱: 'other-private@example.test',
  }]);

  const positions = await f.positions();

  assert.equal(positions[0].profile.姓名, f.sourceRows[0].姓名);
  assert.equal(positions[0].profile.邮箱, f.sourceRows[0].邮箱);
  assert.equal(JSON.stringify(positions).includes('other-private'), false);
  assert.equal(f.stats.writes, 0);
});

test('ambiguous profiles do not replace source participant fields', async () => {
  const f = fixture(1, source => [
    {
      _id: 'synthetic-profile-one',
      学号: source.学号,
      姓名: source.姓名,
      邮箱: 'ambiguous-one@example.test',
    },
    {
      _id: 'synthetic-profile-two',
      学号: source.学号,
      姓名: source.姓名,
      邮箱: 'ambiguous-two@example.test',
    },
  ]);

  const positions = await f.positions();

  assert.equal(positions[0].profile.邮箱, f.sourceRows[0].邮箱);
  assert.equal(JSON.stringify(positions).includes('ambiguous-'), false);
  assert.equal(f.stats.writes, 0);
});