import { test, expect } from '@playwright/test';

async function setup(page) {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-reviewer' } });
  const events = ['a', 'b', 'outside'].map((id, i) => ({ _id: `legacy-${id}`, 活动ID: `legacy-${id}`, 活动名称: id === 'outside' ? '另一个合成项目' : '合成多场次报名', 状态: '报名中', 报名日期: i ? '2030-10-18' : '2030-10-17', 报名时段: '09:00-12:00', 岗位: i ? '后勤' : '引导', 地点: i ? '鼓楼' : '仙林', 容量: 10, 服务时长: 3,
    报名页配置: JSON.stringify({ ordinary: { groupId: id === 'outside' ? 'other-group' : 'legacy-group', start: `2030-10-${i ? '18' : '17'}T09:00:00+08:00`, end: `2030-10-${i ? '18' : '17'}T12:00:00+08:00`, campus: i ? '鼓楼' : '仙林' } }), registrationControl: { deadline: '2030-10-16T23:00:00+08:00', enabled: true } }));
  const registrations = [
    { _id: 'r-a', 活动ID: 'legacy-a', 姓名: '甲同学', 岗位: '引导', 报名状态: '待筛选' },
    { _id: 'r-b', 活动ID: 'legacy-b', 姓名: '乙同学', 岗位: '后勤', 报名状态: '待筛选' },
    { _id: 'r-c', 活动ID: 'legacy-b', 姓名: '丙同学', 岗位: '引导', 报名状态: '待筛选' },
    { _id: 'r-leave', 活动ID: 'legacy-b', 姓名: '请假同学', 岗位: '后勤', 报名状态: '待筛选', 请假状态: '待审批', 请假原因: '合成课程冲突' },
    { _id: 'r-confirmed', 活动ID: 'legacy-b', 姓名: '已批准同学', 岗位: '后勤', 报名状态: '已确认' },
    { _id: 'r-outside', 活动ID: 'legacy-outside', 姓名: '外部项目同学', 岗位: '后勤', 报名状态: '待筛选' },
  ].map((row, i) => ({ ...row, 学号: `TEST${i}`, 创建时间: '2030-10-01' }));
  const posts = [];
  await page.route('**/api/volunteer/workflow/catalog', route => route.fulfill({ json: { events, registrations, ledger: [], sources: [] } }));
  await page.route('**/api/volunteer/workflow/sources', route => route.fulfill({ json: { sources: [] } }));
  await page.route('**/api/volunteer/workflow/registrations/batch', route => {
    const body = route.request().postDataJSON(); posts.push(body);
    for (const id of body.ids) {
      const row = registrations.find(row => row._id === id);
      if (body.action === 'confirm') row.报名状态 = '已确认';
      else row.请假状态 = body.action === 'leave-approve' ? '已批准' : '已驳回';
    }
    return route.fulfill({ json: { ok: true, mailPending: true, results: body.ids.map(id => ({ id, ok: true, mailPending: true })) } });
  });
  await page.route('**/api/volunteer/workflow/registrations/r-b/confirm', route => {
    posts.push(route.request().postDataJSON()); registrations.find(row => row._id === 'r-b').报名状态 = '已确认';
    return route.fulfill({ json: { ok: true, mailPending: true } });
  });
  await page.route('**/api/volunteer/workflow/registrations/r-b/reject', route => {
    posts.push(route.request().postDataJSON()); registrations.find(row => row._id === 'r-b').报名状态 = '未入选';
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/console/events?legacy=1&event=legacy-a&mode=all&tab=roster');
  await expect(page.locator('.activity-legacy-roster')).toBeVisible();
  return { posts };
}
async function choose(page, label, value) {
  await page.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: value, exact: true }).click();
}

test('legacy roster filters combine, clear hidden selection and survive tab changes', async ({ page }, info) => {
  await setup(page);
  const roster = page.locator('.activity-legacy-roster'), cards = roster.locator('.activity-person');
  await expect(cards).toHaveCount(5);
  await page.getByRole('button', { name: '全选当前可处理报名', exact: true }).click();
  await expect(roster.getByRole('status')).toContainText('已选 3 条');
  await choose(page, '报名日期', '2030-10-18');
  await expect(cards).toHaveCount(4);
  await choose(page, '报名岗位', '后勤');
  await expect(cards).toHaveCount(3);
  await expect(roster.getByRole('status')).toContainText('已选 1 条');
  await choose(page, '报名班次', '2030-10-18 09:00-12:00 鼓楼 后勤');
  await choose(page, '报名状态', '待审批');
  await expect(cards).toHaveCount(2);
  await page.getByRole('searchbox', { name: '查找志愿者' }).fill('乙');
  await expect(cards).toHaveCount(1);
  await page.getByRole('tab', { name: '活动信息', exact: true }).click();
  await page.getByRole('tab', { name: '志愿者报名', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: '查找志愿者' })).toHaveValue('乙');
  await expect(page.getByRole('combobox', { name: '报名日期', exact: true })).toContainText('2030-10-18');
  await expect(cards).toHaveCount(1);
  await expect(roster.getByRole('checkbox')).toBeChecked();
  await choose(page, '报名状态', '已确认');
  await expect(cards).toHaveCount(0);
  await expect(roster.getByRole('status')).toContainText('已选 0 条');
  await page.getByRole('button', { name: '清除报名筛选' }).click();
  await expect(cards).toHaveCount(5);
  await expect(page.getByRole('searchbox', { name: '查找志愿者' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('legacy-roster.png'), fullPage: true });
});

