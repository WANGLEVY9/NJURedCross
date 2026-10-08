import { parentPort, workerData } from 'node:worker_threads';
import { processPdfs } from './pdf.js';
try { parentPort.postMessage({ ok: true, result: await processPdfs(workerData) }); }
catch (error) { parentPort.postMessage({ ok: false, message: error.statusCode === 400 ? error.message : 'PDF 处理失败，请核对文件后重试。' }); }
