import { test, expect } from '@playwright/test';

/**
 * 投稿页归档两项的折叠（2026-11-09 定案）：
 * 11 个推文栏目里只有「活动预热 / 活动总结」围绕某一场具体活动，
 * 需要投稿人手选「所属部门 + 所属活动」；其余 9 个栏目折叠掉这两个必填下拉，
 * 只显示一行只读的归档位置（主席团活动 / 宣新工作组）。
 *
 * 断面测法：直接看 DOM 里还有没有 select[name=center] / select[name=activity]。
 * 折叠 = 节点不在文档里（不是 display:none），所以用 toHaveCount 判。
 */

const CATEGORIES = ['小红帮推', '活动预热', '活动总结', '健康小蓝鲸', '今日节日', '心灵慢车',
  '南男女侣', '红会新闻', '南小红月报', '人道法言', '红会招新'];

test.beforeEach(async ({ page }) => {
  // 合成数据：栏目字典、活动候选、附件配置都本地兜住，页面不会弹「加载失败」的提示条。
  await page.route('**/api/public/writing-types', (route) => route.fulfill({ json: { articleCategories: CATEGORIES } }));
  await page.route('**/api/public/media/activities*', (route) => route.fulfill({ json: { allActivities: [], centers: [] } }));
  await page.route('**/api/public/attachments/mine', (route) => route.fulfill({ json: { ok: true, attachments: [], config: { storageConfigured: false } } }));
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-reviewer' } });
});

test('只有活动预热 / 活动总结露出部门与活动，其余栏目折叠成自动归档', async ({ page }) => {
  await page.goto('/submit');
  await page.getByRole('button', { name: /下一步 · 填写内容/ }).click();

  const centerSelect = page.locator('select[name="center"]');
  const activitySelect = page.locator('select[name="activity"]');
  const chipRow = page.locator('.chip-row');

  // 未选栏目：按「非活动类」处理，两个必填下拉不出现，只有只读的归档位置。
  await expect(chipRow.getByRole('button', { name: '活动预热', exact: true })).toBeVisible();
  await expect(centerSelect).toHaveCount(0);
  await expect(activitySelect).toHaveCount(0);
  await expect(page.getByText('主席团活动 / 宣新工作组', { exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: '归档位置（自动）' })).toBeVisible();

  // 活动预热 → 两个必填下拉出现。
  await chipRow.getByRole('button', { name: '活动预热', exact: true }).click();
  await expect(centerSelect).toHaveCount(1);
  await expect(activitySelect).toHaveCount(1);
  await expect(page.getByText('主席团活动 / 宣新工作组', { exact: true })).toHaveCount(0);

  // 活动总结 → 仍然要选。
  await chipRow.getByRole('button', { name: '活动总结', exact: true }).click();
  await expect(centerSelect).toHaveCount(1);
  await expect(activitySelect).toHaveCount(1);

  // 换到任意普通栏目 → 再次折叠，且说明文字给出固定落点。
  await chipRow.getByRole('button', { name: '红会新闻', exact: true }).click();
  await expect(centerSelect).toHaveCount(0);
  await expect(activitySelect).toHaveCount(0);
  await expect(page.getByText('主席团活动 / 宣新工作组', { exact: true })).toBeVisible();

  // 其余 9 个栏目逐个过一遍：都不出现部门/活动下拉。
  for (const name of CATEGORIES.filter((item) => !['活动预热', '活动总结'].includes(item))) {
    await chipRow.getByRole('button', { name, exact: true }).click();
    await expect(centerSelect, name).toHaveCount(0);
    await expect(activitySelect, name).toHaveCount(0);
    await expect(chipRow.getByRole('button', { name, exact: true }), name).toHaveAttribute('aria-pressed', 'true');
  }
});

test('折叠态下「下一步」不再因缺部门/活动被拦，回到手选态才拦', async ({ page }) => {
  await page.goto('/submit');
  await page.getByRole('button', { name: /下一步 · 填写内容/ }).click();

  const chipRow = page.locator('.chip-row');
  const titleInput = page.locator('input[name="title"]');
  const contentArea = page.locator('textarea[name="content"]');

  await titleInput.fill('合成稿件：折叠态校验');
  await contentArea.fill('这是一段用于界面测试的合成正文，长度超过二十个字，仅用于验证折叠态不拦下一步。');
  await chipRow.getByRole('button', { name: '小红帮推', exact: true }).click();

  // 折叠态：不选部门/活动也能进第三步。
  await page.getByRole('button', { name: /下一步 · 附件与提交/ }).click();
  await expect(page.getByRole('heading', { name: '附件', exact: true })).toBeVisible();

  // 回到第二步改成活动预热：没选部门/活动时会被拦下，并就地标红。
  await page.getByRole('button', { name: '上一步', exact: true }).click();
  await chipRow.getByRole('button', { name: '活动预热', exact: true }).click();
  await page.getByRole('button', { name: /下一步 · 附件与提交/ }).click();
  await expect(page.getByText('请选择所属部门', { exact: true })).toBeVisible();
  await expect(page.locator('select[name="center"]')).toHaveCount(1);
});
