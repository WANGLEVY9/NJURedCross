import { Base } from 'seatable-api';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deleteRows } from '../lib/http/batch-write.js';
import { assertCoordinatedMaintenance } from '../lib/maintenance/script-runner.js';
import { identifier, readExpiredRows } from './njutable-retention.mjs';
import { installSeaTableTransport } from '../lib/http/seatable-transport.js';
import { observer } from '../lib/observability.js';

/**
 * Bounded NJUTable hygiene: remove only allowlisted development leftovers and
 * unimportant time-based records older than 60 days. Preview by default.
 */

const RETENTION_DAYS = 60;
const BATCH_SIZE = 200;
const MAX_DELETIONS_PER_TABLE = 1000;
const CONFIRM = 'APPLY-NJUTABLE-HYGIENE';
const DELETE_NON_EMPTY_CONFIRM = 'DELETE-NON-EMPTY-DEV-TABLES';
const REPORT_DIR = resolve('reports');
const REPORT_FILE = resolve(REPORT_DIR, 'NJUTABLE_MAINTENANCE_2026-11-23.json');
const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');

const groups = [
  { key: 'management', token: process.env.SEATABLE_API_TOKEN, uuid: process.env.SEATABLE_BUSINESS_BASE_UUID,
    obsoleteTables: ['8月5日测试', '南大红会 志愿服务平台_个人主页（26年备份）'],
    retention: [
      { table: '操作审计表', column: '时间', kind: 'audit', sensitive: true },
    ] },
  { key: 'volunteer', token: process.env.SEATABLE_VOLUNTEER_API_TOKEN, uuid: process.env.SEATABLE_VOLUNTEER_BASE_UUID,
    obsoleteTables: ['市血液献血车排班表（汇总底表）(copy)', '个人主页（26年备份）', '个人主页（编辑版）(8.4备份)'],
    retention: [
      { table: '志愿服务平台 脚本运行日志', column: '运行时间', kind: 'script-log' },
    ] },
  { key: 'identity', token: process.env.SEATABLE_IDENTITY_API_TOKEN, uuid: process.env.SEATABLE_IDENTITY_BASE_UUID,
    obsoleteTables: ['Table1'],
    retention: [
      { table: '邮箱验证码表', column: '创建时间', kind: 'verification-code', sensitive: true, expiredOnly: true },
      { table: '邮件发件记录表', column: '发送时间', kind: 'mail-delivery', sensitive: true },
    ] },
];

const protectedTables = new Set([
  '平台账号表', '账号关联表', '网站活动流程表', '网站活动报名总表', '网站活动签到表',
  '网站服务时长明细表', '网站志愿时长汇总表', '网站个人主页表', '网站献血车心愿清单',
  '个人主页（编辑版）', '活动及时长汇总表', '活动报名总表', '活动签到',
  '市血液献血车排班表（汇总底表）', '市血液献血车排班表（模板表）',
  '物资管理', '工位物资表', '物资流水表', '物资配置表', '活动项目表', '活动场次表',
  '宣传项目表', '宣传投稿表', '宣传发布任务表', '温暖连接参加表', '温暖连接投稿表',
  '活动通知表', '活动附件表', '任务表', '任务申领表', '红会留言墙', '千纸鹤寄语表',
  '平台物资登记表', '投稿附件表', '影像素材表', '宣传展示表', '成员技能表',
]);

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const confirmation = argv.find(arg => arg.startsWith('--confirm='))?.slice('--confirm='.length);
  const dayValue = Number(argv.find(arg => arg.startsWith('--retention-days='))?.slice('--retention-days='.length) || RETENTION_DAYS);
  const batchValue = Number(argv.find(arg => arg.startsWith('--batch-size='))?.slice('--batch-size='.length) || BATCH_SIZE);
  const includeAudit = argv.includes('--include-audit');
  const includeIdentity = process.env.PLATFORM_NJUTABLE_IDENTITY_CLEANUP === 'true';
  const includeNonEmptyTables = argv.includes(`--confirm=${DELETE_NON_EMPTY_CONFIRM}`);
  if (!Number.isSafeInteger(dayValue) || dayValue < 1 || dayValue > 3650) throw new Error('Invalid retention days');
  if (!Number.isSafeInteger(batchValue) || batchValue < 1 || batchValue > BATCH_SIZE) throw new Error('Invalid batch size');
  return { apply, confirmation, retentionDays: dayValue, batchSize: batchValue,
    includeAudit, includeIdentity, includeNonEmptyTables };
}

async function clientFor(group) {
  if (!group.token || !group.uuid) throw new Error(`Missing credentials or UUID for ${group.key}`);
  const base = new Base({ server, APIToken: group.token });
  await base.auth();
  if (base.dtableUuid !== group.uuid) throw new Error(`Authenticated Base mismatch for ${group.key}`);
  return base;
}

