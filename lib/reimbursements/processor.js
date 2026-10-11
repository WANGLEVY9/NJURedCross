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
