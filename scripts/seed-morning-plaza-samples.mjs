import { readFile } from 'node:fs/promises';

const env = Object.fromEntries((await readFile(new URL('../.env', import.meta.url), 'utf8'))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const index = line.indexOf('=');
    return index < 0 ? [line, ''] : [line.slice(0, index), line.slice(index + 1)];
  }));

const base = String(env.SEATABLE_SERVER_URL || '').replace(/\/$/, '');
const token = env.SEATABLE_API_TOKEN;
const uuid = env.SEATABLE_BUSINESS_BASE_UUID;
const clean = process.argv.includes('--clean');

if (!base || !token || !uuid) throw new Error('Missing local SeaTable configuration.');
const host = new URL(base).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
  throw new Error('拒绝在非本地模拟 SeaTable 上写入早安晚安样例名片。');
}

const access = await (await fetch(`${base}/api/v2.1/dtable/app-access-token/`, {
  headers: { Authorization: `Token ${token}` },
})).json();
if (!access.access_token) throw new Error('本地模拟 SeaTable 鉴权失败。');

const headers = {
  Authorization: `Token ${access.access_token}`,
  'content-type': 'application/json',
};
const rowsUrl = `${base}/api/v1/dtables/${encodeURIComponent(uuid)}/rows`;

async function rowsOf(table) {
  const response = await fetch(`${rowsUrl}?table_name=${encodeURIComponent(table)}&limit=1000`, { headers });
  const payload = await response.json();
  return Array.isArray(payload.rows) ? payload.rows : [];
}

async function deleteRow(table, id) {
  await fetch(rowsUrl, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ table_name: table, row_id: id }),
  });
}

const table = '早安晚安名片表';
const existing = (await rowsOf(table)).filter((row) => String(row['名片ID'] || '').startsWith('MNG-SAMPLE-'));
for (const row of existing) await deleteRow(table, row._id);

if (clean) {
  console.log(JSON.stringify({ ok: true, mode: 'clean', removed: existing.length }, null, 2));
  process.exit(0);
}

const now = new Date().toISOString();
const samples = [
  ['摄影、跑步', '想找周末一起拍照和慢跑的同伴，也可以一起探索校园周边。', '仙林', '小满'],
  ['读书、电影', '最近在读非虚构，也很喜欢看完电影后慢慢聊天。', '鼓楼', '阿树'],
  ['音乐、桌游', '会一点吉他，喜欢轻松桌游，欢迎一起组局。', '仙林', '林间'],
  ['编程、公益', '平时写代码，也长期关注志愿服务，希望认识有趣的人。', '苏州', '小舟'],
  ['羽毛球、旅行', '想找固定球搭子，假期也会做短途旅行计划。', '浦口', '南风'],
].map(([tags, note, campus, nickname], index) => ({
  名片ID: `MNG-SAMPLE-${String(index + 1).padStart(2, '0')}`,
  账号ID: `ACC-DEMO-MNG-${String(index + 1).padStart(2, '0')}`,
  真实姓名快照: `样例成员${index + 1}`,
  学号快照: `SAMPLE-MNG-${String(index + 1).padStart(2, '0')}`,
  性别快照: '',
  校区: campus,
  昵称: nickname,
  兴趣标签: JSON.stringify(tags.split('、')),
  备注: note,
  审核状态: '已发布',
  审核意见: '',
  审核人: 'local-admin',
  审核时间: now,
  提交时间: now,
  发布时间: new Date(Date.now() - index * 36e5).toISOString(),
  更新时间: now,
}));

for (const sample of samples) {
  const response = await fetch(rowsUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ table_name: table, row: sample }),
  });
  if (!response.ok) throw new Error(`写入样例失败：${sample.名片ID} (${response.status})`);
}

console.log(JSON.stringify({ ok: true, mode: 'seed', created: samples.map((row) => row.名片ID) }, null, 2));
