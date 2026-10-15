import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** One page per request with a bounded lifetime. Killing the child also ends its OCR threads. */
export function processLocalAnalysis(input) {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(new URL('./analysis-child.js', import.meta.url)), [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced',
      execArgv: ['--max-old-space-size=384'], windowsHide: true,
    });
    const failure = message => Object.assign(new Error(message), { statusCode: 503, code: 'reimbursement_analysis_failed' });
    const timer = setTimeout(() => { child.kill(); reject(failure('本页识别超过 45 秒，请使用更清晰的材料或人工核对。')); }, 45000);
    child.once('message', payload => {
      clearTimeout(timer); child.kill();
      if (payload.ok) resolve(payload.result); else reject(failure(payload.message));
    });
    child.once('error', () => { clearTimeout(timer); child.kill(); reject(failure('本地识别进程无法启动，请人工核对。')); });
    child.once('exit', () => { clearTimeout(timer); reject(failure('本地识别进程已停止，请重试或人工核对。')); });
    child.send(input);
  });
}
