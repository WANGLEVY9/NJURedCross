import { test, expect } from '@playwright/test';

const entry = {
  id: 'audit-1', at: '2026-11-07T10:00:00.000Z', actor: 'synthetic-super', role: 'super_admin',
  action: 'event.registration.confirm', target: 'WR-2026-1', result: 'success', ip: '127.0.0.1',
  board: 'event', actorName: '王泰杰', actorEmail: 'synthetic-super@smail.nju.edu.cn', metadata: { eventId: 'EVT-1' },
};

test('operation log lists records, filters by board and opens the payload', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-super' } });
  const queries = [];
  await page.route('**/api/audit/logs*', route => {
    queries.push(new URL(route.request().url()).search);
    return route.fulfill({ json: { ok: true, entries: [entry], hasMore: false, scanned: 1,
      boards: [{ key: 'event', label: '活动与报名' }, { key: 'hours', label: '志愿时长' }] } });
  });
  await page.goto('/console/audit');
  await expect(page.locator('.audit-log')).toBeVisible();
  await expect(page.locator('.audit-log')).toContainText('event.registration.confirm');
  // 操作人显示真实姓名，账号作为副行便于核对。
  await expect(page.locator('.audit-log__actor strong').first()).toHaveText('王泰杰');
  await expect(page.locator('.audit-log__actor-id').first()).toContainText('@');
  await expect(page.locator('.audit-log')).toContainText('活动与报名');

  await page.getByRole('combobox', { name: '板块', exact: true }).selectOption('hours');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await expect.poll(() => queries.some(query => query.includes('board=hours'))).toBe(true);

  await page.getByText('event.registration.confirm', { exact: true }).first().click();
  await expect(page.locator('.audit-log__detail')).toContainText('EVT-1');
});

test('operation log reports a service error instead of an empty list', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-super' } });
  await page.route('**/api/audit/logs*', route => route.fulfill({ status: 503, json: { ok: false, message: '操作日志暂时无法读取，请稍后重试' } }));
  await page.goto('/console/audit');
  await expect(page.locator('.audit-log')).toContainText('操作日志无法加载');
});
