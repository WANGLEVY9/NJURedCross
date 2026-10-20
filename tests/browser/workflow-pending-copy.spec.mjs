import { test, expect } from '@playwright/test';

for (const ordinary of [true, false]) test(`new ${ordinary ? 'ordinary' : 'general'} workflow registration waits for approval and shows position work`, async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-reviewer' } });
  const event = { id: 'pending-copy', name: '合成岗位报名', date: '2030-10-17', slot: '09:17:42-12:00:00', location: '合成地点',
    position: '现场引导', work: '本岗位负责入口指引与人数登记', content: '父活动整体内容不应覆盖岗位说明', remaining: 8, capacity: 10,
    registrationOpen: true, ...(ordinary ? { ordinary: { groupId: 'pending-copy-group', start: '2030-10-17T09:17:42+08:00', end: '2030-10-17T12:00:00+08:00', campus: '仙林' } } : {}) };
  let records = [], calls = 0;
  await page.route('**/api/public/workflow/events*', route => route.fulfill({ json: { events: [event] } }));
  await page.route('**/api/portal/workflow/wishlist', route => route.fulfill({ json: { wishlist: [] } }));
  await page.route('**/api/portal/workflow/me', route => route.fulfill({ json: { participant: { realName: '合成同学', studentId: 'TEST', campus: '仙林', email: 'fixture@example.invalid' }, registrations: records } }));
  await page.route('**/api/portal/workflow/events/pending-copy/register', route => {
    calls++;
    records = [{ code: 'SYNTHETIC-PENDING', eventId: event.id, eventName: event.name, date: event.date, slot: event.slot, position: event.position, location: event.location, ordinary: event.ordinary, status: '待筛选', result: '待确认' }];
    return route.fulfill({ json: { ok: true, result: { status: '待确认' } } });
  });
  await page.goto('/workflow-events?event=pending-copy');
  const detail = page.locator('.workflow-event-detail');
  await expect(detail.locator('.workflow-copy')).toHaveText(event.work);
  await expect(detail).not.toContainText(event.content);
  await expect(detail.locator('.participation-notice')).toContainText('提交报名后统一进入待审核');
  await expect(detail).not.toContainText('有名额时提交即确认');
  await page.locator('.blood-signup-controls .check').click();
  await page.getByRole('button', { name: '确认报名此班次', exact: true }).click();
  await expect(page.locator('.workflow-submit-feedback')).toContainText('报名已提交，等待管理员审核');
  await expect(page.locator('.workflow-submit-feedback')).not.toContainText('报名成功');
  await expect(page.locator('.registration-callout')).toHaveAttribute('data-tone', 'pending');
  await expect(page.locator('.blood-registration__heading')).toContainText('待审核');
  await expect(page.getByRole('button', { name: '提交照片签到', exact: true })).toHaveCount(0);
  expect(calls).toBe(1);
});
