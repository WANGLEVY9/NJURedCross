import { parentPort, workerData } from 'node:worker_threads';
import { renderSupportingPacket } from './supporting-docx.js';
try { parentPort.postMessage({ ok: true, result: await renderSupportingPacket(workerData) }); }
catch (error) { parentPort.postMessage({ ok: false, message: error?.message || '补充材料 Word 生成失败。' }); }