test('legacy batch only submits currently visible eligible registration IDs across sessions', async ({ page }) => {
  const { posts } = await setup(page);
  await page.getByRole('button', { name: '全选当前可处理报名', exact: true }).click();
  await choose(page, '报名日期', '2030-10-18');
  await choose(page, '报名岗位', '后勤');
  await page.getByRole('button', { name: '批量批准并通知', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '批量确认结果' })).toBeVisible();
  expect(posts).toEqual([{ ids: ['r-b'], action: 'confirm' }]);
  await expect(page.getByRole('dialog')).toContainText(/排队|队列|待发送/);
  await expect(page.getByRole('dialog')).not.toContainText('邮件发送成功');
  await page.getByRole('dialog').getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '报名岗位', exact: true })).toContainText('后勤');
  await expect(page.locator('.activity-legacy-roster').getByRole('status')).toContainText('已选 0 条');
  await expect(page.getByRole('button', { name: '批量批准并通知', exact: true })).toBeDisabled();
});

test('legacy pending decisions explicitly notify and rejection preserves filters', async ({ page }) => {
  const { posts } = await setup(page);
  await page.getByRole('searchbox', { name: '查找志愿者' }).fill('乙');
  const card = page.locator('.activity-legacy-roster .activity-person');
  await expect(card.getByRole('button', { name: '批准录取并通知', exact: true })).toBeVisible();
  const operations = card.locator('summary');
  if (await operations.isVisible()) await operations.click();
  await card.getByRole('button', { name: '拒绝录取并通知', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '拒绝录取并通知' });
  await drawer.getByRole('textbox', { name: '处理说明 必填', exact: true }).fill('合成岗位条件不符');
  await drawer.getByRole('button', { name: '确认处理', exact: true }).click();
  await expect(drawer).toHaveCount(0);
  expect(posts).toEqual([{ reason: '合成岗位条件不符' }]);
  await expect(page.getByRole('searchbox', { name: '查找志愿者' })).toHaveValue('乙');
  await expect(card).toContainText('报名失败');
  await expect(card.getByRole('checkbox')).toHaveCount(0);
});

test('legacy native table groups positions and sessions without losing mobile actions', async ({ page }, info) => {
  await setup(page);
  const roster = page.locator('.activity-legacy-roster');
  await expect(roster.getByRole('table', { name: '报名与请假名单' })).toBeVisible();
  await expect(roster.locator('tr.activity-person')).toHaveCount(5);
  await expect(roster.locator('.activity-legacy-roster__group')).toHaveCount(2);
  await expect(roster.locator('.activity-legacy-roster__session')).toHaveCount(3);
  const row = roster.locator('[data-registration-id="r-b"]');
  await expect(row.getByRole('button', { name: '批准录取并通知', exact: true })).toBeVisible();
  if (info.project.name.startsWith('mobile')) {
    await expect(row.getByRole('button', { name: '更多资料', exact: true })).toHaveCount(0);
    await row.locator('summary').click();
    await expect(row.getByRole('button', { name: '更多资料', exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: '拒绝录取并通知', exact: true })).toBeVisible();
  } else {
    await expect(row.locator('summary')).toBeHidden();
    await expect(row.getByRole('button', { name: '更多资料', exact: true })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('legacy campus and leave filters prune batch selection and reset accessibly', async ({ page }) => {
  const { posts } = await setup(page);
  const roster = page.locator('.activity-legacy-roster');
  await page.getByRole('button', { name: '全选当前可处理报名', exact: true }).click();
  await choose(page, '活动校区', '鼓楼');
  await expect(roster.locator('.activity-person')).toHaveCount(4);
  await expect(roster.getByRole('status')).toContainText('已选 2 条');
  await choose(page, '请假状态', '待审批');
  await expect(roster.locator('.activity-person')).toHaveCount(1);
  await expect(roster.getByRole('status')).toContainText('已选 0 条');
  await expect(page.getByRole('button', { name: '批量批准并通知', exact: true })).toBeDisabled();
  expect(posts).toEqual([]);
  await choose(page, '请假状态', '未请假');
  await choose(page, '报名岗位', '后勤');
  await expect(roster.locator('.activity-person')).toHaveCount(2);
  await page.getByRole('button', { name: '全选当前可处理报名', exact: true }).click();
  await page.getByRole('button', { name: '批量批准并通知', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '批量确认结果' })).toBeVisible();
  expect(posts).toEqual([{ ids: ['r-b'], action: 'confirm' }]);
  await page.getByRole('dialog').getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '清除报名筛选' }).click();
  await expect(roster.locator('.activity-person')).toHaveCount(5);
  await expect(page.getByRole('searchbox', { name: '查找志愿者' })).toBeFocused();
});

test('legacy date and identity ordering keep position groups stable', async ({ page }) => {
  await setup(page);
  const roster = page.locator('.activity-legacy-roster');
  const groups = await roster.locator('.activity-legacy-roster__group').allTextContents();
  const sessionDates = () => roster.locator('[data-registration-id="r-a"], [data-registration-id="r-c"]').evaluateAll(rows => rows.map(row => row.dataset.registrationId));
  await expect.poll(sessionDates).toEqual(['r-a', 'r-c']);
  await choose(page, '名单排序', '日期降序');
  await expect.poll(sessionDates).toEqual(['r-c', 'r-a']);
  expect(await roster.locator('.activity-legacy-roster__group').allTextContents()).toEqual(groups);
  await choose(page, '名单排序', '姓名排序');
  const logistics = roster.locator('[data-registration-id="r-b"], [data-registration-id="r-leave"], [data-registration-id="r-confirmed"]');
  const actualNames = await logistics.locator('th[scope="row"] strong').allTextContents();
  expect(actualNames).toEqual([...actualNames].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })));
  await choose(page, '名单排序', '学号排序');
  await expect.poll(() => logistics.evaluateAll(rows => rows.map(row => row.dataset.registrationId))).toEqual(['r-b', 'r-leave', 'r-confirmed']);
  await page.getByRole('tab', { name: '活动信息', exact: true }).click();
  await page.getByRole('tab', { name: '志愿者报名', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '名单排序', exact: true })).toContainText('学号排序');
});

for (const approved of [true, false]) {
  test(`legacy batch ${approved ? 'approves' : 'rejects'} only filtered pending leave with a required reason`, async ({ page }) => {
    const { posts } = await setup(page);
    const roster = page.locator('.activity-legacy-roster');
    await page.getByRole('button', { name: '全选当前可处理报名', exact: true }).click();
    await expect(roster.getByRole('status')).toContainText('已选 3 条');
    await page.getByRole('button', { name: '全选当前请假申请', exact: true }).click();
    await expect(roster.getByRole('status')).toContainText('已选 1 条');
    await expect(page.getByRole('button', { name: '批量批准并通知', exact: true })).toBeDisabled();
    await expect(roster.getByRole('checkbox', { name: '选择请假同学' })).toBeChecked();
    await choose(page, '活动校区', '仙林');
    await expect(roster.getByRole('status')).toContainText('已选 0 条');
    await expect(page.getByRole('button', { name: '批量批准请假', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '批量驳回请假', exact: true })).toBeDisabled();
    await choose(page, '活动校区', '鼓楼');
    await page.getByRole('button', { name: '全选当前请假申请', exact: true }).click();
    await page.getByRole('button', { name: approved ? '批量批准请假' : '批量驳回请假', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: approved ? '批量批准 1 条请假' : '批量驳回 1 条请假' });
    await expect(drawer).toBeVisible();
    const reason = drawer.getByRole('textbox', { name: '处理说明 必填', exact: true });
    await expect(reason).toHaveAttribute('required', '');
    await drawer.getByRole('button', { name: '确认处理', exact: true }).click();
    expect(posts).toEqual([]);
    await reason.fill('合成请假核验说明');
    await drawer.getByRole('button', { name: '确认处理', exact: true }).click();
    await expect(drawer).toHaveCount(0);
    expect(posts).toEqual([{ ids: ['r-leave'], action: approved ? 'leave-approve' : 'leave-reject', reason: '合成请假核验说明' }]);
    await expect(roster.getByRole('status')).toContainText('已选 0 条');
    await page.getByRole('button', { name: '全选当前可处理报名', exact: true }).click();
    await expect(page.getByRole('button', { name: '批量批准请假', exact: true })).toBeDisabled();
  });
}
