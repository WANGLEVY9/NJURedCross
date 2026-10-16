import { assertCoordinatedMaintenance } from '../lib/maintenance/script-runner.js';
assertCoordinatedMaintenance({ write: process.argv.includes('--apply') });
import assert from 'node:assert/strict';
import { Base } from 'seatable-api';
import { mkdir, readFile, open, rename } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { assertMaterialDrillTarget } from '../lib/maintenance/material-drill-target.js';
import { installSeaTableTransport } from '../lib/http/seatable-transport.js';
import { withRequestBudget } from '../lib/http/request-budget.js';
import { openMaterialReceiptStore } from '../lib/materials/receipt-store.js';
import { materialOperationIdentity } from '../lib/materials/operation.js';
import { materialApplicationPlan } from '../lib/materials/application-plan.js';
import { executeMaterialRecovery } from '../lib/materials/execute-recovery.js';

const argument = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const apply = process.argv.includes('--apply');
const phase = argument('phase');
const runId = argument('run-id');
const actor = 'synthetic-material-recovery-drill';
const appTable = '物资管理';
const inventoryTable = '工位物资表';
const flowTable = '物资流水表';
const root = fileURLToPath(new URL('../', import.meta.url));

async function listComplete(base, table) {
  const rows = [];
  for (let offset = 0; offset <= 10_000; offset += 500) {
    const page = await base.listRows(table, undefined, undefined, undefined, offset, 500);
    assert.ok(Array.isArray(page), 'SeaTable rows must be an array');
    rows.push(...page);
    if (rows.length > 10_000) throw new Error('Drill read limit exceeded; no further writes permitted');
    if (page.length < 500) return rows;
  }
  throw new Error('Incomplete drill read');
}

function assertSchema(metadata) {
  const required = {
    [appTable]: {
      姓名: 'text', 状态: 'single-select', 邮箱: 'text', 借用用途: 'text',
      借用件数: 'number', 归还件数: 'number', 借出审批: 'single-select',
      实际借用日期: 'date', 实际归还日期: 'date', 归还状态: 'single-select',
    },
    [inventoryTable]: { 物资名称: 'text', 初始数量: 'number', 单位: 'text' },
    [flowTable]: {
      流水编号: 'text', 申请单ID: 'text', 资产编码: 'text', 物资名称: 'text',
      操作类型: 'text', 数量: 'number', 操作前数量: 'number', 操作后数量: 'number',
      操作人: 'text', 操作时间: 'date', 幂等键: 'text', 损耗数量: 'number',
    },
  };
  for (const [name, columns] of Object.entries(required)) {
    const table = metadata.tables?.find(value => value.name === name);
    assert.ok(table, `Missing table: ${name}`);
    for (const [column, type] of Object.entries(columns)) {
      assert.equal(table.columns.find(value => value.name === column)?.type, type, `Column mismatch: ${name}/${column}`);
    }
  }
  const app = metadata.tables.find(value => value.name === appTable);
  for (const [column, options] of Object.entries({
    状态: ['开始', '借出（物资）', '已归还'],
    借出审批: ['审批通过'],
    归还状态: ['已全部归还'],
  })) {
    const existing = app.columns.find(value => value.name === column).data?.options || [];
    for (const option of options) assert.ok(existing.some(value => value.name === option), `Missing option: ${column}/${option}`);
  }
}

