import { Base } from 'seatable-api';
import {
  MEDIA_TABLE,
  MEDIA_COLUMNS,
  SHOWCASE_TABLE,
  SHOWCASE_COLUMNS,
} from '../lib/attachment/store.js';

/**
 * 内容投稿 v2（NJU Box 双备份架构）的 schema 变更：
 *   · 「宣传投稿表」追加 4 列：文创类别 / 美编人 / 作品标题 / 学号
 *     （文创设计投稿与文字稿件共用同一底表，前端正ward独立表单页）
 *   · 创建「影像素材表」：影像模块的元数据与留用状态，文件本体在 NJU Box
 *     的 /影像素材/<活动名>/ 目录
 *   · 创建「宣传展示表」：展示板块的数据源（手动导入 / 公众号抓取双方案），
 *     封面图存 NJU Box /宣传展示/ 目录
 *
 * 安全模型（与其他 apply-* 脚本一致）：
 *   · 不带 --apply 时只打印计划并退出，不写入
 *   · 写操作需要显式 --confirm=APPLY-NJU-RC-SUBMISSION-V2-SCHEMA
 *   · 加列只追加缺失列，已存在列跳过；建表拒绝覆盖既有表
 *
 * 运行方式：
 *   npm run attachments-v2:dry-run   # 预览
 *   npm run attachments-v2:apply     # 需要确认短语
 */

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_API_TOKEN;
const apply = process.argv.includes('--apply');
const confirmation = process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
const requiredConfirmation = 'APPLY-NJU-RC-SUBMISSION-V2-SCHEMA';

/** 与 server.js 的 outreachSubmissionTable 保持同一表名。 */
const SUBMISSIONS_TABLE = '宣传投稿表';
const SUBMISSIONS_NEW_COLUMNS = ['文创类别', '美编人', '作品标题', '学号'];

/**
 * v2.1（2026-10 用户变更要求）：影像素材表追加两列——
 *   · 中心（5 个固定中心，必选，决定 Box 一级目录）
 *   · 摄影师（账号实名，服务端强制，写入活动文件夹名后缀）
 * 表已存在时只补缺失列，不建表。
 */
const MEDIA_NEW_COLUMNS = ['中心', '摄影师'];

const newTables = [
  {
    name: MEDIA_TABLE,
    columns: MEDIA_COLUMNS,
    purpose: '影像模块的元数据与留用状态（文件本体在 NJU Box /影像素材/<活动名>/）',
  },
  {
    name: SHOWCASE_TABLE,
    columns: SHOWCASE_COLUMNS,
    purpose: '宣传展示板块的展示条目（封面在 NJU Box /宣传展示/；来源=手动导入或公众号抓取）',
  },
];

if (!token || token === 'replace-with-your-api-token') throw new Error('Missing SEATABLE_API_TOKEN');
if (apply && confirmation !== requiredConfirmation) {
  throw new Error(`Refusing to write. Pass --confirm=${requiredConfirmation} together with --apply.`);
}

const base = new Base({ server, APIToken: token });
await base.auth();
const metadata = await base.getMetadata();
const current = new Map((metadata?.tables || []).map((table) => [table.name, table]));
const columnsOf = (name) => new Set((current.get(name)?.columns || []).map((column) => column.name));

// ---- 计划 ----
const columnsPlan = SUBMISSIONS_NEW_COLUMNS.filter((name) => !columnsOf(SUBMISSIONS_TABLE).has(name));
const mediaColumnsPlan = current.has(MEDIA_TABLE)
  ? MEDIA_NEW_COLUMNS.filter((name) => !columnsOf(MEDIA_TABLE).has(name))
  : [];
const tablesToCreate = newTables.filter((definition) => !current.has(definition.name));
const tablesExisting = newTables.filter((definition) => current.has(definition.name));

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'preview',
  server,
  writes: apply,
  requiredConfirmation,
  plan: {
    addColumns: {
      [SUBMISSIONS_TABLE]: { missing: columnsPlan, present: SUBMISSIONS_NEW_COLUMNS.filter((name) => columnsOf(SUBMISSIONS_TABLE).has(name)) },
      [MEDIA_TABLE]: { missing: mediaColumnsPlan, present: MEDIA_NEW_COLUMNS.filter((name) => columnsOf(MEDIA_TABLE).has(name)) },
    },
    createTables: tablesToCreate.map((item) => ({ name: item.name, purpose: item.purpose, columns: item.columns })),
    existingTables: tablesExisting.map((item) => item.name),
  },
}, null, 2));

