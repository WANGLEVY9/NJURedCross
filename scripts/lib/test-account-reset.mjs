/* ==========================================================================
   scripts/lib/test-account-reset.mjs
   本地测试账号重置：把 local-member / local-admin 的生日祝福相关数据恢复到
   干净状态，供冒烟与样例脚本重复执行（避免 3 条上限、黑名单与历史投递干扰）。

   仅在本地模拟 SeaTable 上运行；会删除两个测试号的投稿、入库、投递、举报、
   黑名单记录，并把生日祝福登记恢复为「已确认」。
   ========================================================================== */

export async function resetTestAccountData(env, {
  usernames = ['local-member', 'local-admin'],
  studentIds = ['999990002', '999990001'],
} = {}) {
  const base = String(env.SEATABLE_SERVER_URL || '');
  if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(base).hostname)) {
    throw new Error('拒绝在非本地 SeaTable 上重置测试账号数据');
  }
  const auth = await (await fetch(`${base}/api/v2.1/dtable/app-access-token/`, { headers: { Authorization: `Token ${env.SEATABLE_API_TOKEN}` } })).json();
  if (!auth.access_token) throw new Error('本地模拟 SeaTable 鉴权失败');
  const headers = { Authorization: `Token ${auth.access_token}`, 'content-type': 'application/json' };
  const uuid = env.SEATABLE_BUSINESS_BASE_UUID;
  const rowsOf = async (table) => (await (await fetch(`${base}/api/v1/dtables/${encodeURIComponent(uuid)}/rows?table_name=${encodeURIComponent(table)}&limit=1000`, { headers })).json()).rows || [];
  const del = (table, id) => fetch(`${base}/api/v1/dtables/${encodeURIComponent(uuid)}/rows`, { method: 'DELETE', headers, body: JSON.stringify({ table_name: table, row_id: id }) });
  const upd = (table, id, patch) => fetch(`${base}/api/v1/dtables/${encodeURIComponent(uuid)}/rows`, { method: 'PUT', headers, body: JSON.stringify({ table_name: table, row_id: id, row: patch }) });

  const userSet = new Set(usernames);
  const studentSet = new Set(studentIds);

  const submissions = (await rowsOf('温暖连接投稿表')).filter((row) => userSet.has(String(row['提交人'] || '')));
  const ids = new Set(submissions.map((row) => String(row['投稿ID'] || '')));
  const library = (await rowsOf('温暖祝福库表')).filter((row) => userSet.has(String(row['来源投稿人'] || '')) || ids.has(String(row['投稿ID'] || '')));
  const deliveries = (await rowsOf('温暖祝福投递表')).filter((row) => ids.has(String(row['投稿ID'] || '')) || studentSet.has(String(row['收件人学号'] || '')));
  const reports = (await rowsOf('温暖祝福举报表')).filter((row) => ids.has(String(row['投稿ID'] || '')) || studentSet.has(String(row['举报人学号'] || '')));
  const blacklist = (await rowsOf('温暖连接黑名单表')).filter((row) => studentSet.has(String(row['学号'] || '')));

  for (const row of reports) await del('温暖祝福举报表', row._id);
  for (const row of deliveries) await del('温暖祝福投递表', row._id);
  for (const row of library) await del('温暖祝福库表', row._id);
  for (const row of blacklist) await del('温暖连接黑名单表', row._id);
  for (const row of submissions) await del('温暖连接投稿表', row._id);

  const enrollments = (await rowsOf('温暖连接参加表')).filter((row) => String(row['项目'] || '') === 'birthday'
    && (String(row['参与者标识'] || '').includes('LOCAL') || String(row['邮箱'] || '').startsWith('local-')));
  let restored = 0;
  for (const row of enrollments) {
    if (String(row['状态'] || '') !== '已确认') {
      await upd('温暖连接参加表', row._id, { 状态: '已确认', 处理人: '本地测试重置' });
      restored += 1;
    }
  }

  return { submissions: submissions.length, library: library.length, deliveries: deliveries.length, reports: reports.length, blacklist: blacklist.length, enrollments: restored };
}
