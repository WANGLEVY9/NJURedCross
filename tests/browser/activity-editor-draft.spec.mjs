import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../../public/app/console/pages/activity-center.js', import.meta.url),
  'utf8',
);
const start = source.indexOf(' async function createDrawer(');
const end = source.indexOf('\n async function archive(', start);
if (start < 0 || end <= start) throw new Error('未找到活动配置函数');

const fixtureExport = `
export async function openSyntheticEditor() {
  const data = { events: [], sources: [] };
  const actor = 'synthetic-owner';
  const directory = {
    administrators: [
      { id: 'synthetic-owner', name: '合成主负责人' },
      { id: 'synthetic-helper', name: '合成补充负责人' },
    ],
  };
  const directoryError = false;
  const activityDisposed = false;
  const approvalSettings = null;
  const approvalSettingsPending = null;
  const loadApprovalSettings = async () => {};
  const loadDirectory = async () => {};
  let selected = '', tab = 'overview', mode = 'all';
  let search = '', category = '', area = 'all';
  const searchInput = { setValue() {} };
  const categoryControl = { control: { value: '' } };
  const areaControl = { control: { value: 'all' } };
  const modeControl = { setValue() {} };
  const view = h('div');
  const renderPayload = () => [];
  const refreshAfterWrite = async () => { window.refreshCalls++; };

  ${source.slice(start, end)}

  await createDrawer({
    event: {
      _id: 'synthetic-event',
      '负责人账号ID': 'synthetic-owner',
      '活动名称': '合成活动',
      '活动类别': '合成专项',
      '活动地区': '南京地区',
      '组织类别': '未分类',
      '报名日期': '2026-10-20',
      '报名时段': '12:00-14:00',
      '岗位': '合成岗位',
      '容量': 20,
      '服务时长': 2,
      '培训时长': 1,
      '交通时长': 1,
      '地点': '合成地点',
      '工作内容': '合成工作',
      '报名页配置': JSON.stringify({
        templateId: 'general',
        content: '合成活动内容',
        registrationLimit: 30,
        coOwners: [],
      }),
    },
  });
}
`;

const smallFormStart = source.indexOf(' function reasonAction(');
if (smallFormStart < 0 || smallFormStart >= start) {
  throw new Error('未找到活动处理说明和通知表单');
}

const smallFormExport = `
export function openSyntheticSmallForm(kind) {
  const mutate = async (path, body, method = 'POST') => {
    await request(root + path, { method, body });
    window.refreshCalls++;
  };

  ${source.slice(smallFormStart, start)}

  if (kind === 'reason') {
    reasonAction('合成处理说明', '/synthetic-action');
  } else {
    editNoticeDrawer({
      _id: 'synthetic-event',
      '通知草稿': '原始合成通知',
    });
  }
}
`;

