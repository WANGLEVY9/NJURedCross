import { test, expect } from '@playwright/test';

async function mount(page) {
  await page.route('**/console-scroll-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><body>
        <div id="scroller"
          style="height:200px;width:400px;overflow:auto"
          tabindex="0">
          <div id="content" style="height:1200px">合成列表</div>
        </div>
        <script type="module">
          import { createScrollState } from '/app/console/scroll-state.js';
          window.scrollState = createScrollState();
          window.contextA = {
            path: '/console/materials',
            query: new URLSearchParams('inventoryQuery=合成甲'),
          };
          window.contextB = {
            path: '/console/materials',
            query: new URLSearchParams('inventoryQuery=合成乙'),
          };
          window.fixtureReady = true;
        </script>
      </body></html>`,
    }));

  await page.goto('/console-scroll-fixture');
  await expect.poll(() =>
    page.evaluate(() => window.fixtureReady === true)).toBe(true);
}

async function rememberAndReset(page, height = 1200) {
  await page.evaluate((height) => {
    const scroller = document.getElementById('scroller');
    scroller.scrollTop = 500;
    window.scrollState.remember(window.contextA, scroller);
    scroller.scrollTop = 0;
    document.getElementById('content').style.height = `${height}px`;
  }, height);
}

async function expectPosition(page, top) {
  await expect.poll(() =>
    page.locator('#scroller').evaluate((node) => node.scrollTop),
  ).toBe(top);
}

test('returning to the same list restores its position', async ({ page }) => {
  await mount(page);
  await rememberAndReset(page);
  await page.evaluate(() =>
    window.scrollState.restore(
      window.contextA,
      document.getElementById('scroller'),
    ));
  await expectPosition(page, 500);
});

test('restoration waits until asynchronous content can fit the saved position', async ({ page }) => {
  await mount(page);
  await rememberAndReset(page, 100);
  await page.evaluate(() =>
    window.scrollState.restore(
      window.contextA,
      document.getElementById('scroller'),
    ));
  await expectPosition(page, 0);

  await page.evaluate(() => {
    const content = document.getElementById('content');
    content.style.height = '1200px';
    content.append(document.createElement('span'));
  });
  await expectPosition(page, 500);
});

test('manual scrolling cancels pending restoration', async ({ page }) => {
  await mount(page);
  await rememberAndReset(page, 100);

  await page.evaluate(() => {
    const scroller = document.getElementById('scroller');
    window.scrollState.restore(window.contextA, scroller);
    scroller.dispatchEvent(new WheelEvent('wheel', {
      deltaY: 100,
      bubbles: true,
    }));
    const content = document.getElementById('content');
    content.style.height = '1200px';
    content.append(document.createElement('span'));
  });

  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expectPosition(page, 0);
});

test('different search states keep separate positions', async ({ page }) => {
  await mount(page);
  await rememberAndReset(page);
  await page.evaluate(() => {
    const scroller = document.getElementById('scroller');
    window.scrollState.restore(window.contextB, scroller);
  });
  await expectPosition(page, 0);

  await page.evaluate(() => {
    const scroller = document.getElementById('scroller');
    scroller.scrollTop = 100;
    window.scrollState.remember(window.contextB, scroller);
    scroller.scrollTop = 0;
    window.scrollState.restore(window.contextA, scroller);
  });
  await expectPosition(page, 500);
});

test('clearing account state removes positions and pending restoration', async ({ page }) => {
  await mount(page);
  await rememberAndReset(page, 100);
  await page.evaluate(() => {
    const scroller = document.getElementById('scroller');
    window.scrollState.restore(window.contextA, scroller);
    window.scrollState.clear();

    const content = document.getElementById('content');
    content.style.height = '1200px';
    content.append(document.createElement('span'));
    window.scrollState.restore(window.contextA, scroller);
  });

  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expectPosition(page, 0);
});