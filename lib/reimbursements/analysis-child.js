import { analyzeLocalPage } from './local-analysis.js';
// Prevent default network fallback: models are read from an explicit local directory.
import http from 'node:http';
import https from 'node:https';
const offline = () => { throw new Error('OCR 进程不允许外部网络请求'); };
http.request = offline; http.get = offline; https.request = offline; https.get = offline; globalThis.fetch = offline;
process.once('message', async input => {
  try { process.send({ ok: true, result: await analyzeLocalPage(input) }); }
  catch { process.send({ ok: false, message: '本地识别失败，请确认模型已安装或改用人工核对。' }); }
  finally { process.disconnect(); }
});
