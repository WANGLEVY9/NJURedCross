import { Worker } from 'node:worker_threads';

/** Bound parsing time and isolate document parsing from the HTTP event loop. */
export function processMaterialPdfs(files) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./pdf-worker.js', import.meta.url), { workerData: files,
      resourceLimits: { maxOldGenerationSizeMb: 512 } });
    const failure = message => Object.assign(new Error(message), { statusCode: 400, code: 'reimbursement_pdf_invalid' });
    const timer = setTimeout(() => { worker.terminate(); reject(failure('材料处理超过 30 秒，请减少文件数量或大小后重试。')); }, 30000);
    worker.once('message', payload => {
      clearTimeout(timer); worker.terminate();
      if (payload.ok) resolve({ ...payload.result, merged: Buffer.from(payload.result.merged) });
      else reject(failure(payload.message));
    });
    worker.once('error', () => { clearTimeout(timer); reject(failure('PDF 处理失败，请核对文件后重试。')); });
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(failure('PDF 处理已停止，请重试。')); });
  });
}

/** Bound derivative generation without blocking requests or exposing parser errors. */
export function processItemPackets(input) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./item-packets-worker.js', import.meta.url), { workerData: input,
      resourceLimits: { maxOldGenerationSizeMb: 512 } });
    const failure = () => Object.assign(new Error('按项目合并材料失败，请减少材料数量或稍后重试。'), { statusCode: 400 });
    const timer = setTimeout(() => { worker.terminate(); reject(failure()); }, 30000);
    worker.once('message', payload => {
      clearTimeout(timer); worker.terminate();
      if (!payload.ok) { reject(failure()); return; }
      resolve(payload.packets.map(packet => Object.fromEntries(Object.entries(packet)
        .map(([kind, value]) => [kind, { ...value, bytes: Buffer.from(value.bytes) }]))));
    });
    worker.once('error', () => { clearTimeout(timer); reject(failure()); });
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(failure()); });
  });
}
