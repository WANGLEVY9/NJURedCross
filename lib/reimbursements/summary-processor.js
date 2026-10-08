import { Worker } from 'node:worker_threads';
import { summaryFailure } from './summary-contract.js';
export function processSummaryPdf(summary, materials) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./summary-pdf-worker.js', import.meta.url), { workerData: { summary, materials }, resourceLimits: { maxOldGenerationSizeMb: 384 } });
    const timer = setTimeout(() => { worker.terminate(); reject(summaryFailure('生成超过 30 秒，请减少材料后重试。')); }, 30000);
    worker.once('message', payload => {
      clearTimeout(timer); worker.terminate();
      if (payload.ok) resolve({ ...payload.result, formPdf: Buffer.from(payload.result.formPdf), packetPdf: Buffer.from(payload.result.packetPdf) });
      else reject(summaryFailure(payload.message));
    });
    worker.once('error', () => { clearTimeout(timer); reject(summaryFailure('报销表生成失败，请核对材料后重试。')); });
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(summaryFailure('生成已停止，请重试。')); });
  });
}