async function tablePlan(base, group, obsolete, cutoff, args) {
  const metadata = await base.getMetadata();
  const known = new Map((metadata.tables || []).map(table => [table.name, table]));
  const tables = [];
  for (const name of obsolete) {
    if (protectedTables.has(name)) throw new Error(`Protected obsolete table: ${name}`);
    const table = known.get(name);
    if (!table) continue;
    let rowCount = null;
    try {
      const counted = await base.query(`SELECT COUNT(*) AS total FROM ${identifier(name)}`);
      rowCount = Number(counted?.[0]?.total ?? null);
    } catch { /* Count is advisory; delete remains allowlist gated. */ }
    const emptyShell = name === 'Table1' && (table.columns || []).length <= 1;
    const isEmpty = rowCount === 0;
    const deletable = isEmpty || emptyShell || args.includeNonEmptyTables;
    tables.push({ name,
      action: deletable ? 'delete-table' : 'skipped',
      ...(deletable ? {} : { reason: 'non_empty_development_table_requires_explicit_confirmation' }),
      rowCount, columnCount: (table.columns || []).length });
  }
  for (const rule of group.retention) {
    if (protectedTables.has(rule.table)) throw new Error(`Protected retention table: ${rule.table}`);
    const table = known.get(rule.table);
    if (!table) continue;
    const hasTimeColumn = (table.columns || []).some(column => column.name === rule.column);
    if (!hasTimeColumn) throw new Error(`Missing retention column ${rule.column} in ${rule.table}`);
    if (rule.sensitive && group.key === 'identity' && !args.includeIdentity) {
      tables.push({ name: rule.table, action: 'skipped', kind: rule.kind,
        reason: 'identity_records_require_explicit_environment_opt_in' });
      continue;
    }
    if (rule.kind === 'audit' && !args.includeAudit) {
      tables.push({ name: rule.table, action: 'skipped', kind: rule.kind,
        reason: 'audit_logs_require_explicit_confirmation' });
      continue;
    }
    const expired = await readExpiredRows(base, rule, cutoff, MAX_DELETIONS_PER_TABLE);
    tables.push({ name: rule.table, action: 'delete-expired-rows', kind: rule.kind,
      timeColumn: rule.column, ...expired });
  }
  return tables;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertCoordinatedMaintenance({ write: args.apply });
  if (args.apply && args.confirmation !== CONFIRM) throw new Error(`Refusing to write. Pass --apply --confirm=${CONFIRM}.`);
  const cutoff = Date.now() - args.retentionDays * 86400000;
  const report = { ok: true, mode: args.apply ? 'apply' : 'preview', checkedAt: new Date().toISOString(),
    server, retentionDays: args.retentionDays, cutoffAt: new Date(cutoff).toISOString(),
    batchSize: args.batchSize, writes: args.apply, confirmation: args.confirmation || null,
    includeAudit: args.includeAudit, includeIdentity: args.includeIdentity,
    includeNonEmptyTables: args.includeNonEmptyTables, groups: [] };
  for (const group of groups) {
    const base = await clientFor(group);
    const tables = await tablePlan(base, group, group.obsoleteTables, cutoff, args);
    report.groups.push({ key: group.key, uuid: base.dtableUuid, obsoleteTables: group.obsoleteTables,
      retention: group.retention.map(({ kind, table, column }) => ({ kind, table, column })), tables });
  }
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  const publicReport = { ...report, groups: report.groups.map(group => ({ ...group,
    tables: group.tables.map(({ expiredRowIds, ...table }) => table) })) };
  if (!args.apply) {
    console.log(JSON.stringify(publicReport, null, 2));
    return;
  }

  const applied = [];
  for (const group of groups) {
    const base = await clientFor(group);
    for (const plan of report.groups.find(item => item.key === group.key)?.tables || []) {
      if (plan.action === 'delete-table') {
        await base.deleteTable(plan.name);
        applied.push({ group: group.key, table: plan.name, action: plan.action, count: 1 });
      } else if (plan.action === 'delete-expired-rows') {
        const ids = plan.expiredRowIds || [];
        await deleteRows(base, plan.name, ids);
        applied.push({ group: group.key, table: plan.name, action: plan.action, count: ids.length });
      }
    }
  }
  const receipt = { ...report, mode: 'applied', appliedAt: new Date().toISOString(), applied };
  await writeFile(REPORT_FILE, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ ...publicReport, mode: 'applied',
    appliedAt: receipt.appliedAt, applied, report: REPORT_FILE }, null, 2));
}

installSeaTableTransport();
await observer.dependency('background', 'run', main).catch(error => {
  console.error(JSON.stringify({ ok: false, mode: 'failed', error: error.response ? 'njutable_request_failed' : error?.message || 'njutable_maintenance_failed' }));
  process.exitCode = 1;
});
