import { test, expect } from './legacy-activity-fixture.mjs';
import ExcelJS from 'exceljs';

const headers = { 'x-csrf-token': 'synthetic-ui' };
const root = '/api/volunteer/workflow';
const login = (page, username) => page.request.post('/api/auth/login', { data: { username } });
async function post(page, path, data = {}) {
  const response = await page.request.post(root + path, { headers, data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function task(page, name) {
  const menu = page.locator('.activity-task-menu');
  await menu.locator('summary').click();
  await menu.getByRole('button', { name, exact: true }).click();
}
async function sheet(page, id) {
  return (await (await page.request.get(`${root}/events/${id}/hours-sheet`)).json()).submission;
}

test('real API handoff: attendance, header submission, return, resubmit, Excel and explicit finish', async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await login(page, 'synthetic-organizer');
  const { result: event } = await post(page, '/events', {
    name: `合成整合交接 ${info.project.name}`, center: '博爱中心', date: '2030-10-29',
    slot: '09:00-12:00', capacity: 3, serviceHours: 3, trainingHours: 0, travelHours: 0,
    location: '合成验收教室', work: '合成引导',
  });
  const path = `/events/${event._id}`;
  await login(page, 'synthetic-reviewer');
  await post(page, path + '/approve'); await post(page, path + '/publish');
  await post(page, path + '/close');
  // Cutoff also protects the portal API, and an empty roster can still finish explicitly.
  const closed = await page.request.post(`/api/portal/workflow/events/${event._id}/register`, { headers, data: { consent: true } });
  expect(closed.status()).toBe(409);
  await post(page, path + '/submit-hours', { revision: 0 });
  await post(page, path + '/finish');
  await login(page, 'synthetic-organizer');
  const { result: active } = await post(page, '/events', {
    name: `合成签到交接 ${info.project.name}`, center: '博爱中心', date: '2030-10-29',
    slot: '09:00-12:00', capacity: 3, serviceHours: 3, location: '合成验收教室', work: '合成引导',
  });
  const activePath = `/events/${active._id}`;
  await login(page, 'synthetic-reviewer');
  await post(page, activePath + '/approve'); await post(page, activePath + '/publish');
  const registered = await page.request.post(`/api/portal/workflow/events/${active._id}/register`, { headers, data: { consent: true } });
  expect(registered.ok(), await registered.text()).toBe(true);
  const detail = await (await page.request.get(`${root}${activePath}/detail`)).json();
  const registration = detail.registrations[0];
  await post(page, `/registrations/${registration._id}/confirm`);
  await login(page, 'synthetic-organizer');
  await page.goto(`/console/events?legacy=1&event=${active._id}&mode=all&tab=checkins`);
  await task(page, '报名截止');
  await page.getByRole('dialog', { name: '截止报名？' }).getByRole('button', { name: '报名截止', exact: true }).click();
  const submission = page.getByRole('region', { name: '整份时长表', exact: true });
  await expect(submission).toContainText('还有 1 人未处理');
  async function capture(stage) {
    const widths = info.project.name.includes('mobile') ? [360, 390, 768] : [1280, 1440];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await expect(submission).toBeVisible();
      await expect(async () => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      }).toPass({ timeout: 5_000 });
      await page.screenshot({ path: info.outputPath(`${stage}-${width}.png`), animations: 'disabled', style: '#toast-root { visibility: hidden; }' });
    }
  }
  await capture('attendance');
  async function record(value) {
    await page.getByRole('button', { name: '核验并录入', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '合成测试同学 · 签到详情' });
    await drawer.getByRole('spinbutton', { name: '服务时长 必填', exact: true }).fill(value);
    await drawer.locator('label.check').filter({ hasText: '已核对签到依据与实际到场情况' }).click();
    await drawer.getByRole('button', { name: '确认签到并录入时长' }).click();
    await expect(drawer).toHaveCount(0);
  }
  await record('2.5'); await expect(submission).toContainText('还有 0 人未处理');
  async function submit() {
    await task(page, '提交时长表');
    await page.getByRole('dialog', { name: '提交时长表？', exact: true }).getByRole('button', { name: '提交时长表', exact: true }).click();
    await expect(submission).toContainText('已提交审核');
  }
  await submit(); expect((await sheet(page, active._id)).phase).toBe('submitted');
  await capture('submitted');
  const locked = await page.request.post(root + activePath + '/attendance-batch', { headers, data: { items: [{ id: registration._id, hours: { serviceHours: 99 } }] } });
  expect((await locked.json()).failed).toBe(1);
  await login(page, 'synthetic-second-chair');
  const denied = await page.request.post(root + activePath + '/return-hours', { headers, data: { revision: 1, reason: '合成越权', role: 'super_admin' } });
  expect([400, 403]).toContain(denied.status());
  const unauthorized = await page.request.post(root + activePath + '/return-hours', { headers, data: { revision: 1, reason: '合成越权' } });
  expect(unauthorized.status()).toBe(403);
  await login(page, 'synthetic-reviewer'); await page.reload();
  await submission.getByRole('button', { name: '退回时长表', exact: true }).click();
  const reason = page.getByRole('dialog', { name: '退回时长表', exact: true });
  await reason.getByLabel('退回原因').fill('合成：按实际离场时间重新核对');
  await reason.getByRole('button', { name: '确认', exact: true }).click(); await expect(reason).toHaveCount(0);
  await login(page, 'synthetic-organizer'); await page.reload();
  await page.getByRole('tab', { name: '志愿者签到', exact: true }).click();
  await capture('returned');
  // Returned unapproved entries must appear in the default filter on both layouts.
  await record('2'); await submit(); expect((await sheet(page, active._id)).revision).toBe(3);
  await login(page, 'synthetic-reviewer'); await page.reload();
  await page.getByRole('tab', { name: '时长录入与导出', exact: true }).click();
  await page.getByRole('button', { name: '全选当前可审核名单', exact: true }).click();
  await page.getByRole('button', { name: '审核通过', exact: true }).click();
  await expect(page.getByText('已通过 1 条服务记录', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '在线预览', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '志愿时长录入表 · 在线预览', exact: true });
  await expect(preview).toContainText('院系'); await preview.getByRole('button', { name: '关闭', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 Excel', exact: true }).click();
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(await (await download).path());
  expect(workbook.worksheets[0].columnCount).toBe(10);
  expect(workbook.worksheets[0].getRow(1).values).toContain('院系');
  const current = async () => (await (await page.request.get(`${root}${activePath}/detail`)).json()).events.find(row => row._id === active._id);
  expect((await current())['状态']).toBe('进行中');
  await task(page, '结束活动');
  await page.getByRole('dialog', { name: '结束活动？', exact: true }).getByRole('button', { name: '结束活动', exact: true }).click();
  await expect.poll(async () => (await current())['状态']).toBe('已结束');
  await expect(submission).toContainText('只读');
  await expect(page.getByRole('button', { name: '活动信息修改', exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('completed-workflow.png'), animations: 'disabled' });
  expect(errors).toEqual([]);
});
