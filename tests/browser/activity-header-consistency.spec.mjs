import { test, expect } from './legacy-activity-fixture.mjs';

const event = (id, patch = {}) => ({ _id: id, 活动ID: id, 活动名称: '合成统一操作栏', 状态: '待审核',
  活动类别: '志愿服务', 组织类别: '主席团', 地区: '南京地区', 报名日期: '2030-10-29', 报名时段: '09:00-12:00',
  地点: '合成测试地点', 岗位: '引导', 容量: 2, 服务时长: 3, 培训时长: 0, 交通时长: 0,
  工作内容: '合成服务', 负责人账号ID: 'synthetic-organizer', 报名页配置: '{}', ...patch });
const tabs = ['活动信息', '志愿者报名', '志愿者签到', '时长录入与导出'];

async function setup(page, project = false, patch = {}) {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-super' } });
  const parent = event('header-parent', { 状态: '报名中', 报名页配置: JSON.stringify({ bookingMode: 'grouped', positionPlan: { groupId: 'header-group', positions: [] } }) });
  const child = event('header-child', { 状态: '报名中', 报名页配置: JSON.stringify({ ordinary: { groupId: 'header-group', hoursPending: true } }), registrationControl: { groupName: '合成统一操作栏', enabled: true, deadline: '2030-10-28T18:00:00+08:00' } });
  const events = project ? [parent, child] : [event('header-single', patch)];
  await page.route('**/api/volunteer/workflow/catalog', route => route.fulfill({ json: { events, registrations: [], ledger: [], sources: [], sourceWarnings: [] } }));
  await page.route('**/api/volunteer/workflow/sources', route => route.fulfill({ json: { sources: [] } }));
  await page.route('**/api/volunteer/workflow/events/*/hours-review**', route => route.fulfill({ json: { entries: [], rows: [], groups: [], columns: [], events, registrations: [] } }));
  await page.goto(`/console/events?legacy=1&mode=all&event=${project ? parent._id : 'header-single'}&tab=overview`);
  await expect(page.getByRole('group', { name: '活动常用操作', exact: true })).toBeVisible();
}

for (const project of [false, true]) {
  test(`${project ? 'project' : 'single activity'} keeps its common controls and heading style across all four tabs @visual`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setup(page, project);
    await page.evaluate(()=>document.fonts.ready);
    const header = page.locator('.activity-detail-head[data-unified-header]');
    const first = page.locator('.activity-action-dock .activity-primary-actions > button').first();
    const left = (await first.boundingBox()).x;
    const dockTop = (await page.locator('.activity-action-dock').boundingBox()).y;
    const titleSize = await header.locator('h2').evaluate(node => getComputedStyle(node).fontSize);
    const stageLabels = await page.locator('.activity-action-dock .activity-stage-actions button').allTextContents();
    for (const name of tabs) {
      await page.getByRole('tab', { name, exact: true }).click();
      await expect(page.locator('.activity-action-dock .activity-primary-actions > button')).toHaveText(['活动信息查看', '活动信息修改']);
      expect(await page.locator('.activity-action-dock .activity-stage-actions button').allTextContents()).toEqual(stageLabels);
      await expect(page.locator('.activity-action-dock .activity-task-menu > summary')).toHaveText('更多操作');
      expect(Math.abs((await first.boundingBox()).x - left)).toBeLessThanOrEqual(2);
      if (page.viewportSize().width > 800) {
        await page.locator('.activity-detail').evaluate(node => { node.scrollTop = node.scrollHeight; });
        expect(Math.abs((await page.locator('.activity-action-dock').boundingBox()).y - dockTop)).toBeLessThanOrEqual(2);
      } else {
        const expectedTop = await page.locator('.activity-action-dock').evaluate(node => {
          let scroll = node.parentElement;
          while (scroll && !(/auto|scroll/.test(getComputedStyle(scroll).overflowY) && scroll.scrollHeight > scroll.clientHeight)) scroll = scroll.parentElement;
          if (!scroll) {
            const documentScroll = document.scrollingElement;
            if (documentScroll && documentScroll.scrollHeight > documentScroll.clientHeight) scroll = documentScroll;
            else return node.getBoundingClientRect().top;
          }
          const before = node.getBoundingClientRect().top;
          const edge = scroll.getBoundingClientRect().top + scroll.clientTop;
          const previous = scroll.scrollTop;
          scroll.scrollTo({ top: previous + Math.max(100, before - edge + 30), behavior: 'instant' });
          return Math.max(edge, before - (scroll.scrollTop - previous));
        });
        await expect.poll(async () => (await page.locator('.activity-action-dock').boundingBox()).y).toBeCloseTo(expectedTop, 0);
        await expect(first).toBeInViewport();
      }
      await expect(first).toBeVisible();
      expect(await header.locator('h2').evaluate(node => getComputedStyle(node).fontSize)).toBe(titleSize);
      await expect(page.getByRole('group', { name: '活动其他操作', exact: true }).getByRole('button', { name: '复制为新活动', exact: true })).toBeHidden();
    }
  });
}

test('copy opens from more-actions and leaves the original activity untouched', async ({ page }) => {
  await setup(page);
  const writes = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/volunteer/workflow/') && request.method() !== 'GET') writes.push(path);
  });
  await page.locator('.activity-task-menu > summary').click();
  await page.getByRole('group', { name: '活动其他操作', exact: true }).getByRole('button', { name: '复制为新活动', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: '复制为新活动', exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('textbox', { name: '活动名称 必填', exact: true })).toHaveValue('合成统一操作栏');
  expect(writes).toEqual([]);
});

test('read-only source activities keep information viewing and cannot copy or edit', async ({ page }) => {
  await setup(page, false, { 状态: '已结束', 报名页配置: JSON.stringify({ source: { kind: 'generated_blood' } }) });
  const bar = page.getByRole('group', { name: '活动常用操作', exact: true });
  await expect(bar.getByRole('button', { name: '活动信息修改', exact: true })).toBeDisabled();
  await expect(bar.getByRole('button', { name: '复制为新活动', exact: true })).toHaveCount(0);
  await bar.getByRole('button', { name: '活动信息查看', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '活动信息 · 合成统一操作栏', exact: true })).toBeVisible();
});
