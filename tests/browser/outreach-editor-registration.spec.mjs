import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/**
 * 初审「含美编招募」登记 + 终审「预期发布时间」（2026-11-24）。
 *
 * 锁死五个交互契约：
 *   1. 文字稿件初审抽屉必须出现「美编登记」，未选中美编时点通过被拦（不发请求）；
 *   2. 输入学号检索命中唯一一人即自动选中，提交时 payload.manualEditor 带学号；
 *   3. 终审抽屉必须出现「预期发布时间」，未填时点通过被拦，填后 payload 带日期；
 *   4. 名册查无此人必须提示「该成员未注册」，且不能靠它提交通过；
 *   5. 同名多人要给可横向滑动的候选卡片，按学号选中后带对应学号提交。
 */

const source = await readFile(
  new URL('../../public/app/console/pages/outreach.js', import.meta.url),
  'utf8',
);

const MEMBER = {
  id: 'ZQmCUBNfQHu1_dWAjwvIAQ',
  name: '汤艺暄',
  studentId: '251880248',
  faculty: '智能科学与技术学院',
  email: '251880248@smail.nju.edu.cn',
};

/** 名册里的同名对：邓清怡两人、葛浩东一人，用来验证「同名 N 人」与横向卡片。 */
const TWINS = [
  { id: 'ROW-A', name: '邓清怡', studentId: '251880101', faculty: '法学院' },
  { id: 'ROW-B', name: '邓清怡', studentId: '251880102', faculty: '文学院' },
  { id: 'ROW-C', name: '葛浩东', studentId: '251880103', faculty: '物理学院' },
];

/**
 * @param {import('@playwright/test').Page} page
 * @param {{level:number, total:number, passed:number}} stage
 * @param {Array<object>} members 名册检索返回的候选（空数组＝未注册）
 */
async function mount(page, stage = { level: 1, total: 2, passed: 0 }, members = [MEMBER]) {
  await page.route('**/api/**', (route) => route.abort());

  await page.route('**/api/outreach/reviews/synthetic-review/chain',
    (route) => route.fulfill({
      json: {
        ok: true,
        chain: {
          kind: 'article',
          kindLabel: '文字稿件审核链',
          passed: stage.passed,
          total: stage.total,
          done: false,
          canReturn: true,
          category: '活动总结',
          current: { level: stage.level, name: stage.level === 1 ? '对接人初审（含美编招募）' : '审核人终审' },
          steps: [
            { level: 1, name: '对接人初审（含美编招募）', done: stage.passed >= 1 },
            { level: 2, name: '审核人终审', done: false },
          ],
          manualEditor: stage.passed >= 1 ? MEMBER : null,
        },
      },
    }));

  await page.route('**/api/outreach/checklist',
    (route) => route.fulfill({
      json: {
        ok: true,
        checklist: [{
          id: 'synthetic-check',
          category: '合成检查组',
          item: '合成检查项',
          standard: '合成检查标准',
        }],
      },
    }));

  await page.route('**/api/outreach/assignees*',
    (route) => route.fulfill({
      json: {
        ok: true,
        liaison: { name: '王诺' },
        reviewer: { name: '金中宸' },
      },
    }));

  await page.route('**/api/outreach/members*',
    (route) => {
      const query = new URL(route.request().url()).searchParams.get('q') || '';
      return route.fulfill({
        json: { ok: true, query, members, truncated: false },
      });
    });

  await page.route('**/app/console/pages/outreach.js*',
    (route) => route.fulfill({
      contentType: 'text/javascript',
      body: `${source}\nexport { openReviewDrawer };\n`,
    }));

  await page.route('**/outreach-editor-fixture',
    (route) => route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html>
        <html data-surface="console" data-theme="porcelain" data-motion="reduced">
        <head>
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

  await page.goto('/outreach-editor-fixture');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async () => {
    const { openReviewDrawer } = await import('/app/console/pages/outreach.js');
    window.reviewCalls = [];
    openReviewDrawer({
      eyebrow: '合成审核',
      title: '合成稿件',
      meta: null,
      content: '合成正文',
      reviewFlow: { contentId: 'synthetic-review', category: '活动总结' },
      onSubmit: async (payload) => {
        window.reviewCalls.push(payload);
        return { ok: true, message: '合成审核成功' };
      },
    });
  });

  await expect(page.getByText('本次审核责任人（按栏目自动匹配）', { exact: true })).toBeVisible();
}

async function checkAll(page) {
  const checkbox = page.getByRole('checkbox', { name: /^合成检查项/ });
  await page.locator('label.check').filter({ has: checkbox }).locator('.check__box').click();
  await expect(checkbox).toBeChecked();
}

