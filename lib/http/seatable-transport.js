import { createRequire } from 'node:module';
import {
  DEFAULT_EXTERNAL_TIMEOUT_MS,
  runExternalRequest,
} from './external-request.js';

const require = createRequire(import.meta.url);
const sdkRequire = createRequire(require.resolve('seatable-api'));
const axios = sdkRequire('axios');
let installed = false;

/**
 * 单次 SeaTable 调用的超时上限（毫秒）。
 *
 * SDK 的 axios 实例自带 timeout，实测会把单次调用一路拖到 120 秒；
 * 上游一卡，用户在页面上就要干等两分钟才看到失败，重试还得再等两分钟。
 * 跨境正常往返 200~400ms，2000 行的活动表最慢也就 3 秒，20 秒足够；
 * 真出现「20 秒都不够」的查询，那本来就该改成增量读而不是继续等。
 */
export const DEFAULT_SEATABLE_TIMEOUT_CAP_MS = 20_000;

/** 允许运维用 SEATABLE_TIMEOUT_CAP_MS 覆盖上限（临时放宽时不必改代码）。 */
function resolveTimeoutCapMs() {
  const raw = Number(process.env.SEATABLE_TIMEOUT_CAP_MS);
  return Number.isSafeInteger(raw) && raw >= 1000 ? raw : DEFAULT_SEATABLE_TIMEOUT_CAP_MS;
}

/**
 * Install before SDK authentication creates its HTTP clients.
 * Applies to the Axios copy resolved by seatable-api in this process.
 */
export function installSeaTableTransport() {
  if (installed) return;

  const originalAdapter = axios.getAdapter(axios.defaults.adapter);

  axios.defaults.adapter = async config => {
    // 上层（SDK）给的 timeout 只能更严，不能把单次调用拉长到分钟级。
    const timeoutMs = Math.min(
      config.timeout > 0 ? config.timeout : DEFAULT_EXTERNAL_TIMEOUT_MS,
      resolveTimeoutCapMs(),
    );

    const result = await runExternalRequest(async signal => {
      try {
        const response = await originalAdapter({
          ...config,
          signal,
          // The shared deadline also covers connection and body reading.
          timeout: 0,
        });
        return { response };
      } catch (error) {
        // Preserve HTTP status for existing upstream error handling.
        if (error.response) return { httpError: error };
        throw error;
      }
    }, {
      service: 'seatable',
      operation: String(config.method||'get').toLowerCase()==='get'?'read':'write',
      timeoutMs,
      signal: config.signal,
    });

    if (result.httpError) throw result.httpError;
    return result.response;
  };

  installed = true;
}
