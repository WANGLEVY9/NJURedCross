/** Capture README screenshots from the synthetic preview server (no production data). */
import { chromium, devices } from 'playwright';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const baseUrl = process.env.SCREENSHOT_BASE_URL || 'http://127.0.0.1:3121';
const outputDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'assets');
const settleMs = Number(process.env.SCREENSHOT_SETTLE_MS) || 1500;
const desktopViewport = { width: Number(process.env.SCREENSHOT_WIDTH) || 1440, height: Number(process.env.SCREENSHOT_HEIGHT) || 900 };
const mobileViewport = { width: 390, height: 844 };

/** 每个条目对应 README 中的一张界面图；等待选择器仅用于稳定渲染，不影响页面行为。 */
const desktop = [
  { file: 'home-preview.png', path: '/', waitFor: '.hero, main' },
  { file: 'events-preview.png', path: '/events', waitFor: 'main' },
  { file: 'calendar-preview.png', path: '/workflow-events?type=blood', waitFor: 'main' },
  { file: 'outreach-preview.png', path: '/outreach', waitFor: 'main' },
  { file: 'community-preview.png', path: '/community', waitFor: 'main' },
  { file: 'materials-preview.png', path: '/materials', waitFor: 'main' },
  { file: 'member-preview.png', path: '/me', waitFor: 'main' },
  { file: 'console-overview-preview.png', path: '/console/overview', waitFor: 'main' },
  { file: 'console-events-preview.png', path: '/console/events', waitFor: 'main' },
  { file: 'console-materials-preview.png', path: '/console/materials', waitFor: 'main' },
  { file: 'console-community-preview.png', path: '/console/community', waitFor: 'main' },
  { file: 'console-messages-preview.png', path: '/console/messages', waitFor: 'main' },
  { file: 'console-admin-preview.png', path: '/console/admin', waitFor: 'main' },
];

const mobile = [
  { file: 'mobile-home-preview.png', path: '/', waitFor: 'main' },
  { file: 'mobile-events-preview.png', path: '/events', waitFor: 'main' },
];

async function capture(context, item, viewport) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  // 暂停轮播与动效，保证截图内容稳定可读。
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${baseUrl}${item.path}`, { waitUntil: 'domcontentloaded' });
  for (const selector of String(item.waitFor || 'main').split(',')) {
    await page.waitForSelector(selector.trim(), { timeout: 15_000 }).catch(() => {});
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(settleMs);
  const raw = join(outputDir, `.raw-${item.file}`);
  await page.screenshot({ path: raw, type: 'png' });
  await page.close();
  const target = join(outputDir, item.file);
  await sharp(raw)
    .resize({ width: Math.min(viewport.width, 1280), withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile(target);
  const { size } = await stat(target);
  console.log(`${item.file}  ${viewport.width}x${viewport.height}  ${Math.round(size / 1024)} KB  ${item.path}`);
}

const browser = await chromium.launch();
try {
  await mkdir(outputDir, { recursive: true });
  const desktopContext = await browser.newContext({ viewport: desktopViewport, deviceScaleFactor: 1 });
  for (const item of desktop) await capture(desktopContext, item, desktopViewport);
  await desktopContext.close();

  const mobileContext = await browser.newContext({ ...devices['Pixel 7'] });
  for (const item of mobile) await capture(mobileContext, item, mobileViewport);
  await mobileContext.close();
} finally {
  await browser.close();
}

console.log(`Screenshots captured from ${baseUrl}. Start the server with: npm run preview:workflow`);
