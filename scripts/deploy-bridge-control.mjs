import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';

/**
 * 控制部署桥接：pause 等在途请求排空后暂停转发，resume 等后端就绪后放行。
 *
 * 2026-11-14 事故：resume 只等 10 秒就判「未就绪」，并且故意保持 paused，
 * 于是 1 GiB 实例冷启动稍微慢一点就变成全站 503（`Deployment wait exceeded`），
 * 回滚调的还是同一个 resume，连自动恢复都没有。现在的口径是：
 *   1. 就绪窗口放到 180 秒（`NJRC_BRIDGE_READY_TIMEOUT_MS` 可覆盖）；
 *   2. 等不到也必须放行——让请求打到真实后端拿 502/正常响应，而不是被队列扣住；
 *   3. 就绪与否写进 stdout 的 JSON 回执（`ready`），由发布接收器决定怎么记账。
 * resume 只在「控制通道本身打不通」时才失败，因为那时确实无法解除暂停。
 */
export const READY_TIMEOUT_MS = Number(process.env.NJRC_BRIDGE_READY_TIMEOUT_MS || 180000);
export const READY_POLL_MS = Number(process.env.NJRC_BRIDGE_READY_POLL_MS || 250);
export const READY_STREAK = 2;
export const DEFAULT_SOCKET = process.env.NJRC_BRIDGE_SOCKET || '/var/lib/njuredcross-deploy/bridge.sock';
export const BACKEND_PORT = Number(process.env.NJRC_BACKEND_PORT || process.env.PORT || 3000);

export function isReadyPage({status, body} = {}) {
  return status === 200 && typeof body === 'string' && body.includes('id="root"');
}

export async function waitForReady({probe, timeoutMs = READY_TIMEOUT_MS, pollMs = READY_POLL_MS, now = Date.now} = {}) {
  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  let streak = 0;
  let lastError = 'backend never answered';
  while (streak < READY_STREAK) {
    try {
      const result = await probe();
      if (isReadyPage(result)) {
        streak += 1;
        lastError = null;
      } else {
        streak = 0;
        lastError = `http ${result?.status ?? 'unknown'}`;
      }
    } catch (error) {
      streak = 0;
      lastError = error?.code || error?.message || 'probe failed';
    }
    if (streak < READY_STREAK) {
      if (now() >= deadline) return {ready: false, waitedMs: now() - startedAt, lastError};
      await delay(pollMs);
    }
  }
  return {ready: true, waitedMs: now() - startedAt, lastError: null};
}

export function backendProbe({port = BACKEND_PORT, timeoutMs = 5000} = {}) {
  return async () => {
    const response = await fetch(`http://127.0.0.1:${port}/`, {signal: AbortSignal.timeout(timeoutMs)});
    return {status: response.status, body: await response.text()};
  };
}

function control(action, socketPath) {
  return new Promise((resolve, reject) => {
    const request = http.request({socketPath, path: `/${action}`, method: action === 'status' ? 'GET' : 'POST'}, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(Error(`Deployment bridge rejected ${action}: ${text.trim() || response.statusCode}`));
          return;
        }
        resolve(text.trim());
      });
    });
    request.setTimeout(65000, () => request.destroy(Error('Deployment bridge control timed out')));
    request.on('error', reject);
    request.end();
  });
}

const parse = text => {
  try { return JSON.parse(text || '{}'); } catch { return {raw: text}; }
};

export async function run(action, {probe = backendProbe(), socketPath = DEFAULT_SOCKET, timeoutMs = READY_TIMEOUT_MS, send = control} = {}) {
  if (action === 'status' || action === 'pause') return {action, bridge: parse(await send(action, socketPath))};
  const readiness = await waitForReady({probe, timeoutMs});
  // 无论就绪与否都要放行：等不到后端只意味着「慢」，不该让整个站点排队到超时。
  const bridge = parse(await send('resume', socketPath));
  return {action: 'resume', ready: readiness.ready, waitedMs: readiness.waitedMs, lastError: readiness.lastError, bridge};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const action = process.argv[2];
  if (!['pause', 'resume', 'status'].includes(action)) throw Error('Expected pause, resume or status');
  const receipt = await run(action);
  process.stdout.write(JSON.stringify(receipt) + '\n');
  if (receipt.action === 'resume' && receipt.ready === false) {
    process.stderr.write(`Backend not ready after ${receipt.waitedMs}ms (${receipt.lastError}); deployment queue released anyway\n`);
  }
}
