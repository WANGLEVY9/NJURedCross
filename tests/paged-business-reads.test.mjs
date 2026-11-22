import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { listActivityNames } from '../lib/attachment/activities.js';

function rows(total, prefix = 'row') {
  return Array.from({ length: total }, (_, index) => ({
    _id: `${prefix}-${index}`,
    活动名称: `Synthetic activity ${index}`,
    中心: '生命中心',
    状态: '报名中',
  }));
}

test('activity candidates read every page and fail closed on truncation', async () => {
  const source = rows(2001);
  const client = {
    listRows: async (_table, _view, _order, _desc, start = 0, limit = 1_000) =>
      source.slice(start, start + limit).map(row => ({ ...row })),
  };
  const names = await listActivityNames({ getBase: async () => client, tables: { project: 'projects' } });
  assert.equal(names.length, 2001);
  assert.equal(names.at(-1).name, 'Synthetic activity 2000');

  const overflow = rows(20_001);
  const truncated = {
    listRows: async (_table, _view, _order, _desc, start = 0, limit = 1_000) =>
      overflow.slice(start, start + limit).map(row => ({ ...row })),
  };
  await assert.rejects(
    listActivityNames({ getBase: async () => truncated, tables: { project: 'projects' } }),
    { code: 'incomplete_operational_data' },
  );
});

test('task and activity modules no longer request a single 2,000-row page', async () => {
  for (const file of ['lib/attachment/tasks.js', 'lib/attachment/activities.js']) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /listRows\([^)]*2000\)/);
    assert.match(source, /readPagedRows/);
  }
});
