import { test, expect } from '@playwright/test';

function savedTask() {
  return {
    id: 'synthetic-handoff-task',
    mode: 'activity',
    steps: [{ id: 'configuration', status: 'confirmed' }],
    activityDraft: {
      name: '合成助手活动',
      category: '急救培训',
      center: '生命中心',
      region: '南京活动',
      date: '2026-11-01',
      startTime: '09:00',
      endTime: '11:30',
      location: '合成地点',
      position: '合成岗位',
      content: '合成活动内容',
      work: '合成工作内容',
      capacity: 20,
      registrationLimit: 30,
      trainingHours: 0,
      travelHours: 0,
    },
  };
}

async function mount(page, {
  denied = false,
  invalid = false,
  delayed = false,
  conversation = false,
} = {}) {
  const writes = [];
  let taskReads = 0;
  let release;
  const pending = new Promise(resolve => {
    release = resolve;
  });

  await page.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    // 性能上报单独模拟，不算业务写入，也不发送到真实服务。
    if (
      pathname === '/api/telemetry/client' &&
      request.method() === 'POST'
    ) {
      await route.fulfill({
        status: 200,
        json: { ok: true },
      });
      return;
    }

    // 其他写请求仍全部记录并阻止。
    if (!['GET', 'HEAD'].includes(request.method())) {
      writes.push(request.url());
    }

    await route.abort();
  });

  await page.route('**/api/auth/session', route => route.fulfill({
    json: {
      authenticated: true,
      csrfToken: 'synthetic-csrf',
      user: {
        username: 'synthetic-admin',
        accountId: 'synthetic-owner',
        label: '合成当前管理员',
        role: 'admin',
        consoleAccess: true,
        permissions: ['events'],
      },
    },
  }));

  await page.route(/\/api\/volunteer\/workflow(?:\/catalog)?$/, route => route.fulfill({
    json: {
      events: [],
      registrations: [],
      ledger: [],
      sources: [],
      sourceWarnings: [],
      lazyDetails: true,
    },
  }));

  await page.route('**/api/volunteer/workflow/approval-routing', route => route.fulfill({
    json: { categories: [], canConfigure: false },
  }));

  await page.route('**/api/volunteer/workflow/sources', route => route.fulfill({
    json: { sources: [] },
  }));

  await page.route('**/api/volunteer/workflow/directory*', route => route.fulfill({
    json: {
      administrators: [
        { id: 'synthetic-owner', name: '合成当前管理员' },
        { id: 'synthetic-helper', name: '合成补充负责人' },
      ],
      participants: [],
    },
  }));

  await page.route(
    '**/api/console/agent/tasks/synthetic-handoff-task',
    async route => {
      taskReads++;
      if (delayed) await pending;

      if (denied) {
        await route.fulfill({
          status: 403,
          json: { ok: false, message: '合成任务无查看权限' },
        });
        return;
      }

      const task = savedTask();

      if (conversation) {
        task.taskType = 'conversation';
        task.status = 'result_ready';
        delete task.steps;
      }

      if (invalid) task.activityDraft = null;

      await route.fulfill({ json: { ok: true, task } });
    },
  );

  await page.route('**/console/events*', route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html>
      <html data-surface="console" data-motion="reduced">
      <head><meta charset="utf-8">
        <link rel="stylesheet" href="/styles/tokens.css">
        <link rel="stylesheet" href="/styles/base.css">
        <link rel="stylesheet" href="/styles/components.css">
        <link rel="stylesheet" href="/styles/admin.css">
      </head>
      <body>
        <div id="root"></div>
        <div id="overlay-root"></div>
        <div id="toast-root"></div>
        <script type="module">
          import { refreshSession } from '/app/core/api.js';
          import activityCenter from '/app/console/pages/activity-center.js';
          await refreshSession();

          const context = {
            path: location.pathname,
            query: new URLSearchParams(location.search),
          };
          const view = await activityCenter(context, {});
          document.getElementById('root').append(view.node);
          window.fixtureView = view;
          window.fixtureReady = true;
        </script>
      </body></html>`,
  }));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/console/events?agentTask=synthetic-handoff-task');

  await expect.poll(() =>
    page.evaluate(() => window.fixtureReady === true),
  ).toBe(true);

  return {
    writes,
    release,
    taskReads: () => taskReads,
  };
}

test('saved agent configuration fills the real creation form without writing an event', async ({ page }) => {
  const fixture = await mount(page);

  const drawer = page.getByRole('dialog', {
    name: '新建活动',
    exact: true,
  });
  await expect(drawer).toBeVisible();

  for (const [name, value] of [
    ['name', '合成助手活动'],
    ['windowStart', '2026-11-01T09:00'],
    ['windowEnd', '2026-11-01T11:30'],
    ['location', '合成地点'],
    ['capacity', '20'],
    ['registrationLimit', '30'],
    ['content', '合成活动内容'],
    ['work', '合成工作内容'],
    ['trainingHours', '0'],
    ['travelHours', '0'],
    ['serviceHours', '2.5'],
  ]) {
    await expect(drawer.locator(`[name="${name}"]`)).toHaveValue(value);
  }


  await expect(drawer.locator('.activity-owner-fields .people-picker__token.is-fixed .people-picker__name')).toHaveText('合成当前管理员');

  await expect(drawer.locator('.people-picker__token').filter({hasText:'合成补充负责人'})).toHaveCount(0);

  expect(fixture.writes).toEqual([]);
  expect(fixture.taskReads()).toBe(1);
  expect(new URL(page.url()).searchParams.has('agentTask')).toBe(false);

  await drawer.getByRole('button', {
    name: '关闭',
    exact: true,
  }).click();

  await expect(drawer).toHaveCount(0);

  await page.getByRole('button', {
    name: '刷新',
    exact: true,
  }).click();

  await expect(drawer).toHaveCount(0);
  expect(fixture.taskReads()).toBe(1);
  expect(fixture.writes).toEqual([]);
});

for (const kind of ['denied', 'invalid']) {
  test(`${kind} agent targets warn without opening a creation form`, async ({ page }) => {
    const fixture = await mount(page, { [kind]: true });

    const message = kind === 'denied'
      ? '合成任务无查看权限'
      : '该任务尚无已保存、可带入的活动配置';

    await expect(page.getByText(message, { exact: true })).toBeVisible();

    await expect(page.getByRole('dialog', {
      name: '新建活动',
      exact: true,
    })).toHaveCount(0);

    expect(fixture.writes).toEqual([]);
  });
}

test('a delayed task response cannot open a drawer after the page is disposed', async ({ page }) => {
  const fixture = await mount(page, { delayed: true });

  try {
    await expect.poll(fixture.taskReads).toBe(1);

    await page.evaluate(() => {
      window.fixtureView.dispose();
      document.getElementById('root').replaceChildren();
    });

    const response = page.waitForResponse(response =>
      response.url().endsWith(
        '/api/console/agent/tasks/synthetic-handoff-task',
      ),
    );

    fixture.release();
    const completed = await response;
    await completed.finished();

    // 等待本次响应的页面处理完成。
    await page.evaluate(() => new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));

    await expect(page.getByRole('dialog', {
      name: '新建活动',
      exact: true,
    })).toHaveCount(0);

    expect(fixture.writes).toEqual([]);
  } finally {
    fixture.release();
  }
});

test('saved conversation drafts fill the creation form without business writes', async ({ page }) => {
  const fixture = await mount(page, { conversation: true });
  const drawer = page.getByRole('dialog', {
    name: '新建活动',
    exact: true,
  });

  await expect(drawer).toBeVisible();
  await expect(drawer.locator('[name="name"]'))
    .toHaveValue('合成助手活动');
  await expect(drawer.locator('[name="capacity"]'))
    .toHaveValue('20');
  await expect(drawer.locator('[name="location"]'))
    .toHaveValue('合成地点');

  expect(fixture.writes).toEqual([]);
  expect(fixture.taskReads()).toBe(1);
});

test('conversation results without a saved draft cannot enter the creation form', async ({ page }) => {
  const fixture = await mount(page, {
    conversation: true,
    invalid: true,
  });

  await expect(page.getByText(
    '该任务尚无已保存、可带入的活动配置',
    { exact: true },
  )).toBeVisible();

  await expect(page.getByRole('dialog', {
    name: '新建活动',
    exact: true,
  })).toHaveCount(0);

  expect(fixture.writes).toEqual([]);
});
