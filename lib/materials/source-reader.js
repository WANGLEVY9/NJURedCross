/** Local read-only adapter. Credentials and access-token responses never leave this module. */
export const MATERIAL_SOURCE_TABLES = Object.freeze(['工位物资表', '物资配置表', '物资流水表', '物资管理']);
export const MATERIAL_TEST_BASE = 'c707b1ab-ac5c-46b3-9d77-1bc4ea16f241';

function failure(code, message, phase, upstreamStatus) {
  return Object.assign(new Error(message), { code, phase, upstreamStatus });
}

export function createMaterialsSourceReader({ server, token, uuid = MATERIAL_TEST_BASE, fetcher = fetch }) {
  if (uuid !== MATERIAL_TEST_BASE) throw new Error('本地查看器仅允许连接物资管理试验板');
  const origin = new URL(server).origin;
  if (origin !== 'https://table.nju.edu.cn') throw new Error('服务地址须先核实，当前仅允许 https://table.nju.edu.cn');
  if (!token) throw new Error('缺少物资试验板凭据');
  let connection;
  let connecting;
  let expires = 0;
  async function get(url, credential, phase) {
    let response;
    try {
      response = await fetcher(url, { method: 'GET', headers: { Authorization: `Token ${credential}` },
        redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch {
      throw failure('connection_failed', '无法连接数据服务，请检查网络或服务状态。', phase);
    }
    if (!response.ok) throw failure('upstream_failed', `数据服务返回 HTTP ${response.status}，尚未获取本次请求的数据。`, phase, response.status);
    try { return await response.json(); } catch {
      throw failure('invalid_response', '数据服务未返回有效 JSON，尚未获取数据。', phase);
    }
  }
  async function authenticate() {
    if (connection && Date.now() < expires) return connection;
    if (!connecting) connecting = (async () => {
      const auth = await get(`${origin}/api/v2.1/dtable/app-access-token/`, token, 'authentication');
      if (auth.dtable_uuid !== uuid) throw failure('base_mismatch', '认证返回的表格与物资试验板不一致，已停止读取。', 'authentication');
      const endpoint = auth.use_api_gateway ? `${origin}/api-gateway` : String(auth.dtable_server || '').replace(/\/$/, '');
      // Do not send credentials to an unrelated host supplied in a malformed response.
      if (!auth.access_token || !endpoint || new URL(endpoint).origin !== origin)
        throw failure('invalid_endpoint', '数据服务返回了未确认的接口地址，已停止读取。', 'authentication');
      connection = { endpoint, credential: auth.access_token, version: auth.use_api_gateway ? 'v2' : 'v1' };
      expires = Date.now() + 5 * 60 * 1000;
      return connection;
    })().finally(() => { connecting = null; });
    return connecting;
  }
  async function read(resource, phase, query = {}) {
    const auth = await authenticate();
    const url = new URL(`${auth.endpoint}/api/${auth.version}/dtables/${uuid}/${resource}/`);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, String(value));
    try { return await get(url, auth.credential, phase); } catch (error) {
      if ([401, 403].includes(error.upstreamStatus)) { connection = null; expires = 0; }
      throw error;
    }
  }
  async function metadata() {
    const payload = await read('metadata', 'metadata');
    const tables = (payload.metadata || payload).tables;
    if (!Array.isArray(tables)) throw failure('invalid_response', '表结构返回格式不正确。', 'metadata');
    return MATERIAL_SOURCE_TABLES.map(name => {
      const table = tables.find(item => item.name === name);
      return { name, exists: Boolean(table), columns: table?.columns || [] };
    });
  }
  async function rows(name, start = 0) {
    if (!MATERIAL_SOURCE_TABLES.includes(name)) throw failure('table_forbidden', '仅允许读取物资模块使用的四张表。', 'rows');
    if (!Number.isSafeInteger(start) || start < 0) throw failure('invalid_page', '分页位置不正确。', 'rows');
    const payload = await read('rows', 'rows', { table_name: name, start, limit: 100,
      convert_keys: true, convert_link_id: true });
    if (!Array.isArray(payload.rows)) throw failure('invalid_response', '记录返回格式不正确。', 'rows');
    return { table: name, start, limit: 100, rows: payload.rows };
  }
  async function snapshot({ maxRows = 10000 } = {}) {
    if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 10000) throw new Error('快照容量须为 1 至 10000 行');
    const tables = await metadata(), data = {};
    if (tables.some(table => !table.exists)) throw failure('snapshot_incomplete', '物资表不完整，未建立开发副本。', 'snapshot');
    for (const table of tables) {
      const collected = [], ids = new Set();
      for (let start = 0; ; start += 100) {
        const page = await rows(table.name, start);
        if (page.rows.length > 100) throw failure('snapshot_incomplete', '分页返回超过约定上限，已停止加载。', 'snapshot');
        for (const row of page.rows) {
          if (!row || typeof row._id !== 'string' || !row._id || ids.has(row._id))
            throw failure('snapshot_incomplete', '分页含缺失或重复记录编号，未建立开发副本。', 'snapshot');
          ids.add(row._id); collected.push(row);
        }
        if (collected.length > maxRows) throw failure('snapshot_incomplete', '物资记录超过开发副本容量，未截断加载。', 'snapshot');
        if (page.rows.length < 100) break;
      }
      data[table.name] = collected;
    }
    return { tables: tables.map(({ name, columns }) => ({ name, columns })), rows: data, capturedAt: new Date().toISOString() };
  }
  return Object.freeze({ metadata, rows, snapshot });
}