test('初审未登记美编时点通过被拦，不发请求', async ({ page }) => {
  await mount(page);
  await expect(page.getByText('美编登记（初审含美编招募）', { exact: true }).first()).toBeVisible();

  await checkAll(page);
  await page.getByRole('button', { name: '提交审核结果', exact: true }).click();

  await expect(page.getByText('请先检索并选中美编（初审含美编招募），再提交通过。', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.reviewCalls.length)).toBe(0);
});

test('输入学号检索命中唯一一人即选中，提交带 manualEditor', async ({ page }) => {
  await mount(page);

  await page.getByLabel('美编登记（初审含美编招募）', { exact: true }).fill('251880248');
  await page.getByRole('button', { name: '查找成员', exact: true }).click();

  await expect(page.getByText(
    '已选美编：汤艺暄 · 251880248 · 智能科学与技术学院',
    { exact: true },
  )).toBeVisible();

  await checkAll(page);
  await page.getByRole('button', { name: '提交审核结果', exact: true }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  const calls = await page.evaluate(() => window.reviewCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0].manualEditor).toEqual({ name: '汤艺暄', studentId: '251880248' });
});

test('终审未填预期发布时间时点通过被拦，填后提交带日期', async ({ page }) => {
  await mount(page, { level: 2, total: 2, passed: 1 });

  // 初审登记过的美编在终审只读回显，不再要求重填。
  await expect(page.getByText('已选美编', { exact: false })).toHaveCount(0);
  await expect(page.getByText('汤艺暄 · 251880248 · 智能科学与技术学院', { exact: false })).toBeVisible();
  await expect(page.locator('input[name="expectedPublishDate"]')).toBeVisible();

  await checkAll(page);
  await page.getByRole('button', { name: '提交审核结果', exact: true }).click();
  await expect(page.getByText('终审通过前必须填写预期发布时间', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.reviewCalls.length)).toBe(0);

  await page.locator('input[name="expectedPublishDate"]').fill('2026-11-27');
  await page.getByRole('button', { name: '提交审核结果', exact: true }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  const calls = await page.evaluate(() => window.reviewCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0].expectedPublishDate).toBe('2026-11-27');
});

test('名册查无此人时提示「该成员未注册」，且不能靠它提交通过', async ({ page }) => {
  await mount(page, undefined, []);

  await page.getByLabel('美编登记（初审含美编招募）', { exact: true }).fill('张三');
  await page.getByRole('button', { name: '查找成员', exact: true }).click();

  await expect(page.getByText('该成员未注册', { exact: true })).toBeVisible();
  await expect(page.getByText(/名册（全体成员表·26~27学年）里没有「张三」/)).toBeVisible();
  await expect(page.getByText(/需联系管理员补录名册/)).toBeVisible();
  await expect(page.locator('.member-pick__card')).toHaveCount(0);

  await checkAll(page);
  await page.getByRole('button', { name: '提交审核结果', exact: true }).click();
  await expect(page.getByText('请先检索并选中美编（初审含美编招募），再提交通过。', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.reviewCalls.length)).toBe(0);
});

test('同名多人时给出可横向滑动的候选卡片，按学号选中后提交', async ({ page }) => {
  await mount(page, undefined, TWINS);

  await page.getByLabel('美编登记（初审含美编招募）', { exact: true }).fill('邓清怡');
  await page.getByRole('button', { name: '查找成员', exact: true }).click();

  await expect(page.getByText('「邓清怡」匹配到 3 人，左右滑动卡片，按学号选中本人：', { exact: true })).toBeVisible();
  const cards = page.locator('.member-pick__card');
  await expect(cards).toHaveCount(3);
  await expect(page.locator('.member-pick__badge').first()).toHaveText('同名 2 人');

  // 「可以滑动」是硬契约：轨道必须横向溢出且横向滚动，而不是竖排换行。
  const track = page.locator('.member-pick__track');
  const metrics = await track.evaluate((node) => ({
    overflowX: getComputedStyle(node).overflowX,
    wraps: getComputedStyle(node).flexWrap,
    scrollable: node.scrollWidth > node.clientWidth,
  }));
  expect(metrics.overflowX).toBe('auto');
  expect(metrics.wraps).toBe('nowrap');
  expect(metrics.scrollable).toBe(true);

  await cards.nth(1).click();
  // 选中后卡片保留并高亮（可看清选的是哪一位、也能改选），确认条同步出现。
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(cards.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('已选美编：邓清怡 · 251880102 · 文学院', { exact: true })).toBeVisible();

  await checkAll(page);
  await page.getByRole('button', { name: '提交审核结果', exact: true }).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  const calls = await page.evaluate(() => window.reviewCalls);
  expect(calls).toHaveLength(1);
  expect(calls[0].manualEditor).toEqual({ name: '邓清怡', studentId: '251880102' });
});
