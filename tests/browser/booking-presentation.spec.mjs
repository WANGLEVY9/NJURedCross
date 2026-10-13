import { test, expect } from '@playwright/test';

test('identity, consent and wish letters align and keep ordinary navigation', async ({ page }, info) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-reviewer' } });
  const source = await (await page.request.get('/api/public/workflow/events')).json();
  const event = { ...source.events[0], id: 'wish-ordinary', blood: false, ordinary: { groupId: 'fixture' }, registrationOpen: true, remaining: 1, capacity: 30, date: '2026-10-29', slot: '08:30–10:30', location: '仙林校区大学生活动中心多功能厅' };
  await page.route('**/api/public/workflow/events', r => r.fulfill({ json: { ...source, events: [event] } }));
  await page.route('**/api/portal/workflow/me', r => r.fulfill({ json: { registrations: [], participant: { realName: '合成志愿者', studentId: '999990001', email: '999990001@smail.nju.edu.cn', campus: '仙林', department: '计算机科学与技术系', grade: '26本' } } }));
  let items = [{ eventId: event.id }];
  await page.route('**/api/portal/workflow/wishlist', r => r.fulfill({ json: { wishlist: items } }));
  await page.route('**/api/portal/workflow/events/*/wishlist', r => { items = []; return r.fulfill({ json: { ok: true } }); });
  await page.goto('/workflow-events?event=wish-ordinary');
  await expect(page.locator('.booking-identity')).toContainText('合成志愿者');
  for (const theme of ['dawn', 'sail', 'garden', 'iris', 'amber']) {
    await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
    const gaps = await page.locator('.booking-identity .dl__row').evaluateAll(rows => rows.map(row => {
      const [term, value] = row.children;
      return Math.abs(term.getBoundingClientRect().top - value.getBoundingClientRect().top);
    }));
    expect(Math.max(...gaps)).toBeLessThanOrEqual(1);
    const offset = await page.locator('.blood-signup-controls .check').evaluate(el => {
      const box = el.querySelector('.check__box').getBoundingClientRect();
      const label = el.querySelector('.check__text b').getBoundingClientRect();
      return Math.abs(box.top + box.height / 2 - (label.top + 14));
    });
    expect(offset).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.evaluate(() => document.documentElement.dataset.theme = 'dawn');
  await page.locator('.blood-signup-controls .check').click();
  await expect(page.getByRole('button', { name: '确认报名此班次', exact: true })).toBeEnabled();
  await expect(page.locator('.blood-detail-submit')).not.toContainText('时长规则待确定');
  await page.locator('.blood-detail-personal').screenshot({ path: info.outputPath('identity-consent.png') });
  await expect(page.locator('.blood-wish-row a')).toHaveAttribute('href', '/workflow-events?event=wish-ordinary');
  await page.locator('.booking-wishes').screenshot({ path: info.outputPath('wish-letter.png') });
  await page.getByRole('button', { name: '取消提醒', exact: true }).click();
  await expect(page.locator('.blood-wish-row')).toHaveCount(0);
  await expect(page.locator('.booking-wishes__empty')).toBeVisible();
  await page.locator('.booking-wishes').screenshot({ path: info.outputPath('wish-empty.png') });
});
