import { test, expect } from '@playwright/test';

// 四个广场共用同一套主视觉组件：结构、轮播控件与可达性一致，只有文案与影像不同。
const PLAZAS = ['/events', '/outreach', '/community', '/materials'];
const HERO_OBJECT_POSITION = '50% 50%';

test('every plaza shares the same hero carousel shell', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-super' } });
  await page.route('**/api/public/warmth/capabilities', route => route.fulfill({ json: { birthday: { enabled: true, ready: true } } }));
  const firstImages = new Set();
  for (const path of PLAZAS) {
    await page.goto(path);
    const hero = page.locator('.plaza-hero');
    await expect(hero).toBeVisible();
    await expect(hero.locator('h1')).toBeVisible();
    await expect(hero.getByRole('button', { name: '下一张', exact: true })).toBeVisible();
    await expect(hero.getByRole('button', { name: '暂停轮播', exact: true })).toBeVisible();
    if (path === '/outreach') {
      await expect(page.locator('[data-art-scene="editorial"] .page-art__plane')).toBeHidden();
    }
    if (path === '/events') {
      await expect(page.locator('[data-art-scene="directory"] .page-art__plane')).toBeHidden();
    }
    await expect(hero.locator('.events-hero__art img').last()).toHaveCSS('object-fit', 'cover');
    await expect(hero.locator('.events-hero__art img').last()).toHaveCSS('object-position', HERO_OBJECT_POSITION);
    if (page.viewportSize().width > 900) {
      const geometry = await hero.evaluate(node => {
        const rect = selector => node.querySelector(selector).getBoundingClientRect();
        return {
          prevRight: rect('.events-hero__arrow--prev').right,
          artLeft: rect('.events-hero__art').left,
          artRight: rect('.events-hero__art').right,
          nextLeft: rect('.events-hero__arrow--next').left,
        };
      });
      expect(geometry.artLeft, path).toBeGreaterThan(geometry.prevRight);
      expect(geometry.artRight, path).toBeLessThan(geometry.nextLeft);
    }
    // 旧版页头不应与新主视觉并存。
    await expect(page.locator('.plaza-intro')).toHaveCount(0);
    const edge = await hero.locator('.events-hero__art').evaluate(node => {
      const style = getComputedStyle(node, '::after');
      return { background: style.backgroundImage, shadow: style.boxShadow };
    });
    expect(edge.background, path).toContain('linear-gradient');
    expect(edge.background, path).toMatch(/linear-gradient\(0deg/);
    expect(edge.background, path).toContain('3.5%');
    expect(edge.background, path).toContain('96.5%');
    expect(edge.background, path).toContain('2%');
    expect(edge.shadow, path).toBe('none');
    const heroScrim = await hero.evaluate(node => getComputedStyle(node, '::after').backgroundImage);
    expect(heroScrim, path).toContain('linear-gradient');
    expect(heroScrim, path).not.toMatch(/linear-gradient\(0deg/);
    const dots = hero.locator('.events-hero__dots button');
    // 各广场影像数量可以不同（活动广场 6 张、其余 3 张），只要求可轮播。
    await expect.poll(() => dots.count()).toBeGreaterThan(1);
    await expect(dots.nth(0)).toHaveAttribute('aria-current', 'true');
    await hero.getByRole('button', { name: '下一张', exact: true }).click();
    await expect(dots.nth(1)).toHaveAttribute('aria-current', 'true');
    await expect(hero.locator('.events-hero__art img[data-hero-entering]')).toHaveCount(1);
    await expect(hero.getByRole('status').filter({ hasText: '第 2 张' })).toBeAttached();
    // 交叉淡入期间新旧两帧短暂共存，取最后一帧（新图），并在过渡结束后核对只保留一帧。
    const alt = await hero.locator('.events-hero__art img').last().getAttribute('alt');
    expect(alt, path).toBeTruthy();
    await expect(hero.locator('.events-hero__art img').last()).toHaveCSS('object-fit', 'cover');
    await expect(hero.locator('.events-hero__art img').last()).toHaveCSS('object-position', HERO_OBJECT_POSITION);
    await expect.poll(() => hero.locator('.events-hero__art img').count()).toBe(1);
    if (path === '/materials') {
      await hero.getByRole('button', { name: '下一张', exact: true }).click();
      await expect(hero.locator('.events-hero__art img').last()).toHaveCSS('object-fit', 'cover');
      await expect(hero.locator('.events-hero__art img').last()).toHaveCSS('object-position', HERO_OBJECT_POSITION);
      await expect(hero.locator('.events-hero__art img').last()).toHaveAttribute('alt', /校红会文创周边/);
    }
    firstImages.add(alt);
  }
  // 每个广场首图不同，后续替换各自影像时也不会退回同一套。
  expect(firstImages.size).toBe(PLAZAS.length);
});

test('photo wall hangs the console photographs and its lightbox always closes', async ({ page }) => {
  await page.request.post('/api/auth/login', { data: { username: 'synthetic-super' } });
  // 总览页不再插主视觉，照片集中在独立模块。
  await page.goto('/console/overview');
  await expect(page.locator('.overview-hero')).toHaveCount(0);
  await page.goto('/console/gallery');
  const photos = page.locator('.gallery-photo');
  await expect(photos.first()).toBeVisible({ timeout: 20000 });
  expect(await photos.count()).toBeGreaterThanOrEqual(3);
  const first = photos.first();
  const image = first.locator('img');
  expect(await image.getAttribute('src')).toContain('/assets/volunteers/optimized/');
  // 相纸里的照片必须落在相纸内，且保持 3:2 —— 上一版就是照片撑破卡片铺满整页。
  const cardBox = await first.boundingBox();
  const imageBox = await image.boundingBox();
  expect(imageBox.width).toBeLessThanOrEqual(cardBox.width + 1);
  expect(imageBox.height).toBeLessThanOrEqual(cardBox.height + 1);
  expect(Math.abs(imageBox.width / imageBox.height - 1.5)).toBeLessThan(0.05);

  // 窗口很矮时放大预览：图片必须留在视口内，顶部关闭按钮不能被图片顶出屏幕。
  await page.setViewportSize({ width: 1080, height: 520 });
  const lightbox = page.locator('.lightbox');
  await first.click();
  await expect(lightbox).toBeVisible();
  const head = await page.locator('.lightbox__head').boundingBox();
  const preview = await page.locator('.lightbox__img').boundingBox();
  expect(head.y).toBeGreaterThanOrEqual(0);
  expect(preview.y).toBeGreaterThanOrEqual(head.y + head.height - 1);
  expect(preview.y + preview.height).toBeLessThanOrEqual(520);
  await page.locator('.lightbox__head').getByRole('button', { name: '关闭' }).click();
  await expect(lightbox).toHaveCount(0);
  // Esc 与点击图片外的空白同样能关。
  await first.click();
  await expect(lightbox).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(lightbox).toHaveCount(0);
  await first.click();
  await expect(lightbox).toBeVisible();
  await page.locator('.lightbox__figure').click({ position: { x: 6, y: 6 } });
  await expect(lightbox).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 720 });
  // 活动工作区顶部同样不再有横幅。
  await page.goto('/console/events');
  await expect(page.locator('.workspace-hero')).toHaveCount(0);
});
