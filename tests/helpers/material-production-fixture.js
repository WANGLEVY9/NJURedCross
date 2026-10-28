// Fully isolated formal service, including the server's real receipt/recovery function.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { createMaterialsFixtures } from '../../lib/materials/fixtures.js';
import { createMaterialsService, inventorySummaries, applicationProgress } from '../../lib/materials/service.js';
import { createMutationQueue, assertCompleteRows } from '../../lib/events/safety.js';
import { openMaterialWorkflowStore, MATERIAL_WORKFLOW_TABLE, MATERIAL_WORKFLOW_COLUMNS } from '../../lib/materials/workflow-store.js';
import { createProductionMaterialWorkflow } from '../../lib/materials/production-workflow.js';
import { materialOperationIdentity } from '../../lib/materials/operation.js';
import { openMaterialReceiptStore } from '../../lib/materials/receipt-store.js';
import { executeMaterialRecovery } from '../../lib/materials/execute-recovery.js';
import { materialApplicationPlan } from '../../lib/materials/application-plan.js';
import { assertMaterialRequestAsset } from '../../lib/materials/public-portal.js';

const { structuredClone } = globalThis;
const source = (await readFile(new URL('../../server.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const start = source.indexOf('async function performMaterialApplication('), end = source.indexOf('function materialPortalActor(', start);
if (start < 0 || end < start) throw Error('Formal application operation is missing');
export const productionOwner = { id: 'synthetic-owner', realName: '合成借用人', studentId: '123456789', email: 'synthetic@example.invalid', emailVerified: true };
export const productionManager = { id: 'synthetic-manager', realName: '合成管理员', canReview: true };

export async function materialProductionFixture({ intentFile = ':memory:', schemaReady = true } = {}) {
  const seed = createMaterialsFixtures(), data = seed.snapshot(), metadata = await seed.client.getMetadata(), writes = [], audit = [], objects = new Map();
  data[MATERIAL_WORKFLOW_TABLE] = [];
  if (schemaReady) metadata.tables.push({ name: MATERIAL_WORKFLOW_TABLE, columns: Object.entries(MATERIAL_WORKFLOW_COLUMNS).map(([name, type]) => ({ name, type })) });
  const ownerRow = data['物资管理'].find(row => row._id === 'synthetic-overdue');
  Object.assign(ownerRow, { 姓名: productionOwner.realName, 学号: productionOwner.studentId, 邮箱: productionOwner.email, 可借用物资: ['synthetic-pressure'] });
  let counter = 0, workflow, perform;
  const state = { failAppendBefore: '', failAppendAfter: '', failUpdateBefore: '', truncated: '', photoReads: 0, pendingRecovery: false };
  const list = async table => {
    if (!data[table]) throw Error('Unexpected synthetic table');
    const value = structuredClone(data[table]); Object.defineProperty(value, 'readMeta', { value: { truncated: state.truncated === table } }); return value;
  };
  const client = {
    getMetadata: async () => structuredClone(metadata),
    appendRow: async (table, row) => {
      if (state.failAppendBefore === table) throw Error('Synthetic before write');
      const saved = { ...structuredClone(row), _id: `synthetic-new-${++counter}` }; data[table].push(saved); writes.push({ table, action: 'append' });
      if (state.failAppendAfter === table) { state.failAppendAfter = ''; throw Error('Synthetic lost acknowledgement'); }
      return { _id: saved._id };
    },
    updateRow: async (table, id, patch) => {
      if (state.failUpdateBefore === table) { state.failUpdateBefore = ''; throw Error('Synthetic update outage'); }
      const row = data[table].find(row => row._id === id); if (!row) throw Error('Synthetic row missing');
      Object.assign(row, structuredClone(patch)); writes.push({ table, action: 'update' }); return { success: true };
    },
  };
  const store = openMaterialWorkflowStore({ file: intentFile, getClient: async () => client, listRows: (_, table) => list(table) });
  const receipts = await openMaterialReceiptStore(':memory:'), lock = createMutationQueue(), coreLocks = new Map();
  const core = actor => createMaterialsService({ client, listRows: list, actor: actor.realName || actor.id, locks: coreLocks });
  const materialBundle = async () => {
    const [inventory, configs, flows] = await Promise.all(['工位物资表', '物资配置表', '物资流水表'].map(list));
    assertCompleteRows(inventory, configs, flows);
    const summaries = inventorySummaries(inventory, configs, flows);
    return { inventory, configs, flows, summaries, summaryByCode: new Map(summaries.map(item => [item.code, item])) };
  };
  workflow = createProductionMaterialWorkflow({ store, getClient: async () => client, listRows: (_, table) => list(table), getCore: core,
    readOverview: () => core(productionManager).overview(), now: () => '2026-10-28T12:00:00Z',
    performApplication: (...args) => perform(...args),
    beforeStockWrite: async () => { if (state.pendingRecovery) throw Object.assign(Error('Synthetic pending recovery'), { statusCode: 409 }); },
    photos: { put: async ref => { objects.set(ref.sha256, Buffer.from(ref.bytes)); return { sha256: ref.sha256, size: ref.bytes.length, path: `/synthetic/${ref.sha256}` }; },
      read: async ref => { state.photoReads++; return Buffer.from(objects.get(ref.sha256)); } },
  });
  const box = { materialWorkflow: workflow, materialOperationIdentity, createHash, materialReceiptStore: receipts, materialsTable: '物资管理',
    withMaterialLock: (_code, task) => lock(task), materialBundle, listAllRows: (_, table) => list(table), assertCompleteRows,
    materialApplicationProgress: applicationProgress, assertMaterialRequestAsset, materialApplicationPlan, executeMaterialRecovery,
    httpError: (statusCode, message) => Object.assign(Error(message), { statusCode }), assertRequestActive: () => {}, today: () => '2026-10-28',
    maskedApplicant: value => value.slice(0, 1) + '＊', uploadSeaTableImage: async () => null,
    transactionPayload: (body, session, item) => ({ row: { 幂等键: body.idempotencyKey, 申请单ID: body.applicationId, 资产编码: item.code,
      物资名称: item.name, 数量: body.quantity, 损耗数量: body.lossQuantity, 操作类型: body.operation, 操作前数量: item.quantity,
      操作后数量: item.quantity + (body.operation === '归还' ? body.quantity : -body.quantity), 操作人: session.username, 操作时间: '2026-10-28', 异常说明: body.note } }),
    recordAudit: async (...args) => { audit.push(args); },
  };
  perform = vm.runInNewContext(`(${source.slice(start, end).trim()})`, box);
  const context = { req: {}, session: { username: productionManager.id }, client };
  return { data, metadata, writes, state, store, receipts, workflow, core, client, list, audit, objects, perform, context,
    close() { store.close(); receipts.close(); } };
}
