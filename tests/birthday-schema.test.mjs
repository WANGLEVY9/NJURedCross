import test from 'node:test';
import assert from 'node:assert/strict';
import { STATE_SCHEMA } from '../lib/production-schema.js';
import { BIRTHDAY_TABLE_NAMES } from '../lib/community/birthday-rollout.js';
import { planBirthdaySchema } from '../lib/community/birthday-schema.js';
const full = () => ({ tables: STATE_SCHEMA.filter(table => BIRTHDAY_TABLE_NAMES.includes(table.name)).map(table => ({ name: table.name, columns: table.columns.map(name => ({ name, type: 'text' })) })) });
const legacy = () => { const metadata = full(); metadata.tables = metadata.tables.slice(0, 2); metadata.tables[1].columns = metadata.tables[1].columns.slice(0, 11); return metadata; };

test('production migration plans only five birthday tables and five authorized extensions', () => {
  const plan = planBirthdaySchema(legacy());
  assert.equal(plan.filter(item => item.create).length, 5);
  assert.deepEqual(plan[0].columns, []);
  assert.deepEqual(plan[1].columns, ['署名昵称', '投递方式', '目标学号', '投递条件', '附件']);
  assert.equal(plan.some(item => item.name.includes('活动')), false);
});
test('schema is idempotent and does not overwrite extra existing columns', () => {
  const metadata = full(); metadata.tables[0].columns.push({ name: '管理员备注', type: 'long-text' });
  assert.ok(planBirthdaySchema(metadata).every(item => !item.create && !item.columns.length));
});
test('type conflicts and absent legacy columns abort before mutations', () => {
  const typed = full(); typed.tables[1].columns[0].type = 'formula';
  assert.throws(() => planBirthdaySchema(typed), /type_mismatch/);
  const missing = legacy(); missing.tables[0].columns.pop();
  assert.throws(() => planBirthdaySchema(missing), /participation_schema_incomplete/);
  assert.throws(() => planBirthdaySchema({ tables: [] }), /existing_table_missing/);
});
