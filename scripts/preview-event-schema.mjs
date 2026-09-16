import { Base } from 'seatable-api';

const server = (process.env.SEATABLE_SERVER_URL || 'https://table.nju.edu.cn').replace(/\/$/, '');
const token = process.env.SEATABLE_API_TOKEN;

if (!token || token === 'replace-with-your-api-token') {
  console.error('Missing SEATABLE_API_TOKEN. This command only reads metadata and never creates tables.');
  process.exitCode = 1;
}

const definitions = [
  {
    name: '活动项目表',
    purpose: '活动基本信息、报名窗口与运营负责人',
    columns: ['活动ID', '活动名称', '活动类型', '活动简介', '校区', '地点', '报名开始', '报名截止', '活动开始', '活动结束', '容量', '负责人', '状态', '公开范围'],
  },
  {
    name: '活动场次表',
    purpose: '同一活动的具体场次与签到配置',
    columns: ['场次ID', '活动ID', '开始时间', '结束时间', '地点', '容量', '签到开放', '签到方式', '状态'],
  },
  {
    name: '活动报名表',
    purpose: '参与者报名、候补、签到与授权记录',
    columns: ['报名ID', '活动ID', '场次ID', '参与者引用', '显示姓名', '南大邮箱', '校区', '报名答案', '同意版本', '报名状态', '候补序号', '签到码摘要', '提交时间', '取消时间', '签到时间'],
  },
];

if (token && token !== 'replace-with-your-api-token') {
  const base = new Base({ server, APIToken: token });
  await base.auth();
  const metadata = await base.getMetadata();
  const current = new Map((metadata?.tables || []).map((table) => [table.name, table]));
  const result = definitions.map((definition) => {
    const table = current.get(definition.name);
    const existing = new Set((table?.columns || []).map((column) => column.name));
    return {
      ...definition,
      exists: Boolean(table),
      tableId: table?._id || null,
      matchedColumns: definition.columns.filter((column) => existing.has(column)),
      missingColumns: definition.columns.filter((column) => !existing.has(column)),
      extraColumns: table ? (table.columns || []).map((column) => column.name).filter((column) => !definition.columns.includes(column)) : [],
    };
  });
  console.log(JSON.stringify({ mode: 'dry-run', writes: false, server, tables: result }, null, 2));
}
