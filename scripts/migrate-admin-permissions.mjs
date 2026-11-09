import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Base } from 'seatable-api';
import { ACCOUNT_TABLE, listIdentityRows } from '../lib/identity/store.js';
import { migrateAdminPermissions, PermissionMigrationError, prepareAdminPermissionPlan } from '../lib/identity/admin-permission-migration.js';
import { assertCoordinatedMaintenance } from '../lib/maintenance/script-runner.js';

const args = process.argv.slice(2);
const option = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const prepare = option('prepare');
const planName = option('plan');
const apply = args.includes('--apply');
const rollback = args.includes('--rollback');
const requiredConfirmation = rollback ? 'ROLLBACK-ADMIN-PERMISSIONS' : 'MIGRATE-ADMIN-PERMISSIONS';
const name = prepare ?? planName;
const print = result => console.log(JSON.stringify(result, null, 2));
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const serialize = data => JSON.stringify(data, null, 2) + '\n';

async function main() {
  if (args.some(arg => !/^--(?:(?:prepare|plan|confirm)=.+|apply|rollback)$/.test(arg))
    || (apply && rollback) || (prepare !== undefined && planName !== undefined)
    || (name !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(name))
    || ((apply || rollback) && (!planName || option('confirm') !== requiredConfirmation))) {
    throw new PermissionMigrationError('请使用有效的计划名；执行或回滚必须提供 --plan 和对应的 --confirm。');
  }
  assertCoordinatedMaintenance({ write: apply || rollback });
  const token = process.env.SEATABLE_IDENTITY_API_TOKEN?.trim();
  const uuid = process.env.SEATABLE_IDENTITY_BASE_UUID?.trim();
  if (!token || !uuid) throw new PermissionMigrationError('请配置独立身份 Base 的 Token 和预期 UUID。');
  const base = new Base({ server: process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn', APIToken: token });
  await base.auth();
  if (base.dtableUuid !== uuid) throw new PermissionMigrationError('身份 Base UUID 不匹配。');
  const metadata = await base.getMetadata();
  const table = metadata?.tables?.find(item => item.name === ACCOUNT_TABLE);
  if (!table?.columns?.some(column => column.name === '权限范围' && column.type === 'text')) {
    throw new PermissionMigrationError('身份账号表缺少文本类型的「权限范围」列。');
  }
  const rows = await listIdentityRows(base, ACCOUNT_TABLE);
  if (!name) return print({ mode: 'preview', blankAdmins: prepareAdminPermissionPlan(rows, uuid).entries.length, writes: false });

  const directory = join(process.env.PLATFORM_WRITE_STATE_DIR?.trim()
    || fileURLToPath(new URL('../.write-state/', import.meta.url)), 'admin-permission-migrations');
  const planPath = join(directory, `${name}.json`);
  const journalPath = join(directory, `${name}.before-write.json`);
  if (prepare) {
    const plan = prepareAdminPermissionPlan(rows, uuid);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(planPath, serialize(plan), { flag: 'wx', mode: 0o600, flush: true });
    return print({ mode: 'prepare', plan: planPath, blankAdmins: plan.entries.length, writes: false });
  }

  const journal = await readJson(journalPath).catch(error => {
    if (error.code === 'ENOENT' && !rollback) return null;
    throw error;
  });
  const plan = rollback ? journal : await readJson(planPath);
  if (journal && serialize(journal) !== serialize(plan)) {
    throw new PermissionMigrationError('已有写入快照与当前计划不一致，请恢复已审阅的计划。');
  }
  const mode = rollback ? 'rollback' : apply ? 'apply' : 'preview';
  const result = await migrateAdminPermissions(base, rows, plan, {
    mode, resume: Boolean(journal),
    freezePlan: () => writeFile(journalPath, serialize(plan), { flag: 'wx', mode: 0o600, flush: true }),
  });
  print({ mode, ...result });
}

try {
  await main();
} catch (error) {
  console.error(error instanceof PermissionMigrationError ? error.message : '权限迁移未完成，请检查身份 Base、协调运行方式及私有计划文件。');
  process.exitCode = 1;
}
