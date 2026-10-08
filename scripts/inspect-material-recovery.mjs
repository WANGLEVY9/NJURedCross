import { Base } from 'seatable-api';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertMaterialDrillTarget } from '../lib/maintenance/material-drill-target.js';
import { installSeaTableTransport } from '../lib/http/seatable-transport.js';
import { withRequestBudget } from '../lib/http/request-budget.js';

const runId = process.argv.find(arg => arg.startsWith('--run-id='))?.slice(9);
if (!/^MREC-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId || '')) {
  throw new Error('请提供原演练标识。');
}

function differences(actual, expected) {
  return Object.entries(expected).filter(([key, value]) =>
    JSON.stringify(actual[key] ?? null) !== JSON.stringify(value ?? null),
  ).map(([key, value]) => ({ field: key, expected: value ?? null, actual: actual[key] ?? null }));
}

async function listComplete(base, table) {
  const rows = [];
  for (let offset = 0; offset <= 10_000; offset += 500) {
    const page = await base.listRows(table, undefined, undefined, undefined, offset, 500);
    if (!Array.isArray(page)) throw new Error('读取格式不正确。');
    rows.push(...page);
    if (rows.length > 10_000) throw new Error('超过诊断读取上限。');
    if (page.length < 500) return rows;
  }
  throw new Error('读取不完整。');
}

try {
  await withRequestBudget(async () => {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const stateDir = resolve(process.env.PLATFORM_WRITE_STATE_DIR?.trim() || join(root, '.write-state'));
    const directory = join(stateDir, 'material-drills', runId);
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    if (manifest.runId !== runId) throw new Error('演练记录不匹配。');
    const expectedUuid = process.env.MATERIAL_RECOVERY_TEST_BASE_UUID;
    assertMaterialDrillTarget({ expectedUuid, configuredUuid: process.env.SEATABLE_BUSINESS_BASE_UUID, actualUuid: manifest.baseUuid, nodeEnv: process.env.NODE_ENV });
    const db = new DatabaseSync(join(directory, 'receipts.sqlite'), { readOnly: true });
    let receipt;
    try {
      const record = db.prepare('SELECT document FROM material_receipts WHERE operation_key = ?').get(`${runId}:checkout`);
      if (!record) throw new Error('未找到出库凭证。');
      receipt = JSON.parse(record.document);
    } finally { db.close(); }
    if (receipt.identity.payload.applicationId !== manifest.applicationId || receipt.identity.payload.assetCode !== manifest.assetCode) {
      throw new Error('本地凭证与演练记录不一致。');
    }
    installSeaTableTransport();
    const base = new Base({ server: process.env.SEATABLE_SERVER_URL, APIToken: process.env.SEATABLE_API_TOKEN });
    await base.auth();
    assertMaterialDrillTarget({ expectedUuid, configuredUuid: process.env.SEATABLE_BUSINESS_BASE_UUID, actualUuid: base.dtableUuid, nodeEnv: process.env.NODE_ENV });
    const flows = (await listComplete(base, '物资流水表')).filter(row => row.幂等键 === receipt.identity.key);
    const application = (await listComplete(base, '物资管理')).find(row => row._id === manifest.applicationId);
    if (!application || application.姓名 !== runId || application.借用用途 !== runId) throw new Error('模拟申请归属不匹配。');
    console.log(JSON.stringify({
      mode: 'read-only', writes: 0, runId, manifestStatus: manifest.status,
      receiptState: receipt.state, flowCount: flows.length,
      flowDifferences: flows.map(row => differences(row, receipt.flow)),
      applicationBeforeDifferences: differences(application, receipt.before),
    }, null, 2));
  }, { timeoutMs: 60_000 });
} catch {
  console.error('只读诊断未完成。保留原演练标识和记录，不要重复创建数据。');
  process.exitCode = 1;
}
