import { test, expect } from '@playwright/test';

/**
 * The operations log used to squeeze seven auto-sized columns into a narrow
 * reading area: dates stacked vertically, result badges wrapped, and a wide
 * blank strip on the right. These checks keep the widened rail, centred reading
 * column and semantic column widths from regressing.
 */
const entry = {
  id: 'audit-layout-1', at: '2026-11-07T10:00:00.000Z', actor: 'synthetic-super', role: 'super_admin',
  action: 'workflow.registration.create', target: 'ACC-NAV3KPGT3-7QES4C', result: 'success',
  ip: '127.0.0.1', board: 'event', actorName: '王泰杰',
  actorEmail: 'synthetic-super@smail.nju.edu.cn', metadata: { eventId: 'EVT-LAYOUT-1' },
};

for (const width of [1440, 1920, 2200]) {
  test(`operation log layout stays balanced at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.request.post('/api/auth/login', { data: { username: 'synthetic-super' } });
    await page.route('**/api/audit/logs*', route => route.fulfill({ json: {
      ok: true, entries: [entry], hasMore: false, scanned: 1,
      boards: [{ key: 'event', label: '活动与报名' }],
    } }));
    await page.goto('/console/audit');
    await expect(page.locator('#boot-screen')).toHaveCount(0);
    await expect(page.locator('.audit-log .table')).toBeVisible();

    const rail = Math.round((await page.locator('.nav').boundingBox()).width);
    expect(rail).toBeGreaterThanOrEqual(240);
    expect(rail).toBeLessThanOrEqual(264);

    for (const selector of ['.nav__brand-text b', '.nav__workspace-text b']) {
      const label = await page.locator(selector).evaluate(node => ({
        height: node.getBoundingClientRect().height,
        whiteSpace: getComputedStyle(node).whiteSpace,
      }));
      expect(label.whiteSpace, selector).toBe('nowrap');
      expect(label.height, selector).toBeLessThan(24);
    }

    const geometry = await page.evaluate(() => {
      const box = selector => {
        const node = document.querySelector(selector);
        const rect = node?.getBoundingClientRect();
        return rect ? { x: Math.round(rect.x), width: Math.round(rect.width), right: Math.round(rect.right) } : null;
      };
      return {
        main: box('.wsmain'), pad: box('.audit-log'),
        region: box('.wsregion'), wrap: box('.table-wrap'), table: box('.audit-log .table'),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    console.log('[audit-layout]', width, JSON.stringify(geometry));
    const leftGutter = geometry.pad.x - geometry.main.x;
    expect(Math.abs(leftGutter - (geometry.main.right - geometry.pad.right))).toBeLessThanOrEqual(2);
    // Beyond the content cap the reading column must be centred, not pinned
    // to the left edge with all the spare space dumped on the right.
    if (width >= 2000) expect(leftGutter).toBeGreaterThan(0);
    expect(geometry.table.width).toBeGreaterThanOrEqual(900);
    expect(geometry.overflow).toBeLessThanOrEqual(1);

    const time = await page.locator('.audit-log .table td[data-label="时间"]').first().evaluate(node => {
      const text = node.querySelector('span');
      return {
        width: node.getBoundingClientRect().width,
        // The row is as tall as its two-line actor cell; check the date text
        // itself so we test for a vertical stack, not the shared row height.
        textHeight: text ? text.getBoundingClientRect().height : 0,
        whiteSpace: getComputedStyle(node).whiteSpace,
      };
    });
    expect(time.width).toBeGreaterThanOrEqual(160);
    expect(time.whiteSpace).toBe('nowrap');
    expect(time.textHeight).toBeLessThanOrEqual(24);

    const resultHead = await page.locator('.audit-log .table th[data-key="result"]').boundingBox();
    expect(resultHead.width).toBeGreaterThanOrEqual(95);
  });
}
