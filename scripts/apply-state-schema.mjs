import { Base } from 'seatable-api';

/**
 * Creates the six tables that replace the former `logs/*.json` state files, so
 * that every piece of platform data lives in SeaTable instead of the server's
 * local filesystem.
 *
 * Safety model (same as apply-event-schema.mjs):
 *   · prints a plan and exits without writing unless `--apply` is passed
 *   · requires an explicit --confirm phrase
 *   · refuses to run if any target table already exists, so it can never
 *     overwrite or partially clobber a live table
 */

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_API_TOKEN;
const apply = process.argv.includes('--apply');
const confirmation = process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
const requiredConfirmation = 'CREATE-NJU-RC-STATE-TABLES';

const definitions = [
  {
    name: '宣传项目表',
    replaces: null,
    purpose: '宣传主题、征集窗口、受众与发布渠道（与平台的宣传投稿/发布任务配对）',
    columns: ['项目ID', '项目名称', '项目类型', '征集开始', '征集截止', '目标受众', '发布渠道', '状态', '负责人', '授权版本'],
  },
  {
    name: '宣传投稿表',
    replaces: 'logs/public-submissions.json + logs/outreach-reviews.json',
    purpose: '公众端内容投稿，以及对既有策划案/文创/课程反馈的人工审核结论',
    columns: [
      '投稿ID', '来源', '项目ID', '类别', '标题', '正文', '附件引用',
      '投稿人引用', '联系人', '联系邮箱', '对外署名', '公开范围',
      '原创确认', '肖像授权', '同意版本',
      '审核状态', '审核意见', '审核人', '提交时间', '审核时间',
    ],
  },
  {
    name: '宣传发布任务表',
    replaces: 'logs/outreach-publications.json',
    purpose: '渠道排期、发布确认、链接与失败重试记录',
    columns: ['任务ID', '投稿ID', '发布渠道', '计划发布时间', '发布状态', '发布链接', '失败原因', '重试次数', '确认人', '完成时间', '备注', '创建人', '创建时间'],
  },
  {
    name: '温暖连接参加表',
    replaces: 'logs/warmth-interest.json + logs/community-consent.json',
    purpose: '公众端自愿登记与控制台侧同意记录；两者统一为「参加关系」，状态与处理留痕在同一行',
    columns: [
      '登记ID', '来源', '项目', '频率', '昵称', '参与者标识', '邮箱', '校区',
      '生日月日', '备注', '内容模式', '状态', '同意版本', '提交时间', '处理人', '处理时间',
    ],
  },
  {
    name: '温暖连接投稿表',
    replaces: 'logs/community-submissions.json',
    purpose: '生日祝福与早安晚安内容投稿，以及审核结论',
    columns: ['投稿ID', '项目', '内容', '语气', '提交人', '状态', '审核意见', '审核人', '提交时间', '审核时间', '同意版本'],
  },
  {
    name: '操作审计表',
    replaces: 'logs/audit.jsonl',
    purpose: '登录、审批、出入库、签到核验、内容审核、公众端提交的操作留痕（不记录任何密钥或签到码明文）',
    columns: ['审计ID', '时间', '操作人', '角色', '动作', '对象', '结果', 'IP', '备注'],
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
  planned: definitions.map((item) => ({ name: item.name, columns: item.columns.length, replaces: item.replaces })),
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
