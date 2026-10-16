import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtemp, rm, readFile, mkdir, open, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertMaterialDrillTarget } from '../lib/maintenance/material-drill-target.js';
import { openMaterialReceiptStore } from '../lib/materials/receipt-store.js';
import { materialOperationIdentity } from '../lib/materials/operation.js';
import { materialApplicationPlan } from '../lib/materials/application-plan.js';
import { executeMaterialRecovery } from '../lib/materials/execute-recovery.js';

const source = (await readFile(new URL('../scripts/smoke-material-recovery-test-base.mjs', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const footer = source.lastIndexOf('\ntry { await withRequestBudget(main');
assert.ok(footer > 0, 'Drill entry marker must exist');
const body = source.slice(0, footer).replace(/^import .*;\n/gm, '').replace(
  "const root = fileURLToPath(new URL('../', import.meta.url));",
  'const root = fixtureRoot;',
);
assert.ok(!body.includes('import.meta'), 'All real entry-only imports must be replaced');

function metadata() {
  const definitions = {
    物资管理: { 姓名: 'text', 状态: 'single-select', 邮箱: 'text', 借用用途: 'text', 借用件数: 'number', 归还件数: 'number', 借出审批: 'single-select', 实际借用日期: 'date', 实际归还日期: 'date', 归还状态: 'single-select' },
    工位物资表: { 物资名称: 'text', 初始数量: 'number', 单位: 'text' },
    物资流水表: { 流水编号: 'text', 申请单ID: 'text', 资产编码: 'text', 物资名称: 'text', 操作类型: 'text', 数量: 'number', 操作前数量: 'number', 操作后数量: 'number', 操作人: 'text', 操作时间: 'date', 幂等键: 'text', 损耗数量: 'number' },
  };
  const options = { 状态: ['开始', '借出（物资）', '已归还'], 借出审批: ['审批通过'], 归还状态: ['已全部归还'] };
  return { tables: Object.entries(definitions).map(([name, columns]) => ({
    name,
    columns: Object.entries(columns).map(([column, type]) => ({ name: column, type, data: { options: (options[column] || []).map(value => ({ name: value })) } })),
  })) };
}

async function fixture(t, { alterFirstFlowDate = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'material-drill-script-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const tables = { 物资管理: [], 工位物资表: [], 物资流水表: [] };
  let sequence = 0;
  let writes = 0;
  let failReturn = false;
  const runId = `MREC-${randomUUID()}`;
  const outputs = [];
  function seaTableDates(record) {
    const result = structuredClone(record);
    for (const key of ['操作时间', '实际借用日期', '实际归还日期']) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(result[key] || '')) {
        result[key] += 'T00:00:00+08:00';
      }
    }
    return result;
  }
  class FakeBase {
    constructor(config) { assert.equal(config.server, 'http://synthetic.invalid'); }
    async auth() { this.dtableUuid = 'synthetic-base'; }
    async getMetadata() { return metadata(); }
    async listRows(table, _view, _order, _direction, start, limit) { return structuredClone(tables[table].slice(start, start + limit)); }
    async appendRow(table, row) {
      const value = { ...seaTableDates(row), _id: `synthetic-${++sequence}` };
      if (alterFirstFlowDate && table === '物资流水表' && row.操作类型 === '出库') {
        value.操作时间 = value.操作时间.replace('+08:00', '+09:00');
      }
      tables[table].push(value); writes++;
      return { _id: value._id };
    }
    async updateRow(table, id, patch) {
      if (failReturn && patch.状态 === '已归还') { failReturn = false; throw new Error('synthetic return outage'); }
      const row = tables[table].find(value => value._id === id);
      assert.ok(row); Object.assign(row, seaTableDates(patch)); writes++;
    }
    async deleteRow(table, id) {
      const index = tables[table].findIndex(row => row._id === id);
      assert.ok(index >= 0); tables[table].splice(index, 1); writes++;
    }
  }
  async function run(phase, overrides = {}) {
    const context = {
      assert, Base: FakeBase, mkdir, readFile, open, rename,
      join, resolve, relative, isAbsolute, sep, randomUUID,
      assertMaterialDrillTarget, openMaterialReceiptStore,
      materialOperationIdentity, materialApplicationPlan, executeMaterialRecovery,
      fixtureRoot: directory,
      assertCoordinatedMaintenance: () => {},
      installSeaTableTransport: () => {},
      console: { log: text => outputs.push(JSON.parse(text)) },
      process: {
        argv: ['node', 'synthetic-script', '--apply', `--phase=${phase}`, `--run-id=${runId}`, '--confirm=RUN-MATERIAL-RECOVERY-TEST'],
        env: {
          SEATABLE_SERVER_URL: 'http://synthetic.invalid', SEATABLE_API_TOKEN: 'synthetic',
          SEATABLE_BUSINESS_BASE_UUID: 'synthetic-base', MATERIAL_RECOVERY_TEST_BASE_UUID: 'synthetic-base',
          NODE_ENV: 'development', MATERIALS_REMINDER_ENABLED: 'false', ...overrides,
        },
      },
    };
    vm.createContext(context);
    vm.runInContext(body + '\nglobalThis.invoke = main;', context);
    return context.invoke();
  }
  return { tables, outputs, run, writes: () => writes, failNextReturn: () => { failReturn = true; } };
}

test('fault, fresh-context recovery, repeated verification and cleanup affect only drill rows', async t => {
  const f = await fixture(t);
  f.tables.物资管理.push({ _id: 'foreign-application', 姓名: 'unrelated synthetic record' });
  f.tables.工位物资表.push({ _id: 'foreign-inventory', 物资名称: 'unrelated synthetic record' });
  f.tables.物资流水表.push({ _id: 'foreign-flow', 幂等键: 'unrelated-key' });
  await f.run('fault');
  assert.equal(f.tables.物资流水表.length, 2);
  assert.equal(f.tables.物资管理.at(-1).状态, '开始');
  await f.run('resume');
  assert.equal(f.tables.物资管理.at(-1).归还件数, 2);
  assert.equal(f.tables.物资流水表.length, 3);
  const completedWrites = f.writes();
  await f.run('resume');
  assert.equal(f.writes(), completedWrites);
  await f.run('cleanup');
  assert.equal(f.tables.物资管理.length, 1);
  assert.equal(f.tables.工位物资表.length, 1);
  assert.equal(f.tables.物资流水表.length, 1);
  const cleanedWrites = f.writes();
  await f.run('cleanup');
  assert.equal(f.writes(), cleanedWrites);
  assert.equal(f.outputs.at(-1).remainingDrillRows, 0);
});

test('interrupted return resumes without reapplying checkout', async t => {
  const f = await fixture(t);
  await f.run('fault');
  f.failNextReturn();
  await assert.rejects(f.run('resume'), /synthetic return outage/);
  assert.equal(f.tables.物资流水表.length, 2);
  await f.run('resume');
  assert.equal(f.tables.物资流水表.length, 2);
  assert.equal(f.tables.物资管理[0].状态, '已归还');
});

test('changed ownership marker stops cleanup before deletion', async t => {
  const f = await fixture(t);
  await f.run('fault');
  await f.run('resume');
  f.tables.工位物资表[0].物资名称 = 'changed-by-someone';
  const before = f.writes();
  await assert.rejects(f.run('cleanup'));
  assert.equal(f.writes(), before);
  assert.equal(f.tables.物资流水表.length, 2);
});

test('different configured Base stops before any business writes', async t => {
  const f = await fixture(t);
  await assert.rejects(f.run('fault', { SEATABLE_BUSINESS_BASE_UUID: 'another-base' }), /UUID 不一致/);
  assert.equal(f.writes(), 0);
});

test('a preparation run cannot be repeated with the same run ID', async t => {
  const f = await fixture(t);
  await f.run('fault');
  const before = f.writes();
  await assert.rejects(f.run('fault'), error => error.code === 'EEXIST');
  assert.equal(f.writes(), before);
});

test('continue-fault validates an existing flow without repeating preparation', async t => {
  const f = await fixture(t, { alterFirstFlowDate: true });
  await assert.rejects(f.run('fault'));
  assert.equal(f.tables.物资流水表.length, 1);
  assert.equal(f.tables.物资管理[0].状态, '开始');

  // Simulate correcting only the incompatible synthetic read representation.
  const flow = f.tables.物资流水表[0];
  flow.操作时间 = flow.操作时间.replace('+09:00', '+08:00');
  const writes = f.writes();

  await f.run('continue-fault');
  assert.equal(f.writes(), writes);
  assert.equal(f.tables.工位物资表.length, 1);
  assert.equal(f.tables.物资管理.length, 1);
  assert.equal(f.tables.物资流水表.length, 1);
  assert.equal(f.outputs.at(-1).passed, true);

  await f.run('resume');
  assert.equal(f.tables.物资流水表.length, 2);
  await f.run('cleanup');
  assert.equal(f.tables.物资流水表.length, 0);
});
