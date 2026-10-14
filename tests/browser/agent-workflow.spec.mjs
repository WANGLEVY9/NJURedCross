import { test, expect } from '@playwright/test';
import { createAgentTaskService } from '../../lib/agent/task-service.js';
import { createMockAgentModel } from '../../lib/agent/mock-model.js';
import { agentRoutes } from '../../lib/agent/api.js';

async function mount(page, {
  failRevision = false,
  failDeletion = false,
  failActivityDraft = false,
  failWritingDraft = false,
  failDesignDraft = false,
  modelProvider = 'mock',
  failModelStatus = false,
  failDraftRevision = false,
} = {}) {
  let taskCount = 0;
  const syntheticModel = createMockAgentModel();
  syntheticModel.provider = modelProvider;

  const service = createAgentTaskService({
    model: syntheticModel,
    idFactory: () => {
      taskCount++;
      return taskCount === 1
        ? 'synthetic-agent-task'
        : `synthetic-agent-task-${taskCount}`;
    },
  });

  const writes = [];

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
    // 本文件继续验证旧版分步任务；新对话流程由独立测试覆盖。
    if (
      method === 'POST' &&
      url.pathname === '/api/console/agent/tasks'
    ) {
      body.taskType = 'workflow';
    }

    if (method !== 'GET') {
      writes.push({ path: url.pathname, body });
    }

    if (failDraftRevision && url.pathname.endsWith('/revise-draft')) {
      await route.fulfill({
        status: 500,
        json: { ok: false, message: '合成修改建议失败' },
      });
      return;
    }

    if (failModelStatus && url.pathname.endsWith('/status')) {
      await route.fulfill({
        status: 500,
        json: { ok: false, message: '合成模型状态读取失败' },
      });
      return;
    }

    if (failDesignDraft && url.pathname.endsWith('/design-draft')) {
      await route.fulfill({
        status: 500,
        json: { ok: false, message: '合成美编保存失败' },
      });
      return;
    }

    if (failWritingDraft && url.pathname.endsWith('/writing-draft')) {
      await route.fulfill({
        status: 500,
        json: { ok: false, message: '合成推文保存失败' },
      });
      return;
    }

    if (failActivityDraft && url.pathname.endsWith('/activity-draft')) {
      await route.fulfill({
        status: 500,
        json: { ok: false, message: '合成配置保存失败' },
      });
      return;
    }

    if (failDeletion && url.pathname.endsWith('/delete')) {
      await route.fulfill({
        status: 500,
        json: { ok: false, message: '合成删除失败' },
      });
      return;
    }

    if (failRevision && url.pathname.endsWith('/revise')) {
      await route.fulfill({
        status: 500,
        json: { ok: false, message: '合成保存失败' },
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
      json: (_res, status, payload) => {
        response = { status, json: payload };
      },
    });

    await route.fulfill(response);
  });

  await page.route('**/agent-workflow-fixture*', route => route.fulfill({
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
          window.fixtureView = view;
          document.getElementById('root').append(view.node);
          window.fixtureReady = true;
        </script>
      </body></html>`,
  }));

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/agent-workflow-fixture');
  await expect.poll(() =>
    page.evaluate(() => window.fixtureReady === true),
  ).toBe(true);

  return writes;
}

async function createAndGenerate(page) {
  await page.getByLabel('任务需求', { exact: true })
    .fill('合成急救知识活动，预计 30 人参加');

  await page.getByRole('button', {
    name: '创建任务',
    exact: true,
  }).click();

  await page.getByRole('button', {
    name: '生成方案',
    exact: true,
  }).click();

  await expect(page.getByLabel('结果标题', { exact: true }))
    .toBeVisible();
}

test('editing requires saving before confirmation advances the step', async ({ page }) => {
  const writes = await mount(page);
  await createAndGenerate(page);

  await page.getByLabel('结果标题', { exact: true })
    .fill('人工核对后的需求');

  await page.getByRole('button', {
    name: '确认本步',
    exact: true,
  }).click();

  await expect(page.getByRole('status', { name: '任务操作状态', exact: true }))
    .toContainText('请先点击“保存编辑”');

  expect(writes.filter(item => item.path.endsWith('/confirm')))
    .toHaveLength(0);

  await page.getByRole('button', {
    name: '保存编辑',
    exact: true,
  }).click();

  await expect(page.getByLabel('结果标题', { exact: true }))
    .toHaveValue('人工核对后的需求');

  await page.getByRole('button', {
    name: '确认本步',
    exact: true,
  }).click();

  await expect(page.getByRole('heading', {
    name: '策划与分工',
    exact: true,
  })).toBeVisible();

  await expect(page.getByLabel('结果标题', { exact: true }))
    .toHaveCount(0);

  await page.getByText('明确活动需求', { exact: true }).click();
  await expect(page.getByRole('heading', {
    name: '人工核对后的需求',
    exact: true,
  })).toBeVisible();
});

test('failed saves preserve edited content and block confirmation', async ({ page }) => {
  const writes = await mount(page, { failRevision: true });
  await createAndGenerate(page);

  await page.getByLabel('结果标题', { exact: true })
    .fill('尚未保存的标题');

  await page.getByRole('button', {
    name: '保存编辑',
    exact: true,
  }).click();

  await expect(page.getByRole('status', { name: '任务操作状态', exact: true }))
    .toContainText('合成保存失败');

  await expect(page.getByLabel('结果标题', { exact: true }))
    .toHaveValue('尚未保存的标题');

  await page.getByRole('button', {
    name: '确认本步',
    exact: true,
  }).click();

  expect(writes.filter(item => item.path.endsWith('/confirm')))
    .toHaveLength(0);
});

test('reloading the task address restores its saved result', async ({ page }) => {
  await mount(page);
  await createAndGenerate(page);

  const title = await page.getByLabel('结果标题', { exact: true })
    .inputValue();

  await expect(page).toHaveURL(/task=synthetic-agent-task/);
  await page.reload();

  await expect(page.getByLabel('结果标题', { exact: true }))
    .toHaveValue(title);

  await expect(page.getByRole('button', {
    name: '确认本步',
    exact: true,
  })).toBeVisible();
});

async function connectFixtureRouter(page) {
  await page.evaluate(async () => {
    const { defineRoutes, mountRouter, navigate } =
      await import('/app/core/router.js');

    defineRoutes([
      { path: '/agent-workflow-fixture', handler: { fixture: 'agent' } },
      { path: '/agent-destination', handler: { fixture: 'destination' } },
    ]);

    await mountRouter({
      target: document.getElementById('root'),
      render: async ({ handler }) => {
        if (handler.fixture !== 'destination') return;

        window.fixtureView.dispose();

        const heading = document.createElement('h1');
        heading.textContent = '合成目标页面';
        document.getElementById('root').replaceChildren(heading);
      },
    });

    window.navigateFixture = () => navigate('/agent-destination');
  });
}

test('cancelling navigation preserves edits and later discarding permits leaving', async ({ page }) => {
  await mount(page);
  await createAndGenerate(page);
  await connectFixtureRouter(page);

  await page.getByLabel('结果标题', { exact: true })
    .fill('正在编辑的标题');

  await page.evaluate(() => {
    void window.navigateFixture();
  });

  const dialog = page.getByRole('dialog', {
    name: '离开并放弃未保存的内容？',
    exact: true,
  });

  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', {
    name: '继续编辑',
    exact: true,
  }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('结果标题', { exact: true }))
    .toHaveValue('正在编辑的标题');
  await expect(page).toHaveURL(/agent-workflow-fixture/);

  await page.evaluate(() => {
    void window.navigateFixture();
  });

  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', {
    name: '放弃并离开',
    exact: true,
  }).click();

  await expect(page.getByRole('heading', {
    name: '合成目标页面',
    exact: true,
  })).toBeVisible();

  await expect(page).toHaveURL(/agent-destination$/);
});

test('saved results allow navigation without a discard warning', async ({ page }) => {
  await mount(page);
  await createAndGenerate(page);
  await connectFixtureRouter(page);

  await page.evaluate(() => {
    void window.navigateFixture();
  });

  await expect(page.getByRole('heading', {
    name: '合成目标页面',
    exact: true,
  })).toBeVisible();

  await expect(page.getByRole('dialog', {
    name: '离开并放弃未保存的内容？',
    exact: true,
  })).toHaveCount(0);
});

test('cancelling browser back restores the task address and edited content', async ({ page }) => {
  await mount(page);
  await createAndGenerate(page);

  await page.evaluate(() => {
    history.replaceState(null, '', '/agent-destination');
    history.pushState(
      null,
      '',
      '/agent-workflow-fixture?task=synthetic-agent-task',
    );
  });

  await connectFixtureRouter(page);

  await page.getByLabel('结果标题', { exact: true })
    .fill('后退前的编辑');

  await page.evaluate(() => history.back());

  const dialog = page.getByRole('dialog', {
    name: '离开并放弃未保存的内容？',
    exact: true,
  });

  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', {
    name: '继续编辑',
    exact: true,
  }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(
    /agent-workflow-fixture\?task=synthetic-agent-task$/,
  );
  await expect(page.getByLabel('结果标题', { exact: true }))
    .toHaveValue('后退前的编辑');
});

test('pending generation blocks navigation and duplicate submissions', async ({ page }) => {
  const writes = await mount(page);

  await page.getByLabel('任务需求', { exact: true })
    .fill('合成活动筹备需求');

  await page.getByRole('button', {
    name: '创建任务',
    exact: true,
  }).click();

  await expect(page.getByRole('button', {
    name: '生成方案',
    exact: true,
  })).toBeVisible();

  await connectFixtureRouter(page);

  let generationRequests = 0;
  let releaseGeneration;
  const pendingGeneration = new Promise(resolve => {
    releaseGeneration = resolve;
  });

  await page.route('**/api/console/agent/tasks/*/generate', async route => {
    generationRequests++;
    await pendingGeneration;
    await route.fallback();
  });

  try {
    await page.getByRole('button', {
      name: '生成方案',
      exact: true,
    }).click();

    await expect.poll(() => generationRequests).toBe(1);

    await expect(page.getByRole('button', {
      name: '创建任务',
      exact: true,
    })).toBeDisabled();

    await expect(page.getByLabel('任务需求', { exact: true }))
      .toBeDisabled();

    await expect.poll(() => page.evaluate(() => {
      const input = document.querySelector(
        '[name="agent-instruction"]',
      );
      return Boolean(input?.closest('[inert]'));
    })).toBe(true);

    // 主动触发事件，验证忙碌状态下的逻辑保护。
    await page.getByRole('button', {
      name: '生成方案',
      exact: true,
    }).dispatchEvent('click');

    await page.evaluate(() => window.navigateFixture());

    await expect(page.getByRole('status', { name: '任务操作状态', exact: true }))
      .toContainText('任务正在处理，请完成后再离开');

    await expect(page).toHaveURL(/agent-workflow-fixture/);
    await expect(page.getByRole('heading', {
      name: '合成目标页面',
      exact: true,
    })).toHaveCount(0);

    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(generationRequests).toBe(1);

    releaseGeneration();

    await expect(page.getByLabel('结果标题', { exact: true }))
      .toBeVisible();

    expect(writes.filter(item => item.path.endsWith('/generate')))
      .toHaveLength(1);

    await expect(page.getByRole('button', {
      name: '创建任务',
      exact: true,
    })).toBeEnabled();

    await page.evaluate(() => window.navigateFixture());

    await expect(page.getByRole('heading', {
      name: '合成目标页面',
      exact: true,
    })).toBeVisible();
  } finally {
    releaseGeneration();
  }
});

test('history restores saved tasks and protects unsaved edits when switching', async ({ page }) => {
  await mount(page);
  await createAndGenerate(page);

  await page.getByLabel('结果标题', { exact: true })
    .fill('第一项任务的已保存标题');

  await page.getByRole('button', {
    name: '保存编辑',
    exact: true,
  }).click();

  await expect(page.getByRole('status', {
    name: '任务操作状态',
    exact: true,
  })).toHaveText('任务已更新。');

  // 再创建一项独立任务。
  await page.getByRole('button', {
    name: '创建任务',
    exact: true,
  }).click();

  await expect(page).toHaveURL(/task=synthetic-agent-task-2$/);

  await page.getByRole('button', {
    name: '生成方案',
    exact: true,
  }).click();

  await expect(page.getByLabel('结果标题', { exact: true }))
    .toBeVisible();

  await page.getByLabel('结果标题', { exact: true })
    .fill('第二项任务尚未保存的标题');

  const history = page.locator('section').filter({
    has: page.getByRole('heading', {
      name: '历史任务',
      exact: true,
    }),
  });

  const firstTask = history.getByRole('button', {
    name: '打开任务 synthetic-agent-task',
    exact: true,
  });

  await expect(firstTask).toBeVisible();

  await expect(history.getByRole('button', {
    name: '打开任务 synthetic-agent-task-2',
    exact: true,
  })).toBeVisible();

  await firstTask.click();

  const confirmation = page.getByRole('dialog', {
    name: '离开并放弃未保存的内容？',
    exact: true,
  });

  await expect(confirmation).toBeVisible();

  await confirmation.getByRole('button', {
    name: '继续编辑',
    exact: true,
  }).click();

  await expect(confirmation).toHaveCount(0);
  await expect(page).toHaveURL(/task=synthetic-agent-task-2$/);
  await expect(page.getByLabel('结果标题', { exact: true }))
    .toHaveValue('第二项任务尚未保存的标题');

  await firstTask.click();

  await confirmation.getByRole('button', {
    name: '放弃并离开',
    exact: true,
  }).click();

  await expect(page).toHaveURL(/task=synthetic-agent-task$/);
  await expect(page.getByLabel('结果标题', { exact: true }))
    .toHaveValue('第一项任务的已保存标题');

  // 刷新后仍能通过历史列表和任务地址恢复。
  await page.reload();

  await expect(page.getByLabel('结果标题', { exact: true }))
    .toHaveValue('第一项任务的已保存标题');

  await expect(history.getByRole('button', {
    name: '打开任务 synthetic-agent-task-2',
    exact: true,
  })).toBeVisible();
});

test('cancelling deletion preserves edits and confirming clears the current task', async ({ page }) => {
  const writes = await mount(page);
  await createAndGenerate(page);

  await page.getByLabel('结果标题', { exact: true })
    .fill('删除前尚未保存的标题');

  const deleteButton = page.getByRole('button', {
    name: '删除任务 synthetic-agent-task',
    exact: true,
  });

  await deleteButton.click();

  const dialog = page.getByRole('dialog', {
    name: '删除这个任务？',
    exact: true,
  });

  await expect(dialog).toContainText('当前任务有未保存内容');

  await dialog.getByRole('button', {
    name: '取消',
    exact: true,
  }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('结果标题', { exact: true }))
    .toHaveValue('删除前尚未保存的标题');

  expect(writes.filter(item => item.path.endsWith('/delete')))
    .toHaveLength(0);

  await deleteButton.click();

  await dialog.getByRole('button', {
    name: '确认删除',
    exact: true,
  }).click();

  await expect(page.getByRole('status', {
    name: '任务操作状态',
    exact: true,
  })).toHaveText('任务已删除。');

  await expect(deleteButton).toHaveCount(0);
  await expect(page.getByLabel('结果标题', { exact: true }))
    .toHaveCount(0);
  await expect(page.getByLabel('任务需求', { exact: true }))
    .toHaveValue('');

  expect(new URL(page.url()).searchParams.has('task')).toBe(false);
  expect(writes.filter(item => item.path.endsWith('/delete')))
    .toHaveLength(1);

  await page.reload();
  await expect(deleteButton).toHaveCount(0);
  await expect(page.getByText('暂时没有可查看的历史任务。', {
    exact: true,
  })).toBeVisible();
});

test('failed deletion preserves the task and unsaved input', async ({ page }) => {
  await mount(page, { failDeletion: true });
  await createAndGenerate(page);

  await page.getByLabel('结果标题', { exact: true })
    .fill('删除失败后应保留的标题');

  const deleteButton = page.getByRole('button', {
    name: '删除任务 synthetic-agent-task',
    exact: true,
  });

  await deleteButton.click();

  await page.getByRole('dialog', {
    name: '删除这个任务？',
    exact: true,
  }).getByRole('button', {
    name: '确认删除',
    exact: true,
  }).click();

  await expect(page.getByRole('status', {
    name: '任务操作状态',
    exact: true,
  })).toHaveText('合成删除失败');

  await expect(page.getByLabel('结果标题', { exact: true }))
    .toHaveValue('删除失败后应保留的标题');

  await expect(deleteButton).toBeVisible();
  await expect(page).toHaveURL(/task=synthetic-agent-task$/);

  await page.getByRole('button', {
    name: '确认本步',
    exact: true,
  }).click();

  await expect(page.getByRole('status', {
    name: '任务操作状态',
    exact: true,
  })).toContainText('请先点击“保存编辑”');
});

test('deleting another history task preserves the current edited task', async ({ page }) => {
  await mount(page);
  await createAndGenerate(page);

  await page.getByRole('button', {
    name: '创建任务',
    exact: true,
  }).click();

  await expect(page).toHaveURL(/task=synthetic-agent-task-2$/);

  await page.getByRole('button', {
    name: '生成方案',
    exact: true,
  }).click();

  await expect(page.getByLabel('结果标题', { exact: true }))
    .toBeVisible();

  await page.getByLabel('结果标题', { exact: true })
    .fill('当前第二项任务的编辑');

  const firstDelete = page.getByRole('button', {
    name: '删除任务 synthetic-agent-task',
    exact: true,
  });

  await firstDelete.click();

  await page.getByRole('dialog', {
    name: '删除这个任务？',
    exact: true,
  }).getByRole('button', {
    name: '确认删除',
    exact: true,
  }).click();

  await expect(firstDelete).toHaveCount(0);

  await expect(page.getByLabel('结果标题', { exact: true }))
    .toHaveValue('当前第二项任务的编辑');

  await expect(page).toHaveURL(/task=synthetic-agent-task-2$/);

  await expect(page.getByRole('button', {
    name: '删除任务 synthetic-agent-task-2',
    exact: true,
  })).toBeVisible();
});

async function prepareActivityConfiguration(page) {
  await createAndGenerate(page);

  const nextSteps = [
    '策划与分工',
    '物资与准备事项',
    '活动配置草稿',
    '筹备方案核对',
  ];

  for (const [index, label] of nextSteps.entries()) {
    await page.getByRole('button', {
      name: '确认本步',
      exact: true,
    }).click();

    await expect(page.getByRole('heading', {
      name: label,
      exact: true,
    })).toBeVisible();

    if (index < nextSteps.length - 1) {
      await page.getByRole('button', {
        name: '生成方案',
        exact: true,
      }).click();

      await expect(page.getByRole('button', {
        name: '确认本步',
        exact: true,
      })).toBeVisible();
    }
  }

  await expect(page.getByRole('heading', {
    name: '活动配置表单',
    exact: true,
  })).toBeVisible();
}

async function fillActivityConfiguration(page) {
  await page.getByLabel('配置：活动名称', { exact: true })
    .fill('合成急救知识活动');

  await page.getByLabel('配置：活动类型 / 专项', { exact: true })
    .fill('急救培训');

  await page.getByLabel('配置：活动日期', { exact: true })
    .fill('2026-11-01');

  await page.getByLabel('配置：活动地点', { exact: true })
    .fill('合成地点');

  for (const [label, time] of [
    ['配置：开始时间', '09:00'],
    ['配置：结束时间', '11:30'],
  ]) {
    await page.getByRole('combobox', {
      name: label,
      exact: true,
    }).click();

    await page.getByRole('option', {
      name: time,
      exact: true,
    }).click();
  }

  await page.getByLabel('配置：推荐录取名额', { exact: true })
    .fill('20');
  await page.getByLabel('配置：上限名额', { exact: true })
    .fill('30');
  await page.getByLabel('配置：培训时长（小时）', { exact: true })
    .fill('0');
  await page.getByLabel('配置：交通时长（小时）', { exact: true })
    .fill('0');
  await page.getByLabel('配置：活动内容', { exact: true })
    .fill('合成活动内容');
  await page.getByLabel('配置：工作内容', { exact: true })
    .fill('合成岗位工作');
}

test('activity configuration requires previewing the current field values', async ({ page }) => {
  const writes = await mount(page);
  await prepareActivityConfiguration(page);
  await fillActivityConfiguration(page);

  await page.getByRole('button', {
    name: '保存活动配置',
    exact: true,
  }).click();

  await expect(page.getByRole('status', {
    name: '活动配置状态',
    exact: true,
  })).toContainText('请先预览当前配置');

  expect(writes.filter(item => item.path.endsWith('/activity-draft')))
    .toHaveLength(0);

  await page.getByRole('button', {
    name: '预览活动配置',
    exact: true,
  }).click();

  await expect(page.getByRole('heading', {
    name: '活动配置预览',
    exact: true,
  })).toBeVisible();

  await page.getByLabel('配置：活动名称', { exact: true })
    .fill('预览后修改的名称');

  await page.getByRole('button', {
    name: '保存活动配置',
    exact: true,
  }).click();

  await expect(page.getByRole('status', {
    name: '活动配置状态',
    exact: true,
  })).toContainText('修改字段后需要重新预览');

  expect(writes.filter(item => item.path.endsWith('/activity-draft')))
    .toHaveLength(0);
});

test('saved activity configuration survives reload without creating an event', async ({ page }) => {
  const writes = await mount(page);
  await prepareActivityConfiguration(page);
  await fillActivityConfiguration(page);

  await page.getByRole('button', {
    name: '预览活动配置',
    exact: true,
  }).click();

  await expect(page.getByText(
    '服务 2.5 小时；培训 0 小时；交通 0 小时',
    { exact: true },
  )).toBeVisible();

  await page.getByRole('button', {
    name: '保存活动配置',
    exact: true,
  }).click();

  await expect.poll(() =>
    writes.filter(item => item.path.endsWith('/activity-draft')).length,
  ).toBe(1);

  await expect(page.getByRole('status', {
    name: '任务操作状态',
    exact: true,
  })).toHaveText('任务已更新。');

  await page.reload();

  await expect(page.getByLabel('配置：活动名称', { exact: true }))
    .toHaveValue('合成急救知识活动');

  await expect(page.getByLabel('配置：推荐录取名额', { exact: true }))
    .toHaveValue('20');

  await expect(page.getByRole('combobox', {
    name: '配置：开始时间',
    exact: true,
  })).toContainText('09:00');

  expect(writes.every(item =>
    item.path.startsWith('/api/console/agent/'),
  )).toBe(true);
});

test('failed configuration saves preserve fields and navigation protection', async ({ page }) => {
  await mount(page, { failActivityDraft: true });
  await prepareActivityConfiguration(page);
  await fillActivityConfiguration(page);

  await page.getByRole('button', {
    name: '预览活动配置',
    exact: true,
  }).click();

  await page.getByRole('button', {
    name: '保存活动配置',
    exact: true,
  }).click();

  await expect(page.getByRole('status', {
    name: '任务操作状态',
    exact: true,
  })).toHaveText('合成配置保存失败');

  await expect(page.getByLabel('配置：活动名称', { exact: true }))
    .toHaveValue('合成急救知识活动');

  await connectFixtureRouter(page);

  await page.evaluate(() => {
    void window.navigateFixture();
  });

  const dialog = page.getByRole('dialog', {
    name: '离开并放弃未保存的内容？',
    exact: true,
  });

  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', {
    name: '继续编辑',
    exact: true,
  }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('配置：活动名称', { exact: true }))
    .toHaveValue('合成急救知识活动');
});

async function prepareWritingEditor(page) {
  await page.getByRole('combobox', {
    name: '助手类型',
    exact: true,
  }).click();

  await page.getByRole('option', {
    name: '推文创作',
    exact: true,
  }).click();

  await createAndGenerate(page);

  for (const [index, label] of [
    '标题与提纲',
    '推文正文草稿',
    '事实与文案核对',
  ].entries()) {
    await page.getByRole('button', {
      name: '确认本步',
      exact: true,
    }).click();

    await expect(page.getByRole('heading', {
      name: label,
      exact: true,
    })).toBeVisible();

    if (index < 2) {
      await page.getByRole('button', {
        name: '生成方案',
        exact: true,
      }).click();

      await expect(page.getByRole('button', {
        name: '确认本步',
        exact: true,
      })).toBeVisible();
    }
  }

  await expect(page.getByRole('heading', {
    name: '推文草稿编辑',
    exact: true,
  })).toBeVisible();
}

async function fillWritingDraft(page) {
  for (const [label, value] of [
    ['推文：推文标题', '合成推文标题'],
    ['推文：开头导语', '合成导语'],
    ['推文：推文正文', '合成正文第一段。\n\n合成正文第二段。'],
    ['推文：结尾与行动提示', '合成结尾'],
    ['推文：事实来源与待核对事项', '内部核对备注'],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
}

test('writing drafts require a preview matching the current fields', async ({ page }) => {
  const writes = await mount(page);
  await prepareWritingEditor(page);
  await fillWritingDraft(page);

  await page.getByRole('button', {
    name: '保存推文草稿',
    exact: true,
  }).click();

  await expect(page.getByRole('status', {
    name: '推文草稿状态',
    exact: true,
  })).toContainText('请先预览当前正文');

  expect(writes.filter(item => item.path.endsWith('/writing-draft')))
    .toHaveLength(0);

  await page.getByRole('button', {
    name: '预览推文正文',
    exact: true,
  }).click();

  await expect(page.locator('.agent-writing-preview'))
    .toContainText('合成推文标题');
  await expect(page.locator('.agent-writing-preview'))
    .not.toContainText('内部核对备注');

  await page.getByLabel('推文：推文标题', { exact: true })
    .fill('预览后修改的标题');

  await page.getByRole('button', {
    name: '保存推文草稿',
    exact: true,
  }).click();

  await expect(page.getByRole('status', {
    name: '推文草稿状态',
    exact: true,
  })).toContainText('修改字段后需要重新预览');

  expect(writes.filter(item => item.path.endsWith('/writing-draft')))
    .toHaveLength(0);
});

test('saved writing drafts restore after reload and copy excludes internal notes', async ({ page }) => {
  await mount(page);
  await prepareWritingEditor(page);
  await fillWritingDraft(page);

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

  await page.reload();

  await expect(page.getByLabel('推文：推文正文', { exact: true }))
    .toHaveValue('合成正文第一段。\n\n合成正文第二段。');

  await expect(page.getByLabel('推文：事实来源与待核对事项', {
    exact: true,
  })).toHaveValue('内部核对备注');

  // 使用合成剪贴板，避免测试改动系统剪贴板。
  await page.evaluate(() => {
    window.copiedWriting = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        async writeText(text) {
          window.copiedWriting.push(text);
        },
      },
    });
  });

  await page.getByRole('button', {
    name: '复制已保存正文',
    exact: true,
  }).click();

  await expect(page.getByRole('status', {
    name: '推文草稿状态',
    exact: true,
  })).toHaveText('已复制正文，不包含内部核对备注。');

  expect(await page.evaluate(() => window.copiedWriting)).toEqual([
    '合成推文标题\n\n合成导语\n\n合成正文第一段。\n\n合成正文第二段。\n\n合成结尾',
  ]);

  await page.getByLabel('推文：推文正文', { exact: true })
    .fill('尚未保存的新正文');

  await page.getByRole('button', {
    name: '复制已保存正文',
    exact: true,
  }).click();

  await expect(page.getByRole('status', {
    name: '推文草稿状态',
    exact: true,
  })).toContainText('请先预览并保存');

  expect(await page.evaluate(() => window.copiedWriting.length)).toBe(1);
});

test('failed writing saves preserve content and navigation protection', async ({ page }) => {
  await mount(page, { failWritingDraft: true });
  await prepareWritingEditor(page);
  await fillWritingDraft(page);

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
  })).toHaveText('合成推文保存失败');

  await expect(page.getByLabel('推文：推文正文', { exact: true }))
    .toHaveValue('合成正文第一段。\n\n合成正文第二段。');

  await connectFixtureRouter(page);

  await page.evaluate(() => {
    void window.navigateFixture();
  });

  const dialog = page.getByRole('dialog', {
    name: '离开并放弃未保存的内容？',
    exact: true,
  });

  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', {
    name: '继续编辑',
    exact: true,
  }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('推文：推文标题', { exact: true }))
    .toHaveValue('合成推文标题');
});

async function prepareDesignEditor(page) {
  await page.getByRole('combobox', {
    name: '助手类型',
    exact: true,
  }).click();

  await page.getByRole('option', {
    name: '美编建议',
    exact: true,
  }).click();

  await createAndGenerate(page);

  for (const [index, label] of [
    '配色与版式方案',
    '排版预览方案',
    '阅读体验核对',
  ].entries()) {
    await page.getByRole('button', {
      name: '确认本步',
      exact: true,
    }).click();

    await expect(page.getByRole('heading', {
      name: label,
      exact: true,
    })).toBeVisible();

    if (index < 2) {
      await page.getByRole('button', {
        name: '生成方案',
        exact: true,
      }).click();

      await expect(page.getByRole('button', {
        name: '确认本步',
        exact: true,
      })).toBeVisible();
    }
  }

  await expect(page.getByRole('heading', {
    name: '美编方案编辑',
    exact: true,
  })).toBeVisible();
}

async function fillDesignDraft(page) {
  for (const [label, value] of [
    ['美编：方案标题', '合成美编方案'],
    ['美编：目标读者', '新生'],
    ['美编：预览主标题', '合成主标题'],
    ['美编：预览导语', '合成导语'],
    ['美编：预览正文', '第一段合成正文。\n\n第二段合成正文。'],
    ['美编：预览页尾', '合成页尾'],
    ['美编：配图与素材建议', '合成配图建议'],
    ['美编：内部核对事项', '内部核对备注'],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
}

async function chooseDesignOption(page, label, option) {
  await page.getByRole('combobox', {
    name: label,
    exact: true,
  }).click();

  await page.getByRole('option', {
    name: option,
    exact: true,
  }).click();
}

test('design saving requires a new preview after changing the palette', async ({ page }) => {
  const writes = await mount(page);
  await prepareDesignEditor(page);
  await fillDesignDraft(page);

  await page.getByRole('button', {
    name: '保存美编方案',
    exact: true,
  }).click();

  await expect(page.getByRole('status', {
    name: '美编方案状态',
    exact: true,
  })).toContainText('请先预览当前方案');

  await page.getByRole('button', {
    name: '预览美编方案',
    exact: true,
  }).click();

  const preview = page.getByRole('article', {
    name: '美编版式预览',
    exact: true,
  });

  await expect(preview).toHaveAttribute('data-palette', 'rose');

  await chooseDesignOption(page, '美编：配色方案', '沉稳青绿');

  await page.getByRole('button', {
    name: '保存美编方案',
    exact: true,
  }).click();

  await expect(page.getByRole('status', {
    name: '美编方案状态',
    exact: true,
  })).toContainText('修改内容或样式后需要重新预览');

  expect(writes.filter(item => item.path.endsWith('/design-draft')))
    .toHaveLength(0);

  await page.getByRole('button', {
    name: '预览美编方案',
    exact: true,
  }).click();

  await expect(preview).toHaveAttribute('data-palette', 'green');
});

test('design preview renders text safely and saved styles survive reload', async ({ page }) => {
  await mount(page);
  await prepareDesignEditor(page);
  await fillDesignDraft(page);

  const headline = '<img src=x onerror="window.designInjected=true">';

  await page.evaluate(() => {
    window.designInjected = false;
  });

  await page.getByLabel('美编：预览主标题', { exact: true })
    .fill(headline);

  await chooseDesignOption(page, '美编：配色方案', '清爽蓝灰');
  await chooseDesignOption(page, '美编：版式方案', '活动通知');

  await page.getByRole('button', {
    name: '预览美编方案',
    exact: true,
  }).click();

  const preview = page.getByRole('article', {
    name: '美编版式预览',
    exact: true,
  });

  await expect(preview).toContainText(headline);
  await expect(preview.locator('img, script')).toHaveCount(0);
  await expect(preview).not.toContainText('内部核对备注');
  await expect(preview).not.toContainText('合成配图建议');
  await expect(preview).toHaveAttribute('data-palette', 'blue');
  await expect(preview).toHaveAttribute('data-layout', 'announcement');

  expect(await page.evaluate(() => window.designInjected)).toBe(false);

  await page.getByRole('button', {
    name: '保存美编方案',
    exact: true,
  }).click();

  await expect(page.getByRole('status', {
    name: '任务操作状态',
    exact: true,
  })).toHaveText('任务已更新。');

  await page.reload();

  await expect(page.getByLabel('美编：预览主标题', { exact: true }))
    .toHaveValue(headline);

  await expect(page.getByRole('combobox', {
    name: '美编：配色方案',
    exact: true,
  })).toContainText('清爽蓝灰');

  await expect(page.getByRole('combobox', {
    name: '美编：版式方案',
    exact: true,
  })).toContainText('活动通知');

  await expect(page.getByLabel('美编：内部核对事项', { exact: true }))
    .toHaveValue('内部核对备注');

  await page.getByRole('button', {
    name: '预览美编方案',
    exact: true,
  }).click();

  await expect(preview).toHaveAttribute('data-palette', 'blue');
  await expect(preview).toHaveAttribute('data-layout', 'announcement');
  await expect(preview.locator('img, script')).toHaveCount(0);
});

test('failed design saves retain fields and unsaved navigation protection', async ({ page }) => {
  await mount(page, { failDesignDraft: true });
  await prepareDesignEditor(page);
  await fillDesignDraft(page);

  await page.getByRole('button', {
    name: '预览美编方案',
    exact: true,
  }).click();

  await page.getByRole('button', {
    name: '保存美编方案',
    exact: true,
  }).click();

  await expect(page.getByRole('status', {
    name: '任务操作状态',
    exact: true,
  })).toHaveText('合成美编保存失败');

  await expect(page.getByLabel('美编：方案标题', { exact: true }))
    .toHaveValue('合成美编方案');

  await connectFixtureRouter(page);

  await page.evaluate(() => {
    void window.navigateFixture();
  });

  const dialog = page.getByRole('dialog', {
    name: '离开并放弃未保存的内容？',
    exact: true,
  });

  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', {
    name: '继续编辑',
    exact: true,
  }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('美编：预览正文', { exact: true }))
    .toHaveValue('第一段合成正文。\n\n第二段合成正文。');
});

test('mock mode is clearly identified without claiming real model generation', async ({ page }) => {
  await mount(page);

  const banner = page.locator('.agent-mode-note');

  await expect(banner).toContainText('当前为模拟模式');
  await expect(banner).toContainText('不发送模型请求');

  await expect(page.getByRole('button', {
    name: '创建任务',
    exact: true,
  })).toBeEnabled();

  await createAndGenerate(page);

  await expect(page.getByText('最近一次生成来源：模拟模板', {
    exact: true,
  })).toBeVisible();
});

test('DeepSeek mode displays its provider and records the generation source', async ({ page }) => {
  await mount(page, { modelProvider: 'deepseek' });

  const banner = page.locator('.agent-mode-note');

  await expect(banner).toContainText('当前为 DeepSeek 模型模式');
  await expect(banner).toContainText('发送给模型服务');
  await expect(banner).not.toContainText('当前为模拟模式');

  await createAndGenerate(page);

  await expect(page.getByText('最近一次生成来源：DeepSeek', {
    exact: true,
  })).toBeVisible();

  await expect(page.getByRole('button', {
    name: '重新生成方案',
    exact: true,
  })).toBeVisible();
});

test('failed model status blocks creation and refreshing status restores it', async ({ page }) => {
  const writes = await mount(page, { failModelStatus: true });

  const banner = page.locator('.agent-mode-note');
  const createButton = page.getByRole('button', {
    name: '创建任务',
    exact: true,
  });

  await expect(banner).toContainText('模型状态暂不可用');
  await expect(banner).toContainText('合成模型状态读取失败');
  await expect(createButton).toBeDisabled();

  expect(writes.filter(item =>
    item.path === '/api/console/agent/tasks',
  )).toHaveLength(0);

  // 模拟状态接口恢复，不访问外部模型服务。
  await page.route('**/api/console/agent/status', route => route.fulfill({
    json: {
      ok: true,
      provider: 'mock',
      simulated: true,
    },
  }));

  await page.getByRole('button', {
    name: '刷新模型状态',
    exact: true,
  }).click();

  await expect(banner).toContainText('当前为模拟模式');
  await expect(createButton).toBeEnabled();

  await createAndGenerate(page);

  expect(writes.filter(item =>
    item.path === '/api/console/agent/tasks',
  )).toHaveLength(1);
});

const candidateCases = [
  {
    mode: 'activity',
    prepare: prepareActivityConfiguration,
    fill: fillActivityConfiguration,
    titleLabel: '配置：活动名称',
    candidateTitle: '[待确认] 活动名称',
    preservedLabel: '配置：活动地点',
    preservedValue: '合成地点',
    previewButton: '预览活动配置',
    saveButton: '保存活动配置',
    savePath: '/activity-draft',
  },
  {
    mode: 'writing',
    prepare: prepareWritingEditor,
    fill: fillWritingDraft,
    titleLabel: '推文：推文标题',
    candidateTitle: '[待确认] 推文标题',
    preservedLabel: '推文：开头导语',
    preservedValue: '合成导语',
    previewButton: '预览推文正文',
    saveButton: '保存推文草稿',
    savePath: '/writing-draft',
  },
  {
    mode: 'design',
    prepare: prepareDesignEditor,
    fill: fillDesignDraft,
    titleLabel: '美编：方案标题',
    candidateTitle: '模拟美编方案',
    preservedLabel: '美编：目标读者',
    preservedValue: '新生',
    previewButton: '预览美编方案',
    saveButton: '保存美编方案',
    savePath: '/design-draft',
  },
];

for (const scenario of candidateCases) {
  test(`${scenario.mode}: candidate adoption requires confirmation and explicit saving`, async ({ page }) => {
    const writes = await mount(page);
    await scenario.prepare(page);
    await scenario.fill(page);

    const title = page.getByLabel(scenario.titleLabel, { exact: true });
    const originalTitle = await title.inputValue();

    await page.getByRole('button', {
      name: '预览并带入候选',
      exact: true,
    }).click();

    const dialog = page.getByRole('dialog', {
      name: '将候选内容带入编辑器？',
      exact: true,
    });

    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`当前：${originalTitle}`);
    await expect(dialog).toContainText(`候选：${scenario.candidateTitle}`);

    await dialog.getByRole('button', {
      name: '取消',
      exact: true,
    }).click();

    await expect(dialog).toHaveCount(0);
    await expect(title).toHaveValue(originalTitle);

    expect(writes.filter(item => item.path.endsWith(scenario.savePath)))
      .toHaveLength(0);

    await page.getByRole('button', {
      name: '预览并带入候选',
      exact: true,
    }).click();

    await dialog.getByRole('button', {
      name: '确认带入',
      exact: true,
    }).click();

    await expect(dialog).toHaveCount(0);
    await expect(title).toHaveValue(scenario.candidateTitle);

    await expect(page.getByLabel(scenario.preservedLabel, {
      exact: true,
    })).toHaveValue(scenario.preservedValue);

    await expect(page.getByRole('status', {
      name: '候选草稿状态',
      exact: true,
    })).toHaveText('已带入编辑器，尚未保存。');

    expect(writes.filter(item => item.path.endsWith(scenario.savePath)))
      .toHaveLength(0);

    // 人工核对后修改标题，再预览和保存。
    const reviewedTitle = `人工核对后的${scenario.mode}标题`;
    await title.fill(reviewedTitle);

    await page.getByRole('button', {
      name: scenario.previewButton,
      exact: true,
    }).click();

    await page.getByRole('button', {
      name: scenario.saveButton,
      exact: true,
    }).click();

    await expect.poll(() =>
      writes.filter(item => item.path.endsWith(scenario.savePath)).length,
    ).toBe(1);

    await expect(page.getByRole('status', {
      name: '任务操作状态',
      exact: true,
    })).toHaveText('任务已更新。');

    await page.reload();

    await expect(title).toHaveValue(reviewedTitle);
    await expect(page.getByLabel(scenario.preservedLabel, {
      exact: true,
    })).toHaveValue(scenario.preservedValue);
  });
}

async function saveWritingForRevision(page) {
  await prepareWritingEditor(page);
  await fillWritingDraft(page);

  await page.getByRole('button', {
    name: '预览推文正文',
    exact: true,
  }).click();

  await page.getByRole('button', {
    name: '保存推文草稿',
    exact: true,
  }).click();

  await expect(page.getByLabel('草稿修改要求', { exact: true }))
    .toBeVisible();
}

test('writing revisions require adoption and explicit saving while preserving unselected content', async ({ page }) => {
  const writes = await mount(page);
  await saveWritingForRevision(page);

  await page.getByLabel('草稿修改要求', { exact: true })
    .fill('只让标题更简洁，正文保持原样');

  await page.getByRole('button', {
    name: '生成修改建议',
    exact: true,
  }).click();

  const adopt = page.getByRole('button', {
    name: '预览并采用修改',
    exact: true,
  });

  await expect(adopt).toBeVisible();

  const title = page.getByLabel('推文：推文标题', { exact: true });
  const body = page.getByLabel('推文：推文正文', { exact: true });
  const originalBody = '合成正文第一段。\n\n合成正文第二段。';

  await expect(title).toHaveValue('合成推文标题');
  await expect(body).toHaveValue(originalBody);

  expect(writes.filter(item => item.path.endsWith('/writing-draft')))
    .toHaveLength(1);

  await adopt.click();

  const dialog = page.getByRole('dialog', {
    name: '采用这些草稿修改？',
    exact: true,
  });

  await expect(dialog).toContainText('合成推文标题（模拟修改）');

  await dialog.getByRole('button', {
    name: '取消',
    exact: true,
  }).click();

  await expect(dialog).toHaveCount(0);
  await expect(title).toHaveValue('合成推文标题');

  await adopt.click();

  await dialog.getByRole('button', {
    name: '确认采用',
    exact: true,
  }).click();

  await expect(dialog).toHaveCount(0);
  await expect(title).toHaveValue('合成推文标题（模拟修改）');
  await expect(body).toHaveValue(originalBody);

  expect(writes.filter(item => item.path.endsWith('/writing-draft')))
    .toHaveLength(1);

  await page.getByRole('button', {
    name: '预览推文正文',
    exact: true,
  }).click();

  await page.getByRole('button', {
    name: '保存推文草稿',
    exact: true,
  }).click();

  await expect(adopt).toHaveCount(0);

  await page.reload();

  await expect(title).toHaveValue('合成推文标题（模拟修改）');
  await expect(body).toHaveValue(originalBody);
});

test('failed revisions preserve the request and navigation protection', async ({ page }) => {
  await mount(page, { failDraftRevision: true });
  await saveWritingForRevision(page);

  await page.getByLabel('草稿修改要求', { exact: true })
    .fill('只改标题，保留其他内容');

  await page.getByRole('button', {
    name: '生成修改建议',
    exact: true,
  }).click();

  await expect(page.getByRole('status', {
    name: '任务操作状态',
    exact: true,
  })).toHaveText('合成修改建议失败');

  await expect(page.getByLabel('草稿修改要求', { exact: true }))
    .toHaveValue('只改标题，保留其他内容');

  await expect(page.getByLabel('推文：推文标题', { exact: true }))
    .toHaveValue('合成推文标题');

  await connectFixtureRouter(page);

  await page.evaluate(() => {
    void window.navigateFixture();
  });

  const dialog = page.getByRole('dialog', {
    name: '离开并放弃未保存的内容？',
    exact: true,
  });

  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', {
    name: '继续编辑',
    exact: true,
  }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('草稿修改要求', { exact: true }))
    .toHaveValue('只改标题，保留其他内容');
});

for (const scenario of [
  {
    mode: 'activity',
    prepare: prepareActivityConfiguration,
    fill: fillActivityConfiguration,
    preview: '预览活动配置',
    save: '保存活动配置',
    selected: '配置：活动名称',
    original: '合成急救知识活动',
    preserved: '配置：活动地点',
    preservedValue: '合成地点',
  },
  {
    mode: 'design',
    prepare: prepareDesignEditor,
    fill: fillDesignDraft,
    preview: '预览美编方案',
    save: '保存美编方案',
    selected: '美编：预览主标题',
    original: '合成主标题',
    preserved: '美编：目标读者',
    preservedValue: '新生',
  },
]) {
  test(`${scenario.mode}: revisions adopt only the selected title field`, async ({ page }) => {
    await mount(page);
    await scenario.prepare(page);
    await scenario.fill(page);

    await page.getByRole('button', {
      name: scenario.preview,
      exact: true,
    }).click();

    await page.getByRole('button', {
      name: scenario.save,
      exact: true,
    }).click();

    await page.getByLabel('草稿修改要求', { exact: true })
      .fill('只修改标题，其他字段保持原样');

    await page.getByRole('button', {
      name: '生成修改建议',
      exact: true,
    }).click();

    await page.getByRole('button', {
      name: '预览并采用修改',
      exact: true,
    }).click();

    await page.getByRole('dialog', {
      name: '采用这些草稿修改？',
      exact: true,
    }).getByRole('button', {
      name: '确认采用',
      exact: true,
    }).click();

    await expect(page.getByLabel(scenario.selected, { exact: true }))
      .toHaveValue(`${scenario.original}（模拟修改）`);

    await expect(page.getByLabel(scenario.preserved, { exact: true }))
      .toHaveValue(scenario.preservedValue);
  });
}