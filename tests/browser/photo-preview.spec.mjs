import { test, expect } from '@playwright/test';

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jU1sAAAAASUVORK5CYII=', 'base64');
const photos = Array.from({ length: 15 }, (_, i) => ({ id: `PHO-FIXTURE-${i}`, filename: `synthetic-${i}.jpg`,
  center: '生命中心', activity: 'synthetic-gallery', size: 10 * 1024 * 1024, keepStatus: '待定', pickStatus: '未申请' }));
const fixture = { ok: true, photos, folders: [{ key: 'fixture', folderName: 'synthetic-gallery', center: '生命中心', activity: 'synthetic-gallery', count: photos.length, photos }],
  config: { storageConfigured: false, centers: ['生命中心'] } };

async function setup(page, { media = null, preview = null } = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-reviewer' } });
  await page.route('**/api/public/media**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/activities')) return route.fulfill({ json: { activities: [], centers: ['生命中心'] } });
    if (path.endsWith('/picks')) return route.fulfill({ json: { picks: [] } });
    if (path.endsWith('/thumb')) return route.fulfill({ contentType: 'image/png', body: image });
    if (path.endsWith('/preview')) return preview ? preview(route) : route.fulfill({ contentType: 'image/png', body: image });
    return media ? media(route) : route.fulfill({ json: fixture });
  });
}

async function openFolder(page) {
  await page.goto('/photos');
  await page.getByRole('button', { name: /打开文件夹/ }).click();
  await expect.poll(() => page.locator('.photocard__img').first().evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
}

test('photo page mounts while metadata is pending and keeps a failed list visible for retry', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let reads = 0;
  await setup(page, { media: async route => {
    if (++reads === 1) { await gate; return route.fulfill({ status: 503, json: { ok: false } }); }
    return route.fulfill({ json: fixture });
  } });
  try {
    await page.goto('/photos');
    await expect(page.getByRole('heading', { name: '活动影像库' })).toBeVisible({ timeout: 1500 });
    await expect(page.getByText('正在加载照片列表…', { exact: true })).toBeVisible();
    release();
    await expect(page.getByText('照片列表加载失败，请重试。', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await expect(page.getByRole('button', { name: /打开文件夹/ })).toBeVisible();
  } finally { release(); }
});

test('preview immediately shows the thumbnail in a stable frame while full preview is pending', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const originalRequests = [];
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/link')) originalRequests.push(request.url()); });
  await setup(page, { preview: async route => { await gate; return route.fulfill({ contentType: 'image/png', body: image }); } });
  try {
    await openFolder(page);
    await page.locator('.photocard__thumb').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 500 });
    await expect(page.locator('.photo-lightbox__figure')).toHaveAttribute('aria-busy', 'true');
    const before = await page.locator('.photo-lightbox__figure').boundingBox();
    expect(before.width).toBeGreaterThan(250);
    expect(before.height).toBeGreaterThan(250);
    await expect.poll(() => dialog.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(page.locator('.photo-lightbox')).toHaveCSS('backdrop-filter', 'none');
    expect(originalRequests).toEqual([]);
    release();
    await expect(page.locator('.photo-lightbox__figure')).not.toHaveAttribute('aria-busy');
    await expect(dialog.locator('img')).toHaveAttribute('src', /^blob:/);
    const after = await page.locator('.photo-lightbox__figure').boundingBox();
    expect(Math.abs(before.height - after.height)).toBeLessThan(2);
    expect(Math.abs(before.width - after.width)).toBeLessThan(2);
    const bar = await page.locator('.photo-lightbox__bar').boundingBox();
    expect(after.y + after.height).toBeLessThanOrEqual(bar.y);
    expect(bar.y + bar.height).toBeLessThanOrEqual(page.viewportSize().height);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.photocard__thumb').first()).toBeFocused();
  } finally { release(); }
});

test('selection and clear selection preserve the grid, image nodes and checkbox focus', async ({ page }) => {
  await setup(page);
  await openFolder(page);
  await page.evaluate(() => {
    window.photoGrid = document.querySelector('.photogrid');
    window.photoImages = [...document.querySelectorAll('.photocard__img')];
  });
  const checkbox = page.locator('.photocard input').first();
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toBeFocused();
  await expect(page.getByText('已选 1 张', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清空选择', exact: true }).click();
  await expect(checkbox).not.toBeChecked();
  expect(await page.evaluate(() => window.photoGrid === document.querySelector('.photogrid') && window.photoImages.every(img => img.isConnected))).toBe(true);
});

test('failed preview retains the thumbnail and retries without navigating to the original', async ({ page }) => {
  let attempts = 0;
  await setup(page, { preview: route => ++attempts === 1
    ? route.fulfill({ status: 503, json: { ok: false } })
    : route.fulfill({ contentType: 'image/png', body: image }) });
  await openFolder(page);
  await page.locator('.photocard__thumb').first().click();
  await expect(page.getByRole('status').filter({ hasText: '高清预览暂时不可用' })).toBeVisible();
  await expect(page.locator('.photo-lightbox__img')).toHaveAttribute('src', /\/thumb$/);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.locator('.photo-lightbox__img')).toHaveAttribute('src', /^blob:/);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('preview timeout is reported separately and closing cancels a pending binary request', async ({ page }) => {
  await page.addInitScript(() => {
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = ms => timeout(ms === 12000 ? 150 : ms);
  });
  const telemetry = [];
  await page.route('**/api/telemetry/client', async route => {
    telemetry.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await setup(page, { preview: async route => { await gate; return route.fulfill({ contentType: 'image/png', body: image }); } });
  try {
    await openFolder(page);
    await page.locator('.photocard__thumb').first().click();
    await expect(page.getByRole('status').filter({ hasText: '高清预览加载超时' })).toBeVisible();
    await expect.poll(() => telemetry.some(record => record.phase === 'binary' && record.outcome === 'timeout')).toBe(true);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.locator('.photocard__thumb').first().click();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await expect.poll(() => telemetry.some(record => record.phase === 'binary' && record.outcome === 'aborted')).toBe(true);
    release();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(JSON.stringify(telemetry)).not.toContain('PHO-FIXTURE');
    expect(JSON.stringify(telemetry)).not.toContain('synthetic-0.jpg');
  } finally { release(); }
});
