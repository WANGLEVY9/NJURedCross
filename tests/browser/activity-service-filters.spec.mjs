import { test, expect } from '@playwright/test';

const sessions = [
  { _id: 'review-a', 活动ID: 'review-a', 活动名称: '合成服务', 报名日期: '2030-10-14', 报名时段: '09:00-12:00', 地点: '仙林', 报名页配置: '{}', 服务时长: 3 },
  { _id: 'review-b', 活动ID: 'review-b', 活动名称: '合成服务', 报名日期: '2030-10-15', 报名时段: '14:00-17:00', 地点: '鼓楼', 报名页配置: '{"blood":true}', 服务时长: 3 },
];
const parent = { _id: 'parent', 活动ID: 'parent', 报名页配置: JSON.stringify({ positionPlan: {
  eventIds: ['review-b', 'review-a'], positions: [{ name: '引导', campus: '鼓楼', location: '鼓楼' }, { name: '引导', campus: '仙林', location: '仙林' }],
} }) };
const rows = [
  { _id: 'a', 活动ID: 'review-a', 姓名: '合成长姓名同学', 岗位: '引导', 报名状态: '已确认' },
  { _id: 'b', 活动ID: 'review-b', 姓名: '有照片同学', 岗位: '引导', 报名状态: '已确认', 签到照片ID: 'synthetic-photo' },
  { _id: 'c', 活动ID: 'review-b', 姓名: '待审批同学', 岗位: '后勤', 报名状态: '待筛选', 签到照片ID: 'synthetic-photo' },
  { _id: 'd', 活动ID: 'review-b', 姓名: '无照片同学', 岗位: '引导', 报名状态: '已确认' },
  { _id: 'e', 活动ID: 'review-a', 姓名: '未入选同学', 岗位: '后勤', 报名状态: '未入选' },
].map((row, i) => ({ ...row, 学号: `TEST${i}`, 院系: '合成院系', 创建时间: `2030-10-0${i + 1}` }));

async function setup(page) {
  const posts = [];
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-reviewer' } });
  await page.route('**/api/volunteer/workflow/events/review-a/members', route => route.fulfill({ json: { people: [{ id: 'a', center: '生命中心', department: '生命中心主任团', membership: 'member' }] } }));
  await page.route('**/api/volunteer/workflow/registrations/*/attendance-detail', route => route.fulfill({ json: { studentId: 'TEST', hasPhoto: false, legacy: [], warnings: [] } }));
  await page.route('**/api/volunteer/workflow/events/review-a/attendance-batch', route => {
    const items = route.request().postDataJSON().items; posts.push(items);
    return route.fulfill({ json: { succeeded: items.length, failed: 0, results: items.map(({ id }) => ({ id, ok: true })) } });
  });
  await page.goto('/console/events');
  await expect(page.locator('.activity-center')).toBeVisible();
  // Mount the owned component; importing the new stylesheet is the main integrator's task.
  await page.addStyleTag({ url: '/styles/activity-review.css' });
  await page.evaluate(async ({ events, registrations }) => {
    const { serviceWorkspace } = await import('/app/console/pages/activity-service.js');
    document.querySelector('.activity-center').replaceChildren(serviceWorkspace({ event: events[0], events, registrations, ledger: [], kind: 'checkins', actor: 'synthetic-reviewer', state: {}, onSaved: async () => {} }));
  }, { events: [...sessions, parent], registrations: rows });
  return posts;
}

async function choose(page, name, option) {
  await page.getByRole('combobox', { name, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('date, position, session and status compose and preserve readable identities', async ({ page }, info) => {
  await setup(page);
  const records = page.locator('.service-table tbody tr');
  await expect(records).toHaveCount(3);
  await expect(page.locator('[data-registration-id="c"], [data-registration-id="e"]')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '日期', exact: true })).toBeVisible();
  await choose(page, '日期', '2030-10-15');
  await expect(records).toHaveCount(2);
  await choose(page, '报名状态', '全部报名状态');
  await expect(records).toHaveCount(3);
  await choose(page, '岗位', '后勤');
  await expect(records).toHaveCount(1);
  await expect(records).toContainText('待审批，不能签到');
  await choose(page, '报名状态', '已确认');
  await expect(records).toHaveCount(0);
  await page.getByRole('button', { name: '清除筛选' }).click();
  await choose(page, '场次', '2030-10-14 09:00-12:00 仙林');
  await expect(records).toHaveCount(1);
  await expect(page.getByRole('combobox', { name: '报名状态', exact: true })).toContainText('已确认 / 已签到');
  const name = page.locator('[data-registration-id="a"] .service-name-cell');
  await expect(name).toHaveText('合成长姓名同学');
  await expect(page.locator('[data-registration-id="a"] .service-session-cell')).toContainText('2030-10-14');
  expect(await name.evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('service-filters.png'), fullPage: true });
});

test('batch submits only visible eligible rows and uses each session photo requirement', async ({ page }) => {
  const posts = await setup(page);
  await page.getByRole('button', { name: '全选当前名单' }).click();
  await expect(page.getByText(/筛选结果 3 条 · 可核验 2 条 · 已选 2 条/)).toBeVisible();
  await choose(page, '场次', '2030-10-15 14:00-17:00 鼓楼');
  await expect(page.getByText(/筛选结果 2 条 · 可核验 1 条 · 已选 1 条/)).toBeVisible();
  await page.getByRole('button', { name: '确认签到并录入', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认签到并录入', exact: true }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0].map(row => row.id)).toEqual(['b']);
});

test('pending with photo cannot select, edit, or check in from details', async ({ page }) => {
  const posts = await setup(page);
  await choose(page, '报名状态', '待审批（不能签到）');
  const row = page.locator('[data-registration-id="c"]');
  await expect(row.getByRole('checkbox')).toHaveCount(0);
  await expect(row.getByRole('button', { name: '核验并录入', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '全选当前名单' })).toBeDisabled();
  await row.getByRole('button', { name: '查看签到详情' }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: '确认签到并录入时长' })).toHaveCount(0);
  expect(posts).toHaveLength(0);
});

test('compact table retains department and membership in details and stable position legend', async ({ page }) => {
  await setup(page);
  await expect(page.locator('.service-table th').filter({ hasText: /院系|红会身份|部门/ })).toHaveCount(0);
  await expect(page.locator('.service-position-legend')).toContainText('岗位一：引导（鼓楼校区 · 鼓楼）');
  await expect(page.locator('[data-registration-id="a"] .service-session-cell')).toContainText('岗位二');
  await expect(page.locator('[data-registration-id="b"] .service-session-cell')).toContainText('岗位一');
  await choose(page, '场次', '2030-10-14 09:00-12:00 仙林');
  await expect(page.locator('[data-registration-id="a"] .service-session-cell')).toContainText('岗位二');
  await page.locator('[data-registration-id="a"]').getByRole('button', { name: '核验并录入', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('合成院系');
  await expect(page.getByRole('dialog')).toContainText('引导');
  await expect(page.getByRole('dialog')).toContainText('红会身份');
  await expect(page.getByRole('dialog')).toContainText('生命中心主任团');
});

test('explicit all status includes rejected but switching to pending clears eligible selection', async ({ page }) => {
  const posts = await setup(page);
  await choose(page, '报名状态', '全部报名状态');
  await expect(page.locator('.service-table tbody tr')).toHaveCount(5);
  await expect(page.locator('[data-registration-id="e"]')).toContainText('未入选，不能签到');
  await page.getByRole('button', { name: '全选当前名单' }).click();
  await choose(page, '报名状态', '待审批（不能签到）');
  await expect(page.getByText(/筛选结果 1 条 · 可核验 0 条 · 已选 0 条/)).toBeVisible();
  await expect(page.getByRole('button', { name: '确认签到并录入', exact: true })).toBeHidden();
  expect(posts).toHaveLength(0);
});
