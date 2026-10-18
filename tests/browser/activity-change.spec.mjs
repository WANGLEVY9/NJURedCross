import { test, expect } from '@playwright/test';

async function setup(page, { reviewer = false, submitFailure = 0, reviewFailure = false } = {}) {
  await page.request.post('/api/auth/login', { data: { username: reviewer ? 'synthetic-reviewer' : 'synthetic-organizer' } });
  const event = { _id: 'change-event', 活动ID: 'WF-change', 活动名称: '合成变更活动', 状态: '报名中', 负责人账号ID: 'synthetic-organizer',
    活动类别: '志愿服务', 组织类别: '博爱中心', 报名日期: '2030-10-29', 报名时段: '09:00-12:00', 容量: '5', 服务时长: '3', 培训时长: '0', 交通时长: '0',
    地点: '旧地点', 工作内容: '合成引导', 通知草稿: '合成原通知', 报名页配置: JSON.stringify({ approval: { reviewerId: 'synthetic-reviewer' } }) };
  const proposal = { id: 'pending-change', eventId: 'WF-change', actor: 'synthetic-organizer', baseDigest: 'a'.repeat(64), status: 'pending', changes: [{ field: '地点', before: '旧地点', after: '新地点' }] };
  const state = { event, writes: [], entry: reviewer ? { proposal, status: 'pending', version: 1, canReview: true } : null };
  await page.route('**/api/volunteer/workflow/catalog', route => route.fulfill({ json: { events: [event], registrations: [], ledger: [], sources: [] } }));
  await page.route('**/api/volunteer/workflow/events/change-event/change-request**', async route => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() === 'GET') {
      const id = url.searchParams.get('request');
      if (id && state.entry?.proposal.id !== id) return route.fulfill({ status: 404, json: { message: '申请不存在' } });
      return route.fulfill({ json: { ok: true, event, expectedDigest: 'a'.repeat(64), canSubmit: !reviewer,
        result: id || ['pending', 'applying'].includes(state.entry?.status) ? state.entry : null } });
    }
    const body = req.postDataJSON();
    if (url.pathname.endsWith('/preview')) return route.fulfill({ json: { ok: true, result: { patch: body.patch,
      changes: Object.entries(body.patch).map(([field, after]) => ({ field, before: event[field], after })) } } });
    state.writes.push({ path: url.pathname, body });
    if (url.pathname.endsWith('/review')) {
      if (reviewFailure) return route.fulfill({ status: 409, json: { message: '合成审核冲突，输入已保留' } });
      state.entry = { ...state.entry, status: body.decision === 'approve' ? 'approved' : 'returned', reason: body.reason, version: 3, canReview: false };
      if (body.decision === 'approve') event['地点'] = '新地点';
      return route.fulfill({ json: { ok: true, result: state.entry } });
    }
    if (submitFailure === 409) return route.fulfill({ status: 409, json: { message: '活动信息已更新，请重新打开变更表单' } });
    state.entry = { status: 'pending', version: 1, canReview: false, proposal: { ...proposal, id: body.requestId,
      changes: Object.entries(body.patch).map(([field, after]) => ({ field, before: event[field], after })) } };
    if (submitFailure === 503) return route.fulfill({ status: 503, json: { message: '合成响应丢失' } });
    return route.fulfill({ status: 201, json: { ok: true, result: state.entry } });
  });
  await page.goto('/console/events?legacy=1&mode=all&event=change-event');
  const edit = page.getByRole('button', { name: '活动信息修改', exact: true });
  await expect(edit).toBeEnabled(); await edit.click();
  const drawer = page.getByRole('dialog', { name: '活动变更申请', exact: true });
  await expect(drawer).toBeVisible();
  if (!reviewer) await expect(drawer.getByLabel('地点', { exact: false })).toHaveValue('旧地点');
  else await expect(drawer.getByRole('button', { name: '通过变更', exact: true })).toBeVisible();
  return { state, drawer };
}
async function preview(drawer) {
  await drawer.getByLabel('地点', { exact: false }).fill('新地点');
  await drawer.getByRole('button', { name: '预览变更对比', exact: true }).click();
  await expect(drawer.getByRole('table')).toContainText('新地点');
}
test('edits must be previewed again after changing a previewed value', async ({ page }) => {
  const { drawer, state } = await setup(page);
  await expect(drawer.getByRole('button', { name: '提交变更审核', exact: true })).toBeDisabled();
  await preview(drawer);
  await expect(drawer.getByRole('button', { name: '提交变更审核', exact: true })).toBeEnabled();
  await drawer.getByLabel('地点', { exact: false }).fill('另一地点');
  await expect(drawer.getByRole('button', { name: '提交变更审核', exact: true })).toBeDisabled();
  expect(state.writes).toHaveLength(0);
});
test('submission preserves the formal event and sends its snapshot token', async ({ page }) => {
  const { drawer, state } = await setup(page); await preview(drawer);
  await drawer.getByRole('button', { name: '提交变更审核', exact: true }).click();
  await expect(drawer).toContainText('待审核');
  expect(state.event['地点']).toBe('旧地点');
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].body.expectedDigest).toBe('a'.repeat(64));
  await expect(drawer.getByRole('button', { name: '通过变更', exact: true })).toHaveCount(0);
});
test('a stale submission preserves inputs and close protection', async ({ page }) => {
  const { drawer } = await setup(page, { submitFailure: 409 }); await preview(drawer);
  await drawer.getByRole('button', { name: '提交变更审核', exact: true }).click();
  await expect(drawer.getByRole('status', { name: '活动变更状态', exact: true })).toContainText('已更新');
  await expect(drawer.getByLabel('地点', { exact: false })).toHaveValue('新地点');
  await drawer.getByRole('button', { name: '取消', exact: true }).click();
  const guard = page.getByRole('dialog', { name: '放弃未保存的修改？', exact: true });
  await expect(guard).toBeVisible(); await guard.getByRole('button', { name: '取消', exact: true }).click();
  await expect(drawer.getByLabel('地点', { exact: false })).toHaveValue('新地点');
});
test('an unknown submission result is reconciled without submitting a second time', async ({ page }) => {
  const { drawer, state } = await setup(page, { submitFailure: 503 }); await preview(drawer);
  await drawer.getByRole('button', { name: '提交变更审核', exact: true }).click();
  await expect(drawer.getByRole('button', { name: '提交变更审核', exact: true })).toBeDisabled();
  await drawer.getByRole('button', { name: '核对提交结果', exact: true }).click();
  await expect(drawer).toContainText('待审核');
  expect(state.writes).toHaveLength(1);
});
test('reviewer confirms the comparison before applying a change', async ({ page }) => {
  const { drawer, state } = await setup(page, { reviewer: true });
  await drawer.getByRole('button', { name: '通过变更', exact: true }).click();
  await page.getByRole('dialog', { name: '通过活动变更？', exact: true }).getByRole('button', { name: '确认通过变更', exact: true }).click();
  await expect(drawer).toContainText('变更已通过');
  expect(state.writes[0].body).toEqual({ version: 1, decision: 'approve', reason: '' });
});
test('failed return retains the reason and pending request', async ({ page }) => {
  const { drawer, state } = await setup(page, { reviewer: true, reviewFailure: true });
  await drawer.getByLabel('退回原因', { exact: true }).fill('请补充地点说明');
  await drawer.getByRole('button', { name: '退回变更', exact: true }).click();
  await page.getByRole('dialog', { name: '退回活动变更？', exact: true }).getByRole('button', { name: '确认退回变更', exact: true }).click();
  await expect(drawer.getByRole('status', { name: '活动变更状态', exact: true })).toContainText('冲突');
  await expect(drawer.getByLabel('退回原因', { exact: true })).toHaveValue('请补充地点说明');
  expect(state.entry.status).toBe('pending');
});
