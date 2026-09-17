import { Base } from 'seatable-api';

/**
 * 创建活动运营闭环新增的两张表：
 *   · 活动通知表 —— 报名通知的生成与发布记录
 *   · 活动附件表 —— 策划案 / 宣传物料等 box 附件引用与上传记录
 *
 * 安全模型（与 apply-state-schema.mjs 一致）：
 *   · 不带 --apply 时只打印计划并退出，不写入
 *   · 写操作需要显式 --confirm 短语
 *   · 任意目标表已存在则拒绝写入，绝不覆盖或破坏既有表
 */

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_API_TOKEN;
const apply = process.argv.includes('--apply');
const confirmation = process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
const requiredConfirmation = 'APPLY-NJU-RC-NOTICE-TABLES';

const definitions = [
  {
    name: '活动通知表',
    purpose: '固定框架生成的报名通知，含正文、状态与生成/发布留痕',
    columns: ['通知ID', '活动ID', '活动名称', '活动类别', '活动时间', '活动地点', '报名窗口', '正文', '状态', '生成人', '生成时间', '发布时间', '备注'],
  },
  {
    name: '活动附件表',
    purpose: '活动策划案、宣传物料等 njubox（Seafile）附件的引用与上传记录',
    columns: ['附件ID', '活动ID', '用途', '文件名', '大小', '校验和', '库ID', '路径', '下载链接', '上传人', '上传时间'],
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
  planned: definitions.map((item) => ({ name: item.name, columns: item.columns.length })),
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
