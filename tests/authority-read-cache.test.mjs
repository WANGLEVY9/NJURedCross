import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readAuthorityEvents,
  readAuthorityEventsFresh,
  authorityEventsTtlMs,
  AUTHORITY_EVENTS_TABLE,
} from '../lib/events/organization-authority.js';
import {
  withDisplayReads,
  clearDisplayReads,
  invalidateDisplayReads,
} from '../lib/http/display-reads.js';

/**
 * 权限证据的读取策略：展示读上下文内可复用，写请求（上下文之外）必须直读，
 * 写入之后按表失效。这里只验证这些边界，不验证权限判定本身。
 */
function authorityBase() {
  const state = { reads: 0 };
  return {
    state,
    base: {
      listRows: async () => {
        state.reads += 1;
        return [{ _id: 'e1', 活动ID: 'WF-1', 组织类别: '生命中心', 报名页配置: '{}' }];
      },
    },
  };
}

test('authority evidence is shared inside a display read and authoritative outside it', async () => {
  const { state, base } = authorityBase();
  await withDisplayReads(async () => {
    await readAuthorityEvents(base);
    await readAuthorityEvents(base);
  });
  assert.equal(state.reads, 1);

  // 写请求路径没有展示读上下文：每次都取权威数据。
  await readAuthorityEvents(base);
  await readAuthorityEvents(base);
  assert.equal(state.reads, 3);
  clearDisplayReads();
});

test('writing the authority table invalidates the cached evidence', async () => {
  const { state, base } = authorityBase();
  await withDisplayReads(async () => {
    await readAuthorityEvents(base);
    invalidateDisplayReads([AUTHORITY_EVENTS_TABLE]);
    await readAuthorityEvents(base);
  });
  assert.equal(state.reads, 2);
  clearDisplayReads();
});

test('the fresh reader never uses the cache and a zero window disables sharing', async () => {
  const { state, base } = authorityBase();
  await withDisplayReads(async () => {
    await readAuthorityEventsFresh(base);
    await readAuthorityEventsFresh(base);
  });
  assert.equal(state.reads, 2);

  const previous = process.env.PLATFORM_AUTHORITY_CACHE_MS;
  process.env.PLATFORM_AUTHORITY_CACHE_MS = '0';
  try {
    assert.equal(authorityEventsTtlMs(), 0);
    await withDisplayReads(async () => {
      await readAuthorityEvents(base);
      await readAuthorityEvents(base);
    });
    assert.equal(state.reads, 4);
  } finally {
    if (previous === undefined) delete process.env.PLATFORM_AUTHORITY_CACHE_MS;
    else process.env.PLATFORM_AUTHORITY_CACHE_MS = previous;
    clearDisplayReads();
  }
});
