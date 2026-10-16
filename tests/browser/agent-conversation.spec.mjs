import { test, expect } from '@playwright/test';
import { agentRoutes } from '../../lib/agent/api.js';
import { createAgentTaskService } from '../../lib/agent/task-service.js';
import { createMockAgentModel } from '../../lib/agent/mock-model.js';
import { AgentModelError } from '../../lib/agent/compatible-model.js';

async function mount(page, {
  failFirstResult = false,
  failFirstRevision = false,
  failWritingSave = false,
} = {}) {
  const mock = createMockAgentModel();
  let resultFailed = false;
  let revisionFailed = false;
  let count = 0;
  const writes = [];
  const errors = [];

  page.on('pageerror', error => errors.push(error.message));

  const service = createAgentTaskService({
    idFactory: () => `synthetic-conversation-${++count}`,
    model: {
      provider: 'mock',
      async generate(options) {
        if (
          failFirstResult &&
          !resultFailed &&
          options.task.status === 'ready'
        ) {
          resultFailed = true;
          throw new AgentModelError(
            502,
            'synthetic_result_failure',
            '合成完整方案生成失败',
          );
        }

        if (
          failFirstRevision &&
          !revisionFailed &&
          options.task.status === 'result_ready'
        ) {
          revisionFailed = true;
          throw new AgentModelError(
            502,
            'synthetic_revision_failure',
            '合成修改失败',
          );
        }

        return mock.generate(options);
      },
    },
    readBusinessContext: async () => ({
      queries: ['急救'],
      checkedAt: '2026-10-14T00:00:00Z',
      items: [{
        id: 'event:synthetic-reference',
        title: '合成历史急救活动',
        detail: '合成地点 · 已归档',
        scope: 'events',
        source: '活动记录',
        view: 'activities',
        target: {
          kind: 'event',
          id: 'synthetic-reference',
        },
      }],
      unavailable: [],
      truncated: true,
    }),
  });

  await page.route('**/api/**', route => route.abort());

  await page.route('**/api/auth/session', route => route.fulfill({
    json: {
      authenticated: true,
      csrfToken: 'synthetic-csrf',
      user: {
        username: 'synthetic-admin',
        consoleAccess: true,
        permissions: ['events', 'outreach'],
      },
    },
  }));

  await page.route('**/api/console/agent/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = method === 'GET' ? undefined : request.postDataJSON();

    if (method !== 'GET') {
      writes.push({ path: url.pathname, body });
    }

    if (failWritingSave && url.pathname.endsWith('/writing-draft')) {
      await route.fulfill({
        status: 500,
        json: { ok: false, message: '合成推文保存失败' },
      });
      return;
    }

    let response;
    await agentRoutes({ method, body }, {}, url, {
      service,
      requireConsoleAccess: () => ({ username: 'synthetic-admin' }),
      requireCsrf: () => true,
      getPermissions: () => ['events', 'outreach'],
      readJson: async req => req.body,
      json(_res, status, payload) {
        response = { status, json: payload };
      },
    });

    await route.fulfill(response);
  });

  await page.route('**/agent-conversation-fixture*', route =>
    route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html>
        <html data-surface="console" data-motion="reduced">
        <head>
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
            import agentPage from '/app/console/pages/agent.js';
            await refreshSession();
            const view = await agentPage();
            document.getElementById('root').append(view.node);
            window.fixtureReady = true;
          </script>
        </body></html>`,
    }),
  );

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/agent-conversation-fixture');
  await expect.poll(() =>
    page.evaluate(() => window.fixtureReady === true),
  ).toBe(true);

  return { writes, errors };
}

async function start(page) {
  await expect(page.getByRole('button', {
    name: '创建任务',
    exact: true,
  })).toBeEnabled();

  await page.getByLabel('任务需求', { exact: true })
    .fill('合成急救课堂，预计20人，时间地点未定');

  await page.getByRole('button', {
    name: '创建任务',
    exact: true,
  }).click();

  await expect(page.getByRole('button', {
    name: '确认并生成',
    exact: true,
  })).toBeVisible();
}

async function confirm(page) {
  await page.getByLabel('需求：活动名称', { exact: true })
    .fill('合成急救课堂');
  await page.getByLabel('需求：推荐录取名额', { exact: true })
    .fill('20');

  await page.getByRole('button', {
    name: '确认并生成',
    exact: true,
  }).click();
}

function result(page) {
  return page.getByRole('heading', {
    name: '模拟活动筹备方案',
    exact: true,
  });
}

test('one confirmation generates a full result with one persistent input', async ({ page }) => {
  const f = await mount(page);
  await start(page);
  await confirm(page);

  await expect(result(page)).toBeVisible();
  await expect(page.getByLabel('任务需求', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', {
    name: '确认本步',
    exact: true,
  })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  expect(f.writes.filter(item =>
    item.path.endsWith('/conversation-confirm'),
  )).toHaveLength(1);
  expect(f.writes.filter(item =>
    item.path.endsWith('/conversation-generate'),
  )).toHaveLength(2);
  expect(f.errors).toEqual([]);
});

test('failed revisions preserve input and retry without another confirmation', async ({ page }) => {
  const f = await mount(page, { failFirstRevision: true });
  await start(page);
  await confirm(page);
  await expect(result(page)).toBeVisible();

  const input = page.getByLabel('任务需求', { exact: true });
  await input.fill('增加课堂互动建议');
  await page.getByRole('button', { name: '发送', exact: true }).click();

  await expect(page.getByRole('status', {
    name: '任务操作状态',
    exact: true,
  })).toContainText('合成修改失败');
  await expect(input).toHaveValue('增加课堂互动建议');

  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(input).toHaveValue('');

  expect(f.writes.filter(item =>
    item.path.endsWith('/conversation-confirm'),
  )).toHaveLength(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('failed first results retain confirmed requirements and permit generation retry', async ({ page }) => {
  const f = await mount(page, { failFirstResult: true });
  await start(page);
  await confirm(page);

  await expect(page.getByRole('status', {
    name: '任务操作状态',
    exact: true,
  })).toContainText('合成完整方案生成失败');

  await page.getByRole('button', {
    name: '生成完整方案',
    exact: true,
  }).click();

  await expect(result(page)).toBeVisible();
  expect(f.writes.filter(item =>
    item.path.endsWith('/conversation-confirm'),
  )).toHaveLength(1);
});

test('reload restores the conversation without generating again', async ({ page }) => {
  const f = await mount(page);
  await start(page);
  await confirm(page);
  await expect(result(page)).toBeVisible();

  const before = f.writes.length;
  await page.reload();

  await expect(result(page)).toBeVisible();
  await expect(page.getByRole('button', {
    name: '发送',
    exact: true,
  })).toBeVisible();
  expect(f.writes).toHaveLength(before);
});

test('reference records show their source and incomplete coverage', async ({ page }) => {
  await mount(page);
  await start(page);

  await page.locator('summary').filter({
    hasText: '系统参考信息',
  }).click();

  await expect(page.getByText('合成历史急救活动', {
    exact: true,
  })).toBeVisible();
  await expect(page.getByText('来源：活动记录', {
    exact: true,
  })).toBeVisible();
  await expect(page.getByText('当前查询覆盖不完整。', {
    exact: true,
  })).toBeVisible();
});

async function writingResult(page) {
  await page.getByRole('combobox', {
    name: '助手类型',
    exact: true,
  }).click();
  await page.getByRole('option', {
    name: '推文创作',
    exact: true,
  }).click();

  await start(page);
  await page.getByRole('button', {
    name: '确认并生成',
    exact: true,
  }).click();

  await expect(page.getByRole('heading', {
    name: '模拟推文方案',
    exact: true,
  })).toBeVisible();

  await page.locator('summary').filter({
    hasText: '编辑推文草稿（可选）',
  }).click();

  await page.getByLabel('推文：推文标题', { exact: true })
    .fill('合成推文标题');
  await page.getByLabel('推文：推文正文', { exact: true })
    .fill('合成推文正文');
}

test('saving a conversation draft preserves unsent chat input', async ({ page }) => {
  await mount(page);
  await writingResult(page);

  const input = page.getByLabel('任务需求', { exact: true });
  await input.fill('这条修改意见暂不发送');

  await page.getByRole('button', {
    name: '预览推文正文',
    exact: true,
  }).click();
  await page.getByRole('button', {
    name: '保存推文草稿',
    exact: true,
  }).click();

  await expect(page.getByRole('button', {
    name: '复制已保存正文',
    exact: true,
  })).toBeEnabled();

  await expect(input).toHaveValue('这条修改意见暂不发送');
});

test('failed draft saves preserve edited fields and chat input', async ({ page }) => {
  await mount(page, { failWritingSave: true });
  await writingResult(page);

  const input = page.getByLabel('任务需求', { exact: true });
  await input.fill('尚未发送的修改意见');

  await page.getByRole('button', {
    name: '预览推文正文',
    exact: true,
  }).click();
  await page.getByRole('button', {
    name: '保存推文草稿',
    exact: true,
  }).click();

  await expect(page.getByRole('status', {
    name: '任务操作状态',
    exact: true,
  })).toContainText('合成推文保存失败');

  await expect(page.getByLabel('推文：推文标题', {
    exact: true,
  })).toHaveValue('合成推文标题');
  await expect(page.getByLabel('推文：推文正文', {
    exact: true,
  })).toHaveValue('合成推文正文');
  await expect(input).toHaveValue('尚未发送的修改意见');
});