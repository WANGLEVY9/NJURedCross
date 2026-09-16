import { Base } from 'seatable-api';

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_API_TOKEN;
const apply = process.argv.includes('--apply');
const confirmation = process.argv.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length);
const requiredConfirmation = 'CREATE-NJU-RC-EVENT-TABLES';
const definitions = [
  { name: '活动项目表', columns: ['活动ID', '活动名称', '活动类型', '活动简介', '校区', '地点', '报名开始', '报名截止', '活动开始', '活动结束', '容量', '负责人', '状态', '公开范围'] },
  { name: '活动场次表', columns: ['场次ID', '活动ID', '开始时间', '结束时间', '地点', '容量', '签到开放', '签到方式', '状态'] },
  { name: '活动报名表', columns: ['报名ID', '活动ID', '场次ID', '参与者引用', '显示姓名', '南大邮箱', '校区', '报名答案', '同意版本', '报名状态', '候补序号', '签到码摘要', '提交时间', '取消时间', '签到时间'] },
];

if (!token || token === 'replace-with-your-api-token') throw new Error('Missing SEATABLE_API_TOKEN');
if (apply && confirmation !== requiredConfirmation) throw new Error(`Refusing to write. Pass --confirm=${requiredConfirmation} together with --apply.`);

const base = new Base({ server, APIToken: token });
await base.auth();
const metadata = await base.getMetadata();
const current = new Map((metadata?.tables || []).map((table) => [table.name, table]));
const existing = definitions.filter((definition) => current.has(definition.name));
const missing = definitions.filter((definition) => !current.has(definition.name));

console.log(JSON.stringify({ mode: apply ? 'apply' : 'preview', writes: apply, requiredConfirmation, existing: existing.map((item) => item.name), toCreate: missing.map((item) => ({ name: item.name, columns: item.columns })) }, null, 2));

if (!apply) process.exit(0);
if (existing.length) throw new Error(`Refusing to write because target tables already exist: ${existing.map((item) => item.name).join('、')}`);

for (const definition of missing) {
  const columns = definition.columns.map((name, index) => ({ column_name: name, column_type: 'text', anchor_column: index === 0 ? '' : definition.columns[index - 1] }));
  await base.addTable(definition.name, 'zh-cn', columns);
  console.log(`Created table: ${definition.name}`);
}
