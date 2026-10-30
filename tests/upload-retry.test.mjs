import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UPLOAD_AUTO_RETRIES,
  UPLOAD_RETRY_DELAYS,
  UPLOAD_TIMEOUT_MS,
  isRetryableUploadError,
  uploadRetryDelay,
} from '../public/app/core/upload-retry.js';

/** 造一个 ApiError 形态的对象（不 import api.js，避免把浏览器模块拉进来）。 */
function fail(status, code = '') {
  return { status, code };
}

test('网络类失败自动重试：断连、超时、网关 5xx', () => {
  assert.equal(isRetryableUploadError(fail(0, 'offline')), true, '断网');
  assert.equal(isRetryableUploadError(fail(0, 'timeout')), true, '浏览器超时');
  assert.equal(isRetryableUploadError(fail(0)), true, '未知的 status 0 也当网络问题');
  assert.equal(isRetryableUploadError(fail(502)), true);
  assert.equal(isRetryableUploadError(fail(503)), true);
  assert.equal(isRetryableUploadError(fail(504)), true);
  assert.equal(isRetryableUploadError(fail(500)), true);
});

test('业务类拒绝一次都不重试：取消、太大、没登录、限流、参数错', () => {
  assert.equal(isRetryableUploadError(fail(0, 'aborted')), false, '用户自己取消的');
  assert.equal(isRetryableUploadError(fail(400)), false);
  assert.equal(isRetryableUploadError(fail(401)), false);
  assert.equal(isRetryableUploadError(fail(403)), false);
  assert.equal(isRetryableUploadError(fail(413)), false);
  assert.equal(isRetryableUploadError(fail(429)), false, '限流后重试只会更糟');
  assert.equal(isRetryableUploadError(fail(408)), false);
});

test('空值与异常输入不炸：没有错误对象就当不可重试', () => {
  assert.equal(isRetryableUploadError(null), false);
  assert.equal(isRetryableUploadError(undefined), false);
  assert.equal(isRetryableUploadError('boom'), false);
  // 有对象但没带 status：按「浏览器层失败」处理，重试是安全的（服务端幂等）。
  assert.equal(isRetryableUploadError({}), true);
  assert.equal(isRetryableUploadError({ status: '503' }), true, '字符串状态码也能认');
});

test('退避节奏：2s、5s，越界取边界值', () => {
  assert.deepEqual(UPLOAD_RETRY_DELAYS, [2000, 5000]);
  assert.equal(uploadRetryDelay(0), 2000);
  assert.equal(uploadRetryDelay(1), 5000);
  assert.equal(uploadRetryDelay(2), 5000, '超出数组长度时取最后一次的等待');
  assert.equal(uploadRetryDelay(-1), 2000);
  assert.equal(uploadRetryDelay('1'), 5000);
});

test('常量落在合理区间：重试不超过 3 次，超时不超过 3 分钟', () => {
  assert.ok(UPLOAD_AUTO_RETRIES >= 1 && UPLOAD_AUTO_RETRIES <= 3);
  assert.equal(UPLOAD_RETRY_DELAYS.length, UPLOAD_AUTO_RETRIES);
  assert.ok(UPLOAD_TIMEOUT_MS >= 60000 && UPLOAD_TIMEOUT_MS <= 180000, '太短会误杀慢速上传，太长又会一直转圈');
});
