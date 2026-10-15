import { parentPort, workerData } from 'node:worker_threads';
import { generateSummaryPdf } from './summary-pdf.js';
try { parentPort.postMessage({ ok: true, result: await generateSummaryPdf(workerData.summary, workerData.materials) }); }
catch (error) { parentPort.postMessage({ ok: false, message: error.code === 'reimbursement_summary_invalid' ? error.message : '报销表生成失败，请核对材料后重试。' }); }
