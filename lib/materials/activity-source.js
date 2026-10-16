/** Read only the activity definition table; never read participant/account tables. */
export const ACTIVITY_TEST_BASE = '6be54741-fbd0-4e16-9c66-cda281a5d899';
export async function readActivitySource({ token, fetcher = fetch }) {
  const origin = 'https://table.nju.edu.cn';
  const fail = () => { throw Object.assign(new Error('活动目录读取失败，请稍后重试；未使用模拟活动。'), { code: 'activity_source_failed' }); };
  if (!token) return { activities: [], warning: '尚未配置活动只读来源，请由管理员维护本地活动资料。' };
  async function get(url, credential) {
    try {
      const response = await fetcher(url, { method: 'GET', headers: { Authorization: `Token ${credential}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (!response.ok) return fail();
      return await response.json();
    } catch { return fail(); }
  }
  const auth = await get(`${origin}/api/v2.1/dtable/app-access-token/`, token);
  if (auth.dtable_uuid !== ACTIVITY_TEST_BASE || !auth.access_token) fail();
  const endpoint = auth.use_api_gateway ? `${origin}/api-gateway` : String(auth.dtable_server || '').replace(/\/$/, '');
  if (!endpoint || new URL(endpoint).origin !== origin) fail();
  const root = `${endpoint}/api/${auth.use_api_gateway ? 'v2' : 'v1'}/dtables/${ACTIVITY_TEST_BASE}`;
  const metadata = await get(`${root}/metadata/`, auth.access_token);
  if (!(metadata.metadata || metadata).tables?.some(table => table.name === '登记审批')) fail();
  const rows = [], ids = new Set();
  for (let start = 0; ; start += 100) {
    const url = new URL(`${root}/rows/`);
    for (const [key, value] of Object.entries({ table_name: '登记审批', start, limit: 100, convert_keys: true })) url.searchParams.set(key, value);
    const page = await get(url, auth.access_token);
    if (!Array.isArray(page.rows) || page.rows.length > 100) fail();
    for (const row of page.rows) {
      if (!row?._id || ids.has(row._id)) fail();
      ids.add(row._id); rows.push(row);
    }
    if (rows.length > 1000) fail();
    if (page.rows.length < 100) break;
  }
  // Keep this namespace until the activity-centre owner supplies its canonical ID mapping.
  const activities = rows.filter(row => typeof row['活动名称'] === 'string' && row['活动名称'].trim()).map(row => ({
    id: `applications:${row._id}`, name: row['活动名称'].trim().slice(0, 100),
    date: String(row['活动日期'] || '').slice(0, 10), location: String(row['场地'] || '').slice(0, 100),
  }));
  return { activities, capturedAt: new Date().toISOString(), sourceTable: '登记审批', warning: activities.length ? '' : '活动来源暂时没有可选活动，请联系管理员维护本地活动资料。' };
}
