import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

/**
 * 退回意见的溯源与重发（2026-11-25）。
 *
 * 现场：投稿人在微信里说「看不到修改意见的附件」，负责人想再退一次，
 * 但同一级只允许一轮意见。这里锁死三个交互契约：
 *   1. 已退回稿件必须展示历史意见原文、审核人与该封邮件的投递结果；
 *   2. 「重发意见邮件」只重投同一轮，不改变审核状态（抽屉仍显示已退回）；
 *   3. 重发请求必须带上原始轮次的 at，服务端才能定位到那一条轨迹。
 */

const source = await readFile(
  new URL('../../public/app/console/pages/outreach.js', import.meta.url),
  'utf8',
);

const RETURN_AT = '2026-11-24T03:01:23.683Z';

const RETURN_ENTRY = {
  level: 1,
  name: '对接人初审（含美编招募）',
  role: 'outreach_liaison',
  decision: 'return',
  note: '地点名称前后不一致：开头写「十八食堂一楼」，正文写「第十八食堂一楼」。\n\n组织名称三种写法混用，请统一为全称。',
  reviewer: 'wangnuo',
  reviewerName: '王诺',
  at: RETURN_AT,
  checklist: ['synthetic-check'],
  opinions: [{ position: '第 2 段', problem: '人数不符', requirement: '改为 120 人', fixed: '' }],
  delivery: {
    status: 'sent',
    at: '2026-11-24T03:01:24.561Z',
    recipients: [{ to: '251880319@smail.nju.edu.cn', tag: 'submitter' }],
    failures: [],
    resends: [{ at: '2026-11-25T01:00:00.000Z', by: 'wangnuo', attempt: 1, status: 'sent' }],
  },
};

function chainWith(resends) {
  return {
    ok: true,
    chain: {
      kind: 'article',
      kindLabel: '文字稿件审核链',
      passed: 0,
      total: 2,
      done: false,
      status: '已退回',
      canReturn: false,
      category: '活动总结',
      current: { level: 1, name: '对接人初审（含美编招募）' },
      steps: [
        { level: 1, name: '对接人初审（含美编招募）', done: false, returnRounds: 1 },
        { level: 2, name: '审核人终审', done: false, returnRounds: 0 },
      ],
      trail: [{ ...RETURN_ENTRY, delivery: { ...RETURN_ENTRY.delivery, resends } }],
    },
  };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{onResend?: (body: object) => object}} options
 */
async function mount(page, { onResend } = {}) {
  await page.route('**/api/**', (route) => route.abort());

  let resendBody = null;
  await page.route('**/api/outreach/reviews/synthetic-review/chain',
    (route) => route.fulfill({ json: chainWith(RETURN_ENTRY.delivery.resends) }));

  await page.route('**/api/outreach/reviews/synthetic-review/opinion/resend',
    async (route) => {
      resendBody = route.request().postDataJSON();
      const {
        chain,
        deliveryStatus = 'sent',
        message = '第 2 次重发：退回意见（含意见 Word 附件）已发投稿人',
      } = onResend?.(resendBody) || {};
      await route.fulfill({
        json: chain
          ? { ok: true, deliveryStatus, message, chain }
          : {
              ok: true, deliveryStatus, message,
              chain: chainWith([
                ...RETURN_ENTRY.delivery.resends,
                { at: '2026-11-25T02:30:00.000Z', by: 'wangnuo', attempt: 2, status: 'sent' },
              ]).chain,
            },
      });
    });

  await page.route('**/api/outreach/checklist',
    (route) => route.fulfill({
      json: {
        ok: true,
        checklist: [{ id: 'synthetic-check', category: '合成检查组', item: '合成检查项', standard: '合成检查标准' }],
      },
    }));

  await page.route('**/api/outreach/assignees*',
    (route) => route.fulfill({
      json: { ok: true, liaison: { name: '王诺' }, reviewer: { name: '金中宸' } },
    }));

  await page.route('**/app/console/pages/outreach.js*',
    (route) => route.fulfill({
      contentType: 'text/javascript',
      body: `${source}\nexport { openReviewDrawer };\n`,
    }));

  await page.route('**/outreach-opinion-fixture',
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

  await page.goto('/outreach-opinion-fixture');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async () => {
    const { openReviewDrawer } = await import('/app/console/pages/outreach.js');
    window.resendCalls = [];
    openReviewDrawer({
      eyebrow: '合成审核',
      title: '11.20献血周总结推文',
      meta: null,
      content: '合成正文',
      reviewFlow: { contentId: 'synthetic-review', category: '活动总结' },
      onSubmit: async () => ({ ok: true, message: '不会走到这里' }),
    });
  });

  await expect(page.getByText('审核记录（退回意见与邮件投递）', { exact: true })).toBeVisible();
  return () => resendBody;
}

test('已退回稿件展示意见原文、审核人与投递结果', async ({ page }) => {
  await mount(page);

  await expect(page.getByText('第 1 级 · 对接人初审（含美编招募）', { exact: true })).toBeVisible();
  await expect(page.getByText('审核人：王诺 · 已确认 1 项', { exact: true })).toBeVisible();
  // 多段意见按行拆开渲染，不能折成一行。
  await expect(page.getByText('地点名称前后不一致', { exact: false })).toBeVisible();
  await expect(page.getByText('组织名称三种写法混用', { exact: false })).toBeVisible();
  await expect(page.getByText('[第 2 段] 人数不符 → 改为 120 人', { exact: true })).toBeVisible();
  // 投递结果与历史重发都要可追溯。
  await expect(page.getByText('邮件已发送', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('251880319@smail.nju.edu.cn', { exact: false })).toBeVisible();
  await expect(page.getByText('第 1 次重发', { exact: false })).toBeVisible();
});

test('重发同一轮意见：带原始 at，状态不变，记录追加', async ({ page }) => {
  const body = await mount(page);

  await page.getByRole('button', { name: '重发意见邮件' }).first().click();

  await expect(page.getByText('退回意见已重发', { exact: true })).toBeVisible();
  await expect(page.getByText('第 2 次重发 ·', { exact: false })).toBeVisible();
  // 重发不是新一轮退回：抽屉仍停在原层级，退回次数没有被重置。
  await expect(page.getByText('当前待「对接人初审（含美编招募）」处理。', { exact: true })).toBeVisible();
  await expect(page.getByText('邮件已发送', { exact: true }).first()).toBeVisible();

  expect(body()).toEqual({ at: RETURN_AT });
});

test('重发失败时用具警语气说明，不伪装成已发送', async ({ page }) => {
  await mount(page, {
    onResend: () => ({
      deliveryStatus: 'failed',
      message: '第 2 次重发：意见邮件发送失败（已进重试队列），可下载意见 Word 转交投稿人',
    }),
  });

  await page.getByRole('button', { name: '重发意见邮件' }).first().click();

  await expect(page.getByText('重发未成功', { exact: true })).toBeVisible();
  await expect(page.getByText('意见邮件发送失败（已进重试队列）', { exact: false })).toBeVisible();
  // 语气不能是成功：不能让负责人以为投稿人已经收到。
  await expect(page.getByText('退回意见已重发', { exact: true })).toHaveCount(0);
});
