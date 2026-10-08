/** Remote reads end before the preview starts; its service only receives cloned data. */
import { createMaterialsSourceReader } from '../lib/materials/source-reader.js';
import { createMaterialsSandbox } from '../lib/materials/local-sandbox.js';
import { createPreviewServer } from './preview-materials.mjs';

try {
  const reader = createMaterialsSourceReader({ server: process.env.MATERIALS_READONLY_SERVER,
    token: process.env.MATERIALS_READONLY_TOKEN, uuid: process.env.MATERIALS_READONLY_BASE_UUID });
  const snapshot = await reader.snapshot();
  const fixture = createMaterialsSandbox(snapshot);
  const port = Number(process.env.PORT || 3122);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口不正确');
  const server = await createPreviewServer({ fixture, sourceInfo: { capturedAt: snapshot.capturedAt,
    counts: Object.fromEntries(Object.entries(snapshot.rows).map(([name, rows]) => [name, rows.length])) }, seedSyncFailure: false });
  server.on('error', () => { console.error('本地预览无法启动，请核对端口占用。'); process.exitCode = 1; });
  server.listen(port, () => console.log(`真实数据本地副本：http://127.0.0.1:${port}/console/materials/intake\n远端只读；所有登记仅在本机内存中模拟。`));
} catch (error) {
  console.error(error.code ? error.message : '物资本地副本未建立，请检查本地配置；未回退到演示数据。');
  process.exitCode = 1;
}
