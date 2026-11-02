import { runWorkerTask } from '../worker-task.js';
import { summaryFailure } from './summary-contract.js';
export function processSummaryPdf(summary, materials) {
  return runWorkerTask(new URL('./summary-pdf-worker.js', import.meta.url), { workerData: { summary, materials }, resourceLimits: { maxOldGenerationSizeMb: 512 } }, {
    timeoutMs: 30000,
    failure: () => summaryFailure('报销表生成失败，请核对材料后重试。'),
    timeoutFailure: () => summaryFailure('生成超过 30 秒，请减少材料后重试。'),
  }).then(payload => {
    if (!payload.ok) throw summaryFailure(payload.message);
    return { ...payload.result, formPdf: Buffer.from(payload.result.formPdf), packetPdf: Buffer.from(payload.result.packetPdf) };
  });
}
