import { test, expect } from '@playwright/test';

const registration = {
  code: 'WR-ORD', eventName: '已结束的普通活动', eventId: 'evt-ord', status: '已确认',
  result: '报名成功', date: '2026-11-06', slot: '14:00-16:00', location: '仙林',
  eventStatus: '已结束', attendanceOpen: true, attendanceSubmitted: false,
};

async function open(page, requests = []) {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-reviewer' } });
  await page.route('**/api/portal/workflow/me', route => route.fulfill({
    json: { ok: true, registrations: [registration], ledger: [], attendanceRequests: requests },
  }));
  await page.goto('/workflow-events?view=records&records=active');
  const card = page.locator('.blood-registration');
  await expect(card.locator('summary').filter({ hasText: '现场签到' })).toBeVisible();
  await card.locator('summary').filter({ hasText: '现场签到' }).click();
  return card;
}

test('an ended ordinary shift still offers late check-in and a written explanation', async ({ page }) => {
  const posts = [];
  await page.route('**/api/portal/workflow/registrations/*/attendance-request', route => {
    posts.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, request: { status: 'pending' } } });
  });
  const card = await open(page);
  await expect(card.getByRole('button', { name: '提交补签说明' })).toBeVisible();
  await card.locator('[name="attendanceRequestReason"]').fill('值班医生延后确认，未能在现场上传照片');
  await card.getByRole('button', { name: '提交补签说明' }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].reason).toContain('值班医生延后确认');
});

test('a pending explanation is shown as awaiting verification and cannot be duplicated', async ({ page }) => {
  const card = await open(page, [{
    id: 'req-1', registration_code: 'WR-ORD', event_id: 'evt-ord', account_id: 'own',
    student_id: '999990001', reason: '纸质签到凭证', status: 'pending', created_at: '2026-11-07T10:00:00Z',
  }]);
  await expect(card).toContainText('补签说明待核实');
  await expect(card.getByRole('button', { name: '提交补签说明' })).toBeDisabled();
});
