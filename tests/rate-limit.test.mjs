import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, rateLimitError } from '../lib/http/rate-limit.js';

function makeClock(start = 0) {
  let current = start;
  return { now: () => current, advance: (ms) => { current += ms; } };
}

const req = (ip = '10.0.0.1') => ({ socket: { remoteAddress: ip } });

test('限流：额度内放行，超限抛 429 并给出剩余秒数', () => {
  const clock = makeClock();
  const enforce = createRateLimiter({ now: clock.now, windowMs: 60 * 60 * 1000 });

  for (let i = 1; i <= 3; i += 1) enforce(req(), 'media-upload', 3, 'alice');

  assert.throws(
    () => enforce(req(), 'media-upload', 3, 'alice'),
    (error) => {
      assert.equal(error.statusCode, 429);
      assert.equal(error.retryAfterSeconds, 3600, '整窗剩余 3600 秒');
      assert.equal(error.message, '提交过于频繁，请在 60 分钟后重试。');
      return true;
    },
  );

  clock.advance(12 * 60 * 1000);
  assert.throws(
    () => enforce(req(), 'media-upload', 3, 'alice'),
    (error) => {
      assert.equal(error.retryAfterSeconds, 2880, '过了 12 分钟应提示 48 分钟');
      assert.equal(error.message, '提交过于频繁，请在 48 分钟后重试。');
      return true;
    },
  );
});

test('限流：窗口到期后重新计数', () => {
  const clock = makeClock();
  const enforce = createRateLimiter({ now: clock.now, windowMs: 1000 });
  enforce(req(), 'lookup', 1, '');
  assert.throws(() => enforce(req(), 'lookup', 1, ''), /提交过于频繁/);
  clock.advance(1001);
  assert.doesNotThrow(() => enforce(req(), 'lookup', 1, ''));
});

test('限流：不同桶、不同账号互不占额度', () => {
  const clock = makeClock();
  const enforce = createRateLimiter({ now: clock.now });
  enforce(req(), 'media-upload', 1, 'alice');
  // 同账号换桶（精选/下载/更名）不受上传额度影响
  assert.doesNotThrow(() => enforce(req(), 'media-pick', 1, 'alice'));
  assert.doesNotThrow(() => enforce(req(), 'media-download', 1, 'alice'));
  assert.doesNotThrow(() => enforce(req(), 'media-rename', 1, 'alice'));
  // 同 IP 的其他账号不受影响（校园网共用出口）
  assert.doesNotThrow(() => enforce(req('10.0.0.1'), 'media-upload', 1, 'bob'));
  // 同账号同桶才会共享计数
  assert.throws(() => enforce(req('10.0.0.2'), 'media-upload', 1, 'alice'), /提交过于频繁/);
});

test('限流：没有账号身份时退回按客户端地址计数', () => {
  const clock = makeClock();
  const enforce = createRateLimiter({ now: clock.now });
  enforce(req('192.0.2.7'), 'submissions', 1);
  assert.throws(() => enforce(req('192.0.2.7'), 'submissions', 1), /提交过于频繁/);
  assert.doesNotThrow(() => enforce(req('192.0.2.8'), 'submissions', 1), '不同地址各自计数');
});

test('限流：过期条目会被清理，不会无限增长', () => {
  const clock = makeClock();
  const store = new Map();
  const enforce = createRateLimiter({ now: clock.now, windowMs: 1000, store });
  for (let i = 0; i < 20; i += 1) enforce(req(`10.0.1.${i}`), 'lookup', 5);
  assert.equal(store.size, 20);
  clock.advance(1001);
  enforce(req('10.0.2.1'), 'lookup', 5);
  assert.equal(store.size, 1, '旧窗口全部清掉，只剩当前条目');
});

test('rateLimitError：分钟数向上取整且不小于 1', () => {
  assert.equal(rateLimitError(1).message, '提交过于频繁，请在 1 分钟后重试。');
  assert.equal(rateLimitError(0).retryAfterSeconds, 1);
  assert.equal(rateLimitError(59.2).message, '提交过于频繁，请在 1 分钟后重试。');
  assert.equal(rateLimitError(2880).message, '提交过于频繁，请在 48 分钟后重试。');
});