async function main() {
  if (!apply) {
    console.log(JSON.stringify({ mode: 'preview', writes: 0, phases: ['fault', 'resume', 'cleanup'] }));
    return;
  }
  assert.equal(argument('confirm'), 'RUN-MATERIAL-RECOVERY-TEST', 'Explicit drill confirmation required');
  assert.ok(
    ['fault', 'continue-fault', 'resume', 'cleanup'].includes(phase),
    'Unknown drill phase',
  );
  assert.match(runId || '', /^MREC-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.notEqual(String(process.env.MATERIALS_REMINDER_ENABLED).toLowerCase(), 'true', 'Disable real reminder jobs for the drill');
  const expectedUuid = process.env.MATERIAL_RECOVERY_TEST_BASE_UUID?.trim();
  assertMaterialDrillTarget({ expectedUuid, configuredUuid: process.env.SEATABLE_BUSINESS_BASE_UUID, actualUuid: expectedUuid, nodeEnv: process.env.NODE_ENV });
  assert.ok(process.env.SEATABLE_SERVER_URL && process.env.SEATABLE_API_TOKEN, 'Missing business configuration');

  const stateDir = resolve(process.env.PLATFORM_WRITE_STATE_DIR?.trim() || join(root, '.write-state'));
  const publicRelative = relative(join(root, 'public'), stateDir);
  assert.ok(publicRelative && (publicRelative === '..' || publicRelative.startsWith(`..${sep}`) || isAbsolute(publicRelative)), 'State must be outside public');
  const directory = join(stateDir, 'material-drills', runId);
  const manifestFile = join(directory, 'manifest.json');
  const receiptFile = join(directory, 'receipts.sqlite');
  installSeaTableTransport();
  const base = new Base({ server: process.env.SEATABLE_SERVER_URL, APIToken: process.env.SEATABLE_API_TOKEN });
  await base.auth();
  assertMaterialDrillTarget({ expectedUuid, configuredUuid: process.env.SEATABLE_BUSINESS_BASE_UUID, actualUuid: base.dtableUuid, nodeEnv: process.env.NODE_ENV });
  assertSchema(await base.getMetadata());

  let manifest;
  async function checkpoint() {
    const temporary = join(directory, `manifest-${randomUUID()}.tmp`);
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(manifest, null, 2)); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, manifestFile);
  }
  if (phase === 'fault') {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    manifest = { version: 1, runId, baseUuid: expectedUuid, status: 'preparing', date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()) };
    const reservation = await open(manifestFile, 'wx', 0o600);
    try { await reservation.writeFile(JSON.stringify(manifest)); await reservation.sync(); }
    finally { await reservation.close(); }
    const inventory = await listComplete(base, inventoryTable);
    const applications = await listComplete(base, appTable);
    const flows = await listComplete(base, flowTable);
    assert.ok(!inventory.some(row => row.物资名称 === runId));
    assert.ok(!applications.some(row => row.借用用途 === runId));
    assert.ok(!flows.some(row => String(row.幂等键 || '').startsWith(`${runId}:`)));
    const item = await base.appendRow(inventoryTable, { 物资名称: runId, 初始数量: 3, 单位: '件' });
    assert.ok(item?._id, 'Inventory append result is unknown; do not repeat preparation');
    manifest.inventoryId = item._id;
    manifest.assetCode = `NJU-RC-${item._id}`;
    await checkpoint();
    const application = await base.appendRow(appTable, {
      姓名: runId, 邮箱: 'material-drill@example.test', 借用用途: runId,
      借用件数: 2, 归还件数: 0, 状态: '开始', 借出审批: '审批通过',
    });
    assert.ok(application?._id, 'Application append result is unknown; do not repeat preparation');
    manifest.applicationId = application._id;
    await checkpoint();
  } else {
    manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    assert.equal(manifest.version, 1);
    assert.equal(manifest.runId, runId);
    assert.equal(manifest.baseUuid, expectedUuid);
    assert.equal(manifest.assetCode, `NJU-RC-${manifest.inventoryId}`);
    assert.ok(manifest.applicationId && manifest.inventoryId);
  }

  const store = await openMaterialReceiptStore(receiptFile);
  const keys = { checkout: `${runId}:checkout`, return: `${runId}:return` };
  async function snapshot() {
    const inventory = await listComplete(base, inventoryTable);
    const applications = await listComplete(base, appTable);
    const flows = await listComplete(base, flowTable);
    const item = inventory.find(row => row._id === manifest.inventoryId);
    const application = applications.find(row => row._id === manifest.applicationId);
    assert.equal(item?.物资名称, runId, 'Inventory ownership mismatch');
    assert.equal(item.初始数量, 3);
    assert.equal(application?.姓名, runId, 'Application ownership mismatch');
    assert.equal(application.借用用途, runId);
    assert.equal(application.邮箱, 'material-drill@example.test');
    assert.equal(application.借用件数, 2);
    return { application, flows };
  }
  function prepare(operation, application) {
    const direction = operation === '出库' ? 'checkout' : 'return';
    const identity = materialOperationIdentity({ idempotencyKey: keys[direction], applicationId: manifest.applicationId, assetCode: manifest.assetCode, operation, quantity: 2, actor });
    return store.create({
      identity,
      flow: {
        流水编号: `${runId}:${direction}`, 申请单ID: manifest.applicationId,
        资产编码: manifest.assetCode, 物资名称: runId, 操作类型: operation,
        数量: 2, 操作前数量: operation === '出库' ? 3 : 1,
        操作后数量: operation === '出库' ? 1 : 3, 操作人: actor,
        操作时间: manifest.date, 幂等键: identity.key, 损耗数量: 0,
      },
      ...materialApplicationPlan({ application, operation, quantity: 2, lossQuantity: 0, note: '', photoPath: '', date: manifest.date }),
      state: 'prepared',
    });
  }
  function execute(key, failUpdate = false) {
    const receipt = store.get(key);
    assert.ok(receipt, 'Missing durable receipt');
    return executeMaterialRecovery({
      receipt, incoming: receipt.identity, saveReceipt: value => store.save(value),
      readState: snapshot,
      appendFlow: row => base.appendRow(flowTable, row),
      updateApplication: async (id, patch) => {
        assert.equal(id, manifest.applicationId);
        if (failUpdate) throw new Error('SYNTHETIC_BEFORE_APPLICATION_UPDATE');
        return base.updateRow(appTable, id, patch);
      },
    });
  }
  function ownFlows(flows) {
    return flows.filter(row => Object.values(keys).includes(row.幂等键));
  }
  try {
    if (phase === 'fault' || phase === 'continue-fault') {
      const before = await snapshot();
      if (phase === 'fault') {
        prepare('出库', before.application);
      } else {
        assert.equal(manifest.status, 'preparing');
        assert.equal(store.get(keys.checkout)?.state, 'flow_attempted');
        assert.equal(ownFlows(before.flows).length, 1);
      }
      await assert.rejects(execute(keys.checkout, true), /SYNTHETIC_BEFORE_APPLICATION_UPDATE/);
      const after = await snapshot();
      assert.equal(ownFlows(after.flows).length, 1);
      assert.equal(after.application.状态, '开始');
      assert.equal(store.get(keys.checkout).state, 'application_attempted');
      manifest.status = 'fault-confirmed';
      await checkpoint();
      console.log(JSON.stringify({ runId, phase, passed: true, flowCount: 1, next: 'resume in a separate process' }));
    } else if (phase === 'resume') {
      assert.ok(['fault-confirmed', 'verified'].includes(manifest.status), 'Preparation is incomplete; reconcile instead of recreating rows');
      if (manifest.status === 'fault-confirmed') {
        if (!store.get(keys.return)) {
          await execute(keys.checkout);
          await execute(keys.checkout);
          const checkedOut = await snapshot();
          assert.equal(checkedOut.application.状态, '借出（物资）');
          assert.equal(ownFlows(checkedOut.flows).length, 1);
          prepare('归还', checkedOut.application);
        }
        await execute(keys.return);
      }
      await execute(keys.return);
      const after = await snapshot();
      const flows = ownFlows(after.flows);
      assert.equal(flows.length, 2);
      assert.equal(flows.filter(row => row.幂等键 === keys.checkout).length, 1);
      assert.equal(flows.filter(row => row.幂等键 === keys.return).length, 1);
      assert.equal(after.application.状态, '已归还');
      assert.equal(after.application.归还件数, 2);
      assert.equal(after.application.归还状态, '已全部归还');
      const quantity = 3 + flows.reduce((sum, row) => sum + (row.操作类型 === '归还' ? row.数量 : -row.数量), 0);
      assert.equal(quantity, 3);
      assert.equal(store.get(keys.checkout).state, 'completed');
      assert.equal(store.get(keys.return).state, 'completed');
      manifest.flowIds = flows.map(row => row._id);
      manifest.status = 'verified';
      await checkpoint();
      console.log(JSON.stringify({ runId, phase, passed: true, flowCount: 2, returned: 2, quantity, next: 'cleanup' }));
    } else {
      assert.ok(['verified', 'cleaning', 'cleaned'].includes(manifest.status), 'Cleanup requires a verified drill');
      assert.equal(store.get(keys.checkout)?.state, 'completed');
      assert.equal(store.get(keys.return)?.state, 'completed');
      const inventory = await listComplete(base, inventoryTable);
      const applications = await listComplete(base, appTable);
      const flows = await listComplete(base, flowTable);
      const item = inventory.find(row => row._id === manifest.inventoryId);
      const application = applications.find(row => row._id === manifest.applicationId);
      if (item) { assert.equal(item.物资名称, runId); assert.equal(item.初始数量, 3); }
      if (application) {
        assert.equal(application.姓名, runId); assert.equal(application.借用用途, runId);
        assert.equal(application.邮箱, 'material-drill@example.test'); assert.equal(application.状态, '已归还');
        assert.equal(application.借用件数, 2); assert.equal(application.归还件数, 2);
      }
      assert.ok(Array.isArray(manifest.flowIds) && manifest.flowIds.length === 2);
      const targets = flows.filter(row => manifest.flowIds.includes(row._id));
      assert.ok(ownFlows(flows).every(row => manifest.flowIds.includes(row._id)), 'Unexpected additional drill flow; stop cleanup');
      for (const row of targets) {
        assert.ok(Object.values(keys).includes(row.幂等键));
        assert.equal(row.申请单ID, manifest.applicationId); assert.equal(row.资产编码, manifest.assetCode);
        assert.equal(row.物资名称, runId); assert.equal(row.操作人, actor); assert.equal(row.数量, 2);
        assert.equal(row.操作类型, row.幂等键 === keys.checkout ? '出库' : '归还');
      }
      manifest.status = 'cleaning';
      await checkpoint();
      for (const row of targets) await base.deleteRow(flowTable, row._id);
      if (application) await base.deleteRow(appTable, manifest.applicationId);
      if (item) await base.deleteRow(inventoryTable, manifest.inventoryId);
      assert.ok(!(await listComplete(base, flowTable)).some(row => manifest.flowIds.includes(row._id)));
      assert.ok(!(await listComplete(base, appTable)).some(row => row._id === manifest.applicationId));
      assert.ok(!(await listComplete(base, inventoryTable)).some(row => row._id === manifest.inventoryId));
      manifest.status = 'cleaned';
      await checkpoint();
      console.log(JSON.stringify({ runId, phase, passed: true, remainingDrillRows: 0, localEvidencePreserved: true }));
    }
  } finally { store.close(); }
}

try { await withRequestBudget(main, { timeoutMs: 120_000 }); }
catch (error) {
  console.error(`Material recovery drill stopped (${error.code || error.name || 'error'}). Preserve the run ID and local manifest; do not recreate or delete uncertain rows.`);
  process.exitCode = 1;
}