if (!apply) process.exit(0);

const created = [];
const added = [];
const failed = [];

// ---- 加列（只补缺失）----
if (columnsPlan.length) {
  for (const name of columnsPlan) {
    try {
      await base.insertColumn(SUBMISSIONS_TABLE, name, 'text', '');
      added.push(`${SUBMISSIONS_TABLE}.${name}`);
      console.log(`Added column: ${SUBMISSIONS_TABLE}.${name}`);
    } catch (error) {
      const detail = error?.response?.data?.error_msg || error?.response?.data?.detail || error.message;
      failed.push(`${SUBMISSIONS_TABLE}.${name}: ${detail}`);
      console.error(`Failed to add column ${SUBMISSIONS_TABLE}.${name}: ${detail}`);
    }
  }
} else {
  console.log('No missing columns to add.');
}

// ---- 影像素材表加列（v2.1：中心 / 摄影师，只补缺失）----
if (mediaColumnsPlan.length) {
  for (const name of mediaColumnsPlan) {
    try {
      await base.insertColumn(MEDIA_TABLE, name, 'text', '');
      added.push(`${MEDIA_TABLE}.${name}`);
      console.log(`Added column: ${MEDIA_TABLE}.${name}`);
    } catch (error) {
      const detail = error?.response?.data?.error_msg || error?.response?.data?.detail || error.message;
      failed.push(`${MEDIA_TABLE}.${name}: ${detail}`);
      console.error(`Failed to add column ${MEDIA_TABLE}.${name}: ${detail}`);
    }
  }
}

// ---- 建表（拒绝覆盖）----
// 注意：表已存在不等于冲突——增量模式下加列是合法的，跳过建表即可；
// 仅当「既没建过表也没加过列」且存在同名表时才需要人工介入。
if (tablesExisting.length) {
  console.log(`Skip creating already-existing tables: ${tablesExisting.map((item) => item.name).join('、')}.`);
}
for (const definition of tablesToCreate) {
  const columns = definition.columns.map((name, index) => ({
    column_name: name,
    column_type: 'text',
    anchor_column: index === 0 ? '' : definition.columns[index - 1],
  }));
  try {
    await base.addTable(definition.name, 'zh-cn', columns);
    created.push(`${definition.name} (${definition.columns.length} 列)`);
    console.log(`Created table: ${definition.name}`);
  } catch (error) {
    const detail = error?.response?.data?.error_msg || error?.response?.data?.detail || error.message;
    failed.push(`${definition.name}: ${detail}`);
    console.error(`Failed to create ${definition.name}: ${detail}`);
  }
}

// ---- 验证 ----
const verify = await base.getMetadata();
const nowTables = new Map((verify?.tables || []).map((table) => [table.name, table]));
const verifyColumns = (tableName, names) => {
  const present = new Set((nowTables.get(tableName)?.columns || []).map((column) => column.name));
  return names.filter((name) => present.has(name));
};
console.log(JSON.stringify({
  added,
  created,
  failed,
  verified: {
    submissionColumns: verifyColumns(SUBMISSIONS_TABLE, SUBMISSIONS_NEW_COLUMNS),
    mediaTable: nowTables.has(MEDIA_TABLE) ? verifyColumns(MEDIA_TABLE, MEDIA_COLUMNS).length : 0,
    mediaColumns: nowTables.has(MEDIA_TABLE) ? verifyColumns(MEDIA_TABLE, MEDIA_NEW_COLUMNS) : [],
    showcaseTable: nowTables.has(SHOWCASE_TABLE) ? verifyColumns(SHOWCASE_TABLE, SHOWCASE_COLUMNS).length : 0,
  },
}, null, 2));

if (failed.length) process.exitCode = 1;
