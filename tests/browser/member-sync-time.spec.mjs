import { test, expect } from '@playwright/test';

test('member centre shows the real last reconciliation time when the API provides it', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-organizer' } });
  await page.route('**/api/portal/workflow/me', route => route.fulfill({ json: {
    ok: true, registrations: [], ledger: [], attendanceRequests: [],
    platformHours: { totalHours: 53, academicYearHours: 28.5, rank: 42 },
    sync: { lastRunAt: '2026-11-06T14:00:00.000Z', nextAt: null, label: '由平台统一核对' },
  } }));
  await page.goto('/me?view=records');
  await expect(page.locator('.mc-sync')).toContainText('时长由平台统一核对');
  await expect(page.locator('.mc-sync')).toContainText('上次核对');
  await expect(page.locator('.mc-sync')).not.toContainText('下次');
});
