import { runWorkerTask } from '../worker-task.js';

/** Bound parsing time and isolate document parsing from the HTTP event loop. */
export function processMaterialPdfs(files) {
  const failure = message => Object.assign(new Error(message), { statusCode: 400, code: 'reimbursement_pdf_invalid' });
  return runWorkerTask(new URL('./pdf-worker.js', import.meta.url), { workerData: files,
    resourceLimits: { maxOldGenerationSizeMb: 512 } }, {
    timeoutMs: 30000,
    failure: () => failure('PDF 处理失败，请核对文件后重试。'),
    timeoutFailure: () => failure('材料处理超过 30 秒，请减少文件数量或大小后重试。'),
  }).then(payload => {
    if (!payload.ok) throw failure(payload.message);
    return { ...payload.result, merged: Buffer.from(payload.result.merged) };
  });
}

/** Bound derivative generation without blocking requests or exposing parser errors. */
export function processItemPackets(input) {
  const failure = () => Object.assign(new Error('按项目合并材料失败，请减少材料数量或稍后重试。'), { statusCode: 400 });
  return runWorkerTask(new URL('./item-packets-worker.js', import.meta.url), { workerData: input,
    resourceLimits: { maxOldGenerationSizeMb: 512 } }, { timeoutMs: 30000, failure }).then(payload => {
    if (!payload.ok) throw failure();
    return payload.packets.map(packet => Object.fromEntries(Object.entries(packet)
      .map(([kind, value]) => [kind, { ...value, bytes: Buffer.from(value.bytes) }])));
  });
}
