/** Local API viewer: no identity Base, synthetic fallback, migrations or write routes. */
import http from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMaterialsSourceReader, MATERIAL_TEST_BASE } from '../lib/materials/source-reader.js';
import { json } from '../lib/http/response.js';
import { createStaticHandler } from '../lib/http/static.js';

export function createMaterialsSourceServer(reader) {
  const staticFile = createStaticHandler(fileURLToPath(new URL('../public/materials-source/', import.meta.url)));
  const server = http.createServer(async (req, res) => {
    const port = server.address().port;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !hosts.includes(req.headers.host)
      || (req.headers.origin && !hosts.some(host => req.headers.origin === `http://${host}`)))
      return json(res, 403, { ok: false, message: '仅允许本机同源访问。' });
    if (req.method !== 'GET') return json(res, 405, { ok: false, message: '此查看器只读，禁止写入。' }, { Allow: 'GET' });
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    try {
      if (url.pathname === '/api/materials-source/schema')
        return json(res, 200, { ok: true, readOnly: true, baseName: '物资管理试验板', uuid: MATERIAL_TEST_BASE, tables: await reader.metadata() });
      if (url.pathname === '/api/materials-source/rows') {
        const startText = url.searchParams.get('start') || '0';
        if (!/^\d+$/.test(startText)) return json(res, 400, { ok: false, message: '分页位置不正确。' });
        return json(res, 200, { ok: true, readOnly: true, ...await reader.rows(url.searchParams.get('table'), Number(startText)) });
      }
      if (url.pathname.startsWith('/api/')) return json(res, 404, { ok: false, message: '接口不存在。' });
      return await staticFile(req, res, url);
    } catch (error) {
      // Do not forward SDK errors, upstream HTML or credential-bearing response objects.
      const code = error.code;
      const invalid = ['table_forbidden', 'invalid_page'].includes(code);
      const known = ['connection_failed', 'upstream_failed', 'invalid_response', 'base_mismatch', 'invalid_endpoint', 'table_forbidden', 'invalid_page'].includes(code);
      return json(res, invalid ? 400 : 502, { ok: false, readOnly: true, code: known ? code : 'read_failed',
        message: known ? error.message : '读取数据失败。', phase: known ? error.phase : undefined,
        upstreamStatus: known ? error.upstreamStatus : undefined });
    }
  });
  const listen = server.listen.bind(server);
  server.listen = (port, hostOrCallback, callback) => {
    if (!Number.isInteger(port) || (typeof hostOrCallback === 'string' && hostOrCallback !== '127.0.0.1'))
      throw new Error('只允许监听本机 127.0.0.1');
    return listen(port, '127.0.0.1', typeof hostOrCallback === 'function' ? hostOrCallback : callback);
  };
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reader = createMaterialsSourceReader({ server: process.env.MATERIALS_READONLY_SERVER,
    token: process.env.MATERIALS_READONLY_TOKEN, uuid: process.env.MATERIALS_READONLY_BASE_UUID });
  const port = Number(process.env.MATERIALS_READONLY_PORT || 3123);
  createMaterialsSourceServer(reader).listen(port, () => console.log(`物资 API 只读查看页：http://127.0.0.1:${port}/`));
}
