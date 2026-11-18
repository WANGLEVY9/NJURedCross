import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/auth/logout');
});

test('problem feedback submits from the portal header and appears in the console', async ({ page }, testInfo) => {
  const content = `合成问题反馈 ${testInfo.project.name}：希望这一栏在提交后能看到明确结果。`;
  const anonymous = await page.request.post('/api/public/feedback', {
    data: { category: '其他', content: `${content}（访客）` },
  });
  expect(anonymous.status()).toBe(201);
  expect((await page.request.get('/api/console/feedback')).status()).toBe(401);

  await page.request.post('/api/auth/login', { data: { username: 'synthetic-reviewer' } });
  await page.goto('/');
  await expect(page.locator('#root')).not.toHaveAttribute('data-booting', 'true');

  const isMobile = testInfo.project.name.startsWith('mobile');
  if (isMobile) {
    await page.getByRole('button', { name: '展开导航', exact: true }).click();
    await page.getByRole('navigation', { name: '主导航', exact: true })
      .getByRole('button', { name: '问题反馈', exact: true })
      .click();
  } else {
    const auth = page.locator('.phead__auth');
    const feedback = auth.getByRole('button', { name: '问题反馈', exact: true });
    const management = auth.getByRole('link', { name: '管理平台', exact: true });
    await expect(feedback).toBeVisible();
    await expect(management).toBeVisible();
    const [feedbackBox, managementBox] = await Promise.all([feedback.boundingBox(), management.boundingBox()]);
    expect(feedbackBox.x).toBeLessThan(managementBox.x);
    await feedback.click();
  }

  const dialog = page.getByRole('dialog', { name: '告诉我们哪里可以做得更好' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '提交反馈', exact: true }).click();
  await expect(dialog.getByText('请先选择问题分类。', { exact: true })).toBeVisible();
  await dialog.getByRole('radio', { name: '宣传', exact: true }).click();
  await dialog.getByRole('textbox', { name: /^反馈意见/ }).fill(content);
  await expect(dialog.getByText(`${Array.from(content).length} / 200 字`, { exact: true })).toBeVisible();
  await dialog.screenshot({ path: testInfo.outputPath('feedback-form.png') });
  await dialog.getByRole('button', { name: '提交反馈', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('反馈已提交', { exact: true })).toBeVisible();

  await page.goto('/console/feedback');
  await expect(page.getByRole('heading', { name: '问题反馈', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '宣传', exact: true }).click();
  await expect(page.getByText(content, { exact: true })).toBeVisible();
  await expect(page.getByText(`${content}（访客）`, { exact: true })).toHaveCount(0);
  const memberItem = page.locator('.feedback-item').filter({
    has: page.getByText(content, { exact: true }),
  });
  await memberItem.locator('label.check').click();
  await expect(memberItem).toHaveAttribute('data-resolved', 'true');
  await expect(memberItem.getByText('已解决', { exact: true })).toHaveCount(2);
  await page.getByRole('tab', { name: '其他', exact: true }).click();
  await expect(page.getByText(`${content}（访客）`, { exact: true })).toBeVisible();
  await expect(page.getByText(content, { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '全部', exact: true }).click();
  await page.getByRole('tab', { name: '已解决', exact: true }).click();
  await expect(page.getByText(content, { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '待解决', exact: true }).click();
  await expect(page.getByText(content, { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '已解决', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator('.feedback-inbox').screenshot({ path: testInfo.outputPath('feedback-inbox.png') });
});