async function mount(page, succeeds = false, kind = 'editor', failureStatus = 400) {
  const requests = [];
  await page.route('**/api/**', (route) => route.abort());

  await page.route('**/api/volunteer/workflow/**',
    async (route) => {
      requests.push({
        method: route.request().method(),
        body: route.request().postDataJSON(),
      });
      await route.fulfill({
        status: succeeds ? 200 : failureStatus,
        json: succeeds
          ? { ok: true }
          : { code: 'synthetic_failure', message: '合成保存失败' },
      });
    });

  await page.route('**/app/console/pages/activity-center.js',
    (route) => route.fulfill({
      contentType: 'text/javascript',
      body: source + fixtureExport + smallFormExport,
    }));

  await page.route('**/activity-editor-fixture',
    (route) => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html>
        <html data-surface="console" data-theme="porcelain" data-motion="reduced">
        <head><meta charset="utf-8">
          <link rel="stylesheet" href="/styles/tokens.css">
          <link rel="stylesheet" href="/styles/base.css">
          <link rel="stylesheet" href="/styles/components.css">
          <link rel="stylesheet" href="/styles/admin.css">
        </head>
        <body>
          <div id="root"><button>合成入口</button></div>
          <div id="overlay-root"></div>
          <div id="toast-root"></div>
        </body></html>`,
    }));

  await page.goto('/activity-editor-fixture');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(async (kind) => {
    window.refreshCalls = 0;
    const module = await import('/app/console/pages/activity-center.js');
    if (kind === 'editor') await module.openSyntheticEditor();
    else module.openSyntheticSmallForm(kind);
  }, kind);
  return requests;
}

test('unchanged activity editors close without confirmation', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('failed saves preserve fields, owners and close protection', async ({ page }) => {
  const requests = await mount(page);
  const name = page.locator('input[name="name"]');
  await name.fill('修改后的合成活动');

  const owner = page.getByRole('checkbox', {
    name: '合成补充负责人',
    exact: true,
  });
  await page.locator('label.check')
    .filter({ has: owner })
    .locator('.check__box')
    .click();
  await expect(owner).toBeChecked();

  const save = page.getByRole('button', {
    name: '保存草稿',
    exact: true,
  });
  await save.click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(save).toBeEnabled();
  await expect(name).toHaveValue('修改后的合成活动');
  await expect(owner).toBeChecked();
  expect(requests[0].body.coOwners).toEqual(['synthetic-helper']);

  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const warning = page.getByRole('dialog', {
    name: '放弃未保存的修改？',
    exact: true,
  });
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: '取消', exact: true }).click();
  await expect(warning).toHaveCount(0);
  await expect(name).toHaveValue('修改后的合成活动');
});

test('successful saves release protection and close', async ({ page }) => {
  const requests = await mount(page, true);
  await page.locator('input[name="name"]').fill('已保存的合成活动');
  await page.getByRole('button', {
    name: '保存草稿',
    exact: true,
  }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(requests[0].method).toBe('PATCH');
  expect(requests[0].body.name).toBe('已保存的合成活动');
  expect(await page.evaluate(() => window.refreshCalls)).toBe(1);
});

test('uncertain server failures preserve the draft but block duplicate saving', async ({ page }) => {
  const requests = await mount(page, false, 'editor', 503);
  await page.locator('input[name="name"]').fill('结果待核实的合成活动');
  const save = page.getByRole('button', { name: '保存草稿', exact: true });
  await save.click();
  await expect(page.locator('.form-workspace-status')).toContainText('暂时无法确认保存结果');
  await expect(save).toBeDisabled();
  await expect(page.locator('input[name="name"]')).toHaveValue('结果待核实的合成活动');
  expect(requests).toHaveLength(1);
});

for (const kind of ['reason', 'notice']) {
  const fieldLabel = kind === 'reason' ? '处理说明' : '报名通知';
  const buttonLabel = kind === 'reason' ? '确认处理' : '保存通知';

  test(`${kind}: failed submissions preserve input and protection`, async ({ page }) => {
    const requests = await mount(page, false, kind);
    const input = page.getByRole('textbox', {
      name: new RegExp(`^${fieldLabel}`),
    });
    await input.fill('尚未保存的合成内容');
    const submit = page.getByRole('button', {
      name: buttonLabel,
      exact: true,
    });
    await submit.click();

    await expect.poll(() => requests.length).toBe(1);
    await expect(submit).toBeEnabled();
    await expect(input).toHaveValue('尚未保存的合成内容');
    expect(await page.evaluate(() => window.refreshCalls)).toBe(0);

    await page.getByRole('button', { name: '关闭', exact: true }).click();
    const warning = page.getByRole('dialog', {
      name: '放弃未保存的修改？',
      exact: true,
    });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', {
      name: '取消',
      exact: true,
    }).click();
    await expect(warning).toHaveCount(0);
    await expect(input).toHaveValue('尚未保存的合成内容');
  });

  test(`${kind}: successful submissions release protection`, async ({ page }) => {
    const requests = await mount(page, true, kind);
    await page.getByRole('textbox', {
      name: new RegExp(`^${fieldLabel}`),
    }).fill('已保存的合成内容');
    await page.getByRole('button', {
      name: buttonLabel,
      exact: true,
    }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe(kind === 'reason' ? 'POST' : 'PATCH');
    expect(requests[0].body[kind === 'reason' ? 'reason' : 'text'])
      .toBe('已保存的合成内容');
    expect(await page.evaluate(() => window.refreshCalls)).toBe(1);
  });
}
