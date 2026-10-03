/** UI preview only: no .env, SeaTable, credentials, login or business writes. */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createStaticHandler } from '../lib/http/static.js';
import { json } from '../lib/http/response.js';
const staticFile = createStaticHandler(fileURLToPath(new URL('../public/', import.meta.url)));
const port = Number(process.env.PORT || 3000);
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/auth/session' && req.method === 'GET') return json(res, 200, { ok: true, authenticated: false });
    if (url.pathname.startsWith('/api/')) return json(res, 503, { ok: false, code: 'preview_only', message: '当前为界面预览；业务功能需要独立测试环境。' });
    return await staticFile(req, res, url);
  } catch {
    if (!res.headersSent) json(res, 500, { ok: false, message: 'Preview request failed' });
    else res.destroy();
  }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`UI preview: http://127.0.0.1:${port} (business APIs disabled)`));
