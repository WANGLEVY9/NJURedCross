/* ==========================================================================
   core/upload-retry.js
   「这次上传失败值不值得再试一次」的判定与退避节奏。

   为什么要单独一层：照片是逐张 POST 到新加坡的服务器，手机 4G / 微信
   WebView 在弱网下经常把连接直接掐断，浏览器只回报一个 XHR error
   （status 0，前端显示的正是「网络中断」）。这类断连绝大多数是瞬时的，
   而服务端已经用 clientUploadId 做了幂等回执，重试不会多传一张。
   所以：网络类错误自动重试，业务类拒绝（太大、太频繁、没登录）一次都不要试。

   纯函数、无 DOM 依赖，可直接被 node --test 覆盖。
   ========================================================================== */

/** 自动重试次数上限。再多说明链路本身有问题，该交给用户手动决定。 */
export const UPLOAD_AUTO_RETRIES = 2;

/** 每次重试前的等待（毫秒）：2s、5s，给手机切换网络留出时间。 */
export const UPLOAD_RETRY_DELAYS = [2000, 5000];

/**
 * 单张上传的浏览器层超时。
 * 跨境 1MB 正常 3～15 秒；给到 120 秒足够宽容，又能把「永远转圈」变成明确报错。
 */
export const UPLOAD_TIMEOUT_MS = 120000;

/**
 * 这次失败值不值得自动重试。
 * @param {{status?: number, code?: string}} error ApiError 形态
 */
export function isRetryableUploadError(error) {
  // 没有错误对象本身就没有「重试」这回事（调用方用错，不该安静地重传）。
  if (!error || typeof error !== 'object') return false;
  const status = Number(error?.status) || 0;
  const code = String(error?.code || '');
  // 用户自己取消的（切走页面、点了取消）不该偷偷再来一次。
  if (code === 'aborted') return false;
  // status 0 = 断网 / 连接被重置 / 浏览器超时，都可能是瞬时问题。
  if (status === 0) return true;
  // 限流重试只会更糟；408 这类由服务端排队的也交给用户决定。
  if (status === 408 || status === 429) return false;
  // 5xx 是网关或上游一时无响应（502/503/504 最常见）。
  return status >= 500 && status <= 599;
}

/** 第 attempt 次重试前要等多久（attempt 从 0 开始）。 */
export function uploadRetryDelay(attempt) {
  const index = Math.min(Math.max(Number(attempt) || 0, 0), UPLOAD_RETRY_DELAYS.length - 1);
  return UPLOAD_RETRY_DELAYS[index];
}
