import { test, expect } from '@playwright/test';
import { stat } from 'node:fs/promises';

const IMAGES = ['location-reference', 'training-reference', 'checkin-reference'];

test('participation guide prefers compact WebP variants and keeps PNG fallback', async ({ page }) => {
  for (const name of IMAGES) {
    const [png, webp] = await Promise.all([
      stat(new URL(`../../public/assets/blood-guide/${name}.png`, import.meta.url)),
      stat(new URL(`../../public/assets/blood-guide/${name}.webp`, import.meta.url)),
    ]);
    expect(webp.size, name).toBeLessThan(png.size / 3);
    const response = await page.request.get(`/assets/blood-guide/${name}.webp`);
    expect(response.status(), name).toBe(200);
    expect(response.headers()['content-type'], name).toMatch(/image\/webp/);
  }

  await page.goto('/');
  const rendered = await page.evaluate(async () => {
    const module = await import('/app/portal/participation-guide.js');
    const node = module.bloodGuidePreview({
      location: '点位说明', locationImage: '/assets/blood-guide/location-reference.png',
      training: '培训说明', trainingImage: '/assets/blood-guide/training-reference.png',
      checkin: '签到说明', checkinImage: '/assets/blood-guide/checkin-reference.png',
      hours: '时长说明',
    });
    return {
      sources: [...node.querySelectorAll('picture source[type="image/webp"]')].map(source => source.getAttribute('srcset')),
      fallbacks: node.querySelectorAll('picture img[src$=".png"]').length,
    };
  });
  expect(rendered.sources.slice().sort()).toEqual(IMAGES.map(name => `/assets/blood-guide/${name}.webp`).sort());
  expect(rendered.fallbacks).toBe(IMAGES.length);
});
