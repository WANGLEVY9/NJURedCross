import { Base } from 'seatable-api';
import { SUBMISSION_ATTACHMENT_TABLE, SUBMISSION_ATTACHMENT_COLUMNS } from '../lib/attachment/store.js';

/**
 * 创建内容投稿模块的「投稿附件表」：
 *   · 承载投稿附件（影像/文创/配图/截图）的元数据与状态，文件本体在阿里云 OSS
 *
 * 安全模型（与 apply-notice-schema.mjs / apply-account-schema.mjs 一致）：
 *   · 不带 --apply 时只打印计划并退出，不写入
 *   · 写操作需要显式 --confirm=APPLY-NJU-RC-SUBMISSION-ATTACHMENT-TABLE
 *   · 目标表已存在则拒绝写入，绝不覆盖或破坏既有表
 *
 * 「宣传投稿表」的「附件引用」列已存在（历史恒空），本脚本不改既有表结构；
 * 该列的启用（写入 JSON 数组文本）由业务代码完成，见 lib/attachment/store.js。
 *
 * 运行方式：
 *   npm run attachments:dry-run   # 预览
 *   npm run attachments:apply     # 需要上面确认短语
 */

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_API_TOKEN;
const apply = process.argv.includes('--apply');
const confirmation = process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
const requiredConfirmation = 'APPLY-NJU-RC-SUBMISSION-ATTACHMENT-TABLE';

const definitions = [
  {
    name: SUBMISSION_ATTACHMENT_TABLE,
    columns: SUBMISSION_ATTACHMENT_COLUMNS,
    purpose: '内容投稿附件的元数据、外部对象存储引用与上传状态（文件本体在阿里云 OSS 私有 Bucket）',
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
const existing = definitions.filter((definition) => current.has(definition.name));
const missing = definitions.filter((definition) => !current.has(definition.name));

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'preview',
  server,
  writes: apply,
  requiredConfirmation,
  planned: definitions.map((item) => ({ name: item.name, purpose: item.purpose, columns: item.columns })),
  existing: existing.map((item) => item.name),
  toCreate: missing.map((item) => item.name),
}, null, 2));

if (!apply) process.exit(0);
if (existing.length) {
  throw new Error(`Refusing to write because target tables already exist: ${existing.map((item) => item.name).join('、')}. Create them manually or drop the expectation of a clean run.`);
}

const created = [];
const failed = [];
for (const definition of missing) {
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

const verify = await base.getMetadata();
const nowPresent = new Set((verify?.tables || []).map((table) => table.name));
console.log(JSON.stringify({
  created,
  failed,
  verifiedPresent: definitions.filter((item) => nowPresent.has(item.name)).map((item) => item.name),
}, null, 2));

if (failed.length) process.exitCode = 1;
