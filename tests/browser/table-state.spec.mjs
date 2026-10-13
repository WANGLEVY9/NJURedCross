import { test, expect } from '@playwright/test';

async function mountTable(page, options = {}) {
  await page.route('**/table-state-fixture', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><body><main id="fixture"></main></body></html>',
  }));
  await page.goto('/table-state-fixture');

  await page.evaluate(async initial => {
    const { dataTable } = await import('/app/ui/table.js');
    window.tableStateEvents = [];

    const table = dataTable({
      columns: [
        { key: 'name', label: '名称' },
        { key: 'quantity', label: '数量' },
      ],
      rows: [
        { id: 'a', name: 'A4纸', quantity: 3 },
        { id: 'b', name: '草稿纸', quantity: 1 },
      ],
      initialQuery: initial.query || '',
      initialSort: initial.sort || null,
      onStateChange: state => window.tableStateEvents.push(state),
    });

    document.getElementById('fixture').append(table);
  }, options);
}

test('table restores search, row order and sort indicator', async ({ page }) => {
  await mountTable(page, {
    query: '纸',
    sort: { key: 'quantity', direction: 'desc' },
  });

  await expect(page.getByRole('searchbox')).toHaveValue('纸');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.locator('tbody tr').first()).toContainText('A4纸');
  await expect(page.locator('th[data-key="quantity"]'))
    .toHaveAttribute('aria-sort', 'descending');

  expect(await page.evaluate(() => window.tableStateEvents)).toEqual([]);
});

test('search, clearing and keyboard sorting emit the current state', async ({ page }) => {
  await mountTable(page);

  await page.getByRole('searchbox').fill('无此记录');
  await expect(page.getByText('没有匹配的记录', { exact: true })).toBeVisible();

  expect(await page.evaluate(() => window.tableStateEvents.at(-1))).toEqual({
    query: '无此记录',
    sort: null,
  });

  await page.getByRole('button', { name: '清空搜索', exact: true }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect(page.locator('tbody tr')).toHaveCount(2);

  expect(await page.evaluate(() => window.tableStateEvents.at(-1))).toEqual({
    query: '',
    sort: null,
  });

  const quantity = page.locator('th[data-key="quantity"]');
  await quantity.focus();
  await page.keyboard.press('Enter');

  await expect(quantity).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.locator('tbody tr').first()).toContainText('草稿纸');

  expect(await page.evaluate(() => window.tableStateEvents.at(-1))).toEqual({
    query: '',
    sort: { key: 'quantity', direction: 'asc' },
  });
});