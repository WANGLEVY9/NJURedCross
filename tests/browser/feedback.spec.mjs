import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.request.post('/api/auth/logout');
});

test('preview accounts separate ordinary members from console administrators', async ({ page }) => {
  await page.goto('/preview/account/member?next=/');
  const member = await (await page.request.get('/api/auth/session')).json();
  expect(member.user).toMatchObject({
    username: 'preview-member',
    role: 'member',
    consoleAccess: false,
    label: '普通用户',
  });
  await page.goto('/console/feedback');
  await expect(page).toHaveURL(/\/me$/);
  expect((await page.request.get('/api/console/feedback')).status()).toBe(403);

  await page.goto('/preview/account/admin?next=/');
  const admin = await (await page.request.get('/api/auth/session')).json();
  expect(admin.user).toMatchObject({
    username: 'preview-admin',
    role: 'platform_admin',
    consoleAccess: true,
    label: '预览管理员',
  });
  await page.goto('/console/feedback');
  await expect(page.getByRole('heading', { name: '问题反馈', exact: true })).toBeVisible();
});

test('activity feedback requires a specific activity and records owner delivery', async ({ page }, testInfo) => {
  const content = `活动反馈 ${testInfo.project.name}：希望现场指引更清楚。`;
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-organizer' } });
  await page.goto('/');
  await expect(page.locator('#root')).not.toHaveAttribute('data-booting', 'true');

  if (testInfo.project.name.startsWith('mobile')) {
    await page.getByRole('button', { name: '展开导航', exact: true }).click();
    await page.getByRole('navigation', { name: '主导航', exact: true })
      .getByRole('button', { name: '问题反馈', exact: true })
      .click();
  } else {
    await page.locator('.phead__auth').getByRole('button', { name: '问题反馈', exact: true }).click();
  }

  const dialog = page.getByRole('dialog', { name: '告诉我们哪里可以做得更好' });
  await expect(dialog).toContainText('通知偏好');
  await expect(dialog.getByLabel('处理结果接收邮箱')).toHaveCount(0);
  await dialog.getByRole('radio', { name: '活动', exact: true }).click();
  const centre = dialog.getByRole('combobox', { name: /中心分类/ });
  const activity = dialog.getByRole('combobox', { name: '关联活动', exact: true });
  await expect(activity).toBeVisible();
  await expect(activity).toBeEnabled();
  await expect(centre).toContainText('全部中心');
  await dialog.getByRole('textbox', { name: /^反馈意见/ }).fill(content);
  await dialog.getByRole('button', { name: '提交反馈', exact: true }).click();
  await expect(dialog.getByText('请选择反馈对应的活动。', { exact: true })).toBeVisible();
  const hint = dialog.locator('[data-field-name="feedback-activity"] .field__hint');
  await expect(hint).toContainText('可不选中心，直接选择或搜索关联活动。');
  const hintLayout = await dialog.locator('[data-field-name="feedback-activity"]').evaluate((field) => {
    const select = field.querySelector('.select-menu__trigger').getBoundingClientRect();
    const hint = field.querySelector('.field__hint').getBoundingClientRect();
    const bounds = field.getBoundingClientRect();
    return { selectBottom: select.bottom, hintTop: hint.top, hintBottom: hint.bottom, fieldBottom: bounds.bottom };
  });
  expect(hintLayout.hintTop).toBeGreaterThanOrEqual(hintLayout.selectBottom);
  expect(hintLayout.hintBottom).toBeLessThanOrEqual(hintLayout.fieldBottom + 0.5);
  await activity.click();
  const careOption = dialog.getByRole('option', { name: /校园急救培训/ });
  await careOption.locator('.select-menu__description').evaluate((node) => {
    node.textContent = '综事中心 · 南京医科大学第二附属医院萨家湾院区儿科病区（门诊1号楼10楼）';
  });
  const optionLayout = await careOption.evaluate((node) => {
    const label = node.querySelector('span:first-child').getBoundingClientRect();
    return { labelWidth: label.width, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth };
  });
  expect(optionLayout.labelWidth).toBeGreaterThan(100);
  expect(optionLayout.scrollWidth).toBeLessThanOrEqual(optionLayout.clientWidth + 1);
  await dialog.getByRole('searchbox', { name: '搜索关联活动', exact: true }).fill('校园急救培训');
  await dialog.getByRole('option', { name: /校园急救培训/ }).click();
  await dialog.getByRole('button', { name: '提交反馈', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('反馈已提交', { exact: true })).toBeVisible();
  await expect(page.getByText('反馈已提交，并已发送给活动负责人。', { exact: true })).toBeVisible();

  await page.goto('/console/feedback');
  await page.getByRole('tab', { name: '活动', exact: true }).click();
  const card = page.locator('.feedback-item').filter({ has: page.getByText(content, { exact: true }) });
  await expect(card).toContainText('校园急救培训');
  await expect(card).not.toContainText('负责人通知未完成');
  await expect(card.getByText('synthetic-organizer', { exact: true })).toHaveCount(0);
});

test('blood feedback exposes four independent location activities', async ({ page }, testInfo) => {
  const content = `献血车反馈 ${testInfo.project.name}：希望新街口中央的服务说明更清楚。`;
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-organizer' } });
  await page.goto('/');
  await expect(page.locator('#root')).not.toHaveAttribute('data-booting', 'true');
  if (testInfo.project.name.startsWith('mobile')) {
    await page.getByRole('button', { name: '展开导航', exact: true }).click();
    await page.getByRole('navigation', { name: '主导航', exact: true })
      .getByRole('button', { name: '问题反馈', exact: true })
      .click();
  } else {
    await page.locator('.phead__auth').getByRole('button', { name: '问题反馈', exact: true }).click();
  }
  const dialog = page.getByRole('dialog', { name: '告诉我们哪里可以做得更好' });
  await dialog.getByRole('radio', { name: '活动', exact: true }).click();
  const centre = dialog.getByRole('combobox', { name: /中心分类/ });
  const activity = dialog.getByRole('combobox', { name: '关联活动', exact: true });
  await centre.click();
  await dialog.getByRole('option', { name: '献血车专项', exact: true }).click();
  await expect(activity).toBeEnabled();
  await activity.click();
  await expect(dialog.getByRole('option', { name: /市献血车活动 ·/ })).toHaveCount(4);
  await dialog.getByRole('option', { name: /市献血车活动 · 新街口中央/ }).click();
  await expect(dialog).toContainText('服务地点：新街口中央');
  await dialog.getByRole('textbox', { name: /^反馈意见/ }).fill(content);
  await dialog.getByRole('button', { name: '提交反馈', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.goto('/console/feedback');
  await page.getByRole('tab', { name: '活动', exact: true }).click();
  await expect(page.locator('.feedback-item').filter({ hasText: content })).toContainText('市献血车活动 · 新街口中央');
});

test('unrelated administrators cannot see activity feedback', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-reviewer' } });
  await page.goto('/console/feedback');
  await expect(page.getByRole('tab', { name: '待解决', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '活动', exact: true }).click();
  await expect(page.getByText('合成示例：希望活动详情页更早显示集合地点，方便提前安排交通。', { exact: true })).toHaveCount(0);
});

test('resolving feedback keeps the current management scroll position', async ({ page }) => {
  const items = Array.from({ length: 24 }, (_, index) => ({
    id: `scroll-${index}`,
    category: '其他',
    content: `滚动位置测试反馈 ${index}`,
    submittedAt: `2026-11-18T${String(12 - Math.floor(index / 60)).padStart(2, '0')}:${String(59 - index % 60).padStart(2, '0')}:00.000Z`,
    status: '待解决',
    resolved: false,
    resolutionMailStatus: '',
  }));
  await page.request.post('/api/auth/login', { data: { username: 'preview-admin' } });
  await page.route('**/api/console/feedback**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'PATCH') {
      const id = decodeURIComponent(path.split('/').at(-1));
      return route.fulfill({
        json: {
          ok: true,
          item: {
            id,
            status: '已解决',
            resolved: true,
            solution: '已处理',
            resolutionMailStatus: '已发送',
          },
          notification: { required: true, ok: true, status: '已发送' },
        },
      });
    }
    return route.fulfill({ json: { ok: true, ready: true, items, truncated: false } });
  });
  await page.goto('/console/feedback');
  const target = page.locator('.feedback-item').filter({ hasText: '滚动位置测试反馈 12' });
  await target.scrollIntoViewIfNeeded();
  const scroller = page.locator('#main');
  const before = await scroller.evaluate((node) => node.scrollTop);
  await target.locator('label.check').click();
  const dialog = page.getByRole('dialog', { name: '填写解决方案' });
  await dialog.getByRole('textbox', { name: /^解决方案/ }).fill('已处理');
  await dialog.getByRole('button', { name: '保存并发送结果', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(target).toHaveCount(0);
  const after = await scroller.evaluate((node) => node.scrollTop);
  expect(after).toBeGreaterThanOrEqual(before - 80);
  expect(after).toBeLessThanOrEqual(before + 80);
});

test('problem feedback submits from the portal header and appears in the console', async ({ page }, testInfo) => {
  const content = `合成问题反馈 ${testInfo.project.name}：希望这一栏在提交后能看到明确结果。`;
  const anonymous = await page.request.post('/api/public/feedback', {
    data: {
      category: '其他',
      content: `${content}（访客）`,
      contactEmail: 'visitor@example.test',
    },
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
  const resolution = page.getByRole('dialog', { name: '填写解决方案' });
  await resolution.getByRole('textbox', { name: /^解决方案/ }).fill('已调整页面说明并完成核对。');
  await resolution.getByRole('button', { name: '保存并发送结果', exact: true }).click();
  await expect(resolution).toBeHidden();
  await expect(resolution).toHaveCount(0);
  await expect(page.getByText(content, { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '其他', exact: true }).click();
  await expect(page.getByText(`${content}（访客）`, { exact: true })).toBeVisible();
  await expect(page.getByText(content, { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '全部', exact: true }).click();
  await page.getByRole('tab', { name: '已解决', exact: true }).click();
  await expect(page.getByText(content, { exact: true })).toBeVisible();
  await expect(page.locator('.feedback-item').filter({ has: page.getByText(content, { exact: true }) }))
    .toContainText('已调整页面说明并完成核对。');
  await expect(page.getByText('合成测试同学', { exact: true })).toHaveCount(0);
  await expect(page.getByText('visitor@example.test', { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '待解决', exact: true }).click();
  await expect(page.getByText(content, { exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '已解决', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.locator('.feedback-inbox').screenshot({ path: testInfo.outputPath('feedback-inbox.png') });
});
