import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const materialSource = await readFile(
  new URL('../../public/app/console/pages/materials.js', import.meta.url),
  'utf8',
);

async function mountTransaction(page, responseStatus) {
  const requests = [];

  // Block every API call unless explicitly replaced below.
  await page.route('**/api/**', route => route.abort());

  await page.route('**/api/materials/transactions', async route => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: responseStatus,
      json: responseStatus === 200
        ? { ok: true, duplicate: false }
        : { code: 'synthetic_failure', message: '合成接口失败' },
    });
  });

  // Expose the existing function only in the intercepted test module.
  await page.route('**/app/console/pages/materials.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `${materialSource}\nexport { openTransactionDrawer, openRejectDrawer, openFulfilmentDrawer };\n`,
  }));

  await page.route('**/material-draft-fixture', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><body>
      <div id="root"><button>打开库存表单</button></div>
      <div id="overlay-root"></div>
      <div id="toast-root"></div>
    </body></html>`,
  }));

  await page.goto('/material-draft-fixture');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.evaluate(async () => {
    const { openTransactionDrawer } =
      await import('/app/console/pages/materials.js');

    window.refreshCalls = 0;
    openTransactionDrawer({
      id: 'synthetic-asset',
      code: 'NJU-SYNTHETIC',
      name: '合成测试物资',
      center: '合成中心',
      cabinet: 'A',
      level: '1',
      quantity: 10,
      initial: 10,
      threshold: 1,
      unit: '件',
    }, {
      defaultOperation: '入库',
      onDone: () => { window.refreshCalls++; },
    });
  });

  return requests;
}

async function submitTransaction(page) {
  await page.getByRole('spinbutton', { name: '数量必填', exact: true }).fill('2');
  await page.getByLabel('核查说明', { exact: true }).fill('合成测试备注');
  await page.getByRole('button', { name: '预览并确认写入', exact: true }).click();
  await page.getByRole('button', { name: '确认入库', exact: true }).click();
}

test('failed transaction preserves input and unsaved protection', async ({ page }) => {
  const requests = await mountTransaction(page, 500);
  await submitTransaction(page);

  await expect.poll(() => requests.length).toBe(1);
  await expect(page.getByRole('button', {
    name: '预览并确认写入',
    exact: true,
  })).toBeEnabled();

  await expect(page.getByRole('spinbutton', { name: '数量必填', exact: true })).toHaveValue('2');
  await expect(page.getByLabel('核查说明', { exact: true }))
    .toHaveValue('合成测试备注');
  expect(await page.evaluate(() => window.refreshCalls)).toBe(0);

  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog', {
    name: '放弃未保存的修改？',
    exact: true,
  })).toBeVisible();
});

test('successful transaction releases protection and closes normally', async ({ page }) => {
  const requests = await mountTransaction(page, 200);
  await submitTransaction(page);

  await expect(page.getByText('入库已写入物资流水', { exact: true }))
    .toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].quantity).toBe(2);
  expect(requests[0].note).toBe('合成测试备注');
  expect(await page.evaluate(() => window.refreshCalls)).toBe(1);

  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('failed rejection keeps the reason and unsaved warning', async ({ page }) => {
  await mountTransaction(page, 500);

  await page.evaluate(async () => {
    const { openRejectDrawer } =
      await import('/app/console/pages/materials.js');

    openRejectDrawer({
      id: 'synthetic-application',
      purpose: '合成借用用途',
      applicant: '合成申请人',
      items: '合成物资',
    }, {
      onDone: () => { window.refreshCalls++; },
    });
  });

  const rejection = page.getByRole('dialog').last();
  await rejection.getByRole('textbox', {
    name: '不通过理由必填',
    exact: true,
  }).fill('合成驳回理由');

  // The fixture blocks all other API calls; no real rejection is sent.
  await rejection.getByRole('button', {
    name: '确认不通过',
    exact: true,
  }).click();

  await expect(rejection.getByRole('button', {
    name: '确认不通过',
    exact: true,
  })).toBeEnabled();

  await expect(rejection.getByRole('textbox', {
    name: '不通过理由必填',
    exact: true,
  })).toHaveValue('合成驳回理由');

  expect(await page.evaluate(() => window.refreshCalls)).toBe(0);

  await rejection.getByRole('button', {
    name: '关闭',
    exact: true,
  }).click();

  await expect(page.getByRole('dialog', {
    name: '放弃未保存的修改？',
    exact: true,
  })).toBeVisible();
});

async function mountFulfilment(page, mode, status) {
  await mountTransaction(page, 500);

  // Close the unchanged inventory drawer created by the shared fixture.
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const requests = [];
  await page.route(
    '**/api/materials/applications/synthetic-application/*',
    async route => {
      requests.push({
        url: route.request().url(),
        body: route.request().postData(),
      });
      await route.fulfill({
        status,
        json: status === 200
          ? { ok: true, duplicate: false }
          : { code: 'synthetic_failure', message: '合成接口失败' },
      });
    },
  );

  await page.evaluate(async selectedMode => {
    const { openFulfilmentDrawer } =
      await import('/app/console/pages/materials.js');

    openFulfilmentDrawer({
      id: 'synthetic-application',
      code: 'REQ-SYNTHETIC',
      purpose: '合成借用用途',
      applicant: '合成申请人',
      items: '合成物资',
      quantity: 2,
    }, [{
      code: 'NJU-SYNTHETIC',
      name: '合成物资',
      quantity: 10,
      unit: '件',
    }], {
      mode: selectedMode,
      onDone: () => { window.refreshCalls++; },
    });
  }, mode);

  await page.locator('select[name="assetCode"]')
    .selectOption('NJU-SYNTHETIC', { force: true });

  await page.getByRole('textbox', {
    name: mode === 'checkout' ? '出库备注' : '归还核查说明',
    exact: true,
  }).fill('合成交接备注');

  await page.locator('input[type="file"]').setInputFiles({
    name: 'synthetic.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
      'base64',
    ),
  });

  return requests;
}

for (const mode of ['checkout', 'return']) {
  const label = mode === 'checkout' ? '出库' : '归还';

  test(`${label} failure preserves fields and selected photo`, async ({ page }) => {
    const requests = await mountFulfilment(page, mode, 500);
    const submit = page.getByRole('button', {
      name: `确认${label}`,
      exact: true,
    });
    await submit.click();

    await expect.poll(() => requests.length).toBe(1);
    await expect(submit).toBeEnabled();

    await expect(page.getByRole('textbox', {
      name: mode === 'checkout' ? '出库备注' : '归还核查说明',
      exact: true,
    })).toHaveValue('合成交接备注');

    await expect(page.locator('select[name="assetCode"]'))
      .toHaveValue('NJU-SYNTHETIC');

    expect(await page.locator('input[type="file"]').evaluate(
      input => input.files[0]?.name,
    )).toBe('synthetic.png');

    expect(await page.evaluate(() => window.refreshCalls)).toBe(0);

    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.getByRole('dialog', {
      name: '放弃未保存的修改？',
      exact: true,
    })).toBeVisible();
  });

  test(`${label} success releases protection and closes normally`, async ({ page }) => {
    const requests = await mountFulfilment(page, mode, 200);
    await page.getByRole('button', {
      name: `确认${label}`,
      exact: true,
    }).click();

    await expect(page.getByText(`${label}已写入流水`, {
      exact: true,
    })).toBeVisible();

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain(
      `/synthetic-application/${mode}`,
    );
    expect(requests[0].body).toContain('synthetic.png');
    expect(await page.evaluate(() => window.refreshCalls)).toBe(1);

    await page.getByRole('button', { name: '完成', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}