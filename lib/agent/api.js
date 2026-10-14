import {
  getActiveAgentStep,
} from '../../public/app/shared/agent-workflow.js';
import { AgentModelError } from './compatible-model.js';

function failure(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function requireBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw failure(400, 'agent_body_invalid', '请求内容格式不正确');
  }
}

function validText(value, maximum, { optional = false } = {}) {
  if (optional && value === undefined) return true;
  return typeof value === 'string' &&
    value.length <= maximum &&
    (optional || Boolean(value.trim()));
}

export async function agentRoutes(req, res, url, ctx) {
  if (!url.pathname.startsWith('/api/console/agent/')) return false;

  const session = ctx.requireConsoleAccess(req, res);
  if (!session) return;

  if (
    !['GET', 'HEAD'].includes(req.method) &&
    !ctx.requireCsrf(req, res, session)
  ) {
    return;
  }

  const access = {
    actor: session.username,
    permissions: ctx.getPermissions(session),
  };

  try {
    if (url.pathname === '/api/console/agent/status') {
      if (req.method !== 'GET') {
        return ctx.json(res, 405, {
          ok: false,
          message: '查看模型状态请使用 GET。',
        });
      }

      return ctx.json(res, 200, {
        ok: true,
        ...ctx.service.modelStatus(),
      });
    }

    if (url.pathname === '/api/console/agent/history') {
      if (req.method !== 'GET') {
        return ctx.json(res, 405, {
          ok: false,
          message: '查看历史任务请使用 GET。',
        });
      }

      const tasks = ctx.service.list(access);
      return ctx.json(res, 200, { ok: true, tasks });
    }

    if (url.pathname === '/api/console/agent/tasks') {
      if (req.method !== 'POST') {
        return ctx.json(res, 405, {
          ok: false,
          message: '创建任务请使用 POST。',
        });
      }

      const body = await ctx.readJson(req);
      requireBody(body);
      if (
        !validText(body.mode, 30) ||
        !validText(body.brief, 4000)
      ) {
        throw failure(400, 'agent_input_invalid', '请填写有效的工作模式和需求');
      }

      const taskType = body.taskType === undefined
        ? 'workflow'
        : body.taskType;

      if (!['workflow', 'conversation'].includes(taskType)) {
        throw failure(400, 'agent_type_invalid', '不支持的任务类型');
      }

      const task = ctx.service.create({
        ...access,
        mode: body.mode,
        brief: body.brief,
        taskType,
      });
      return ctx.json(res, 201, { ok: true, task });
    }

    const match = url.pathname.match(
      /^\/api\/console\/agent\/tasks\/([^/]+)(?:\/(generate|revise|confirm|delete|activity-draft|writing-draft|design-draft|revise-draft|conversation-generate|conversation-confirm))?$/,
    );
    if (!match) {
      return ctx.json(res, 404, {
        ok: false,
        message: '任务接口不存在。',
      });
    }

    let id;
    try {
      id = decodeURIComponent(match[1]);
    } catch {
      throw failure(400, 'agent_id_invalid', '任务编号格式不正确');
    }
    const action = match[2];

    if (req.method === 'GET' && !action) {
      const task = ctx.service.get({ ...access, id });
      return ctx.json(res, 200, { ok: true, task });
    }
    if (req.method !== 'POST' || !action) {
      return ctx.json(res, 405, {
        ok: false,
        message: '此请求方式不受支持。',
      });
    }

    const body = await ctx.readJson(req);
    requireBody(body);
    if (!Number.isInteger(body.version) || body.version < 1) {
      throw failure(400, 'agent_version_invalid', '任务版本格式不正确');
    }

    const current = ctx.service.get({ ...access, id });
    if (current.version !== body.version) {
      throw failure(409, 'agent_task_changed', '任务已更新，请重新加载');
    }
    if (action === 'delete') {
      const deleted = ctx.service.remove({
        ...access,
        id,
        version: body.version,
      });

      return ctx.json(res, 200, {
        ok: true,
        deletedId: deleted.id,
      });
    }
    if ([
      'conversation-generate',
      'conversation-confirm',
    ].includes(action)) {
      if (current.taskType !== 'conversation') {
        throw failure(
          400,
          'agent_conversation_required',
          '此接口只支持对话任务',
        );
      }

      const options = {
        ...access,
        id,
        version: body.version,
      };

      let task;

      if (action === 'conversation-confirm') {
        if (body.draft !== undefined) requireBody(body.draft);

        task = ctx.service.confirmConversation({
          ...options,
          draft: body.draft ?? {},
        });
      } else {
        if (!validText(body.instruction, 2000, { optional: true })) {
          throw failure(
            400,
            'agent_instruction_invalid',
            '补充要求格式不正确或过长',
          );
        }

        task = await ctx.service.generateConversation({
          ...options,
          instruction: body.instruction,
        });
      }

      return ctx.json(res, 200, { ok: true, task });
    }

    if (
      current.taskType === 'conversation' &&
      ['activity-draft', 'writing-draft', 'design-draft'].includes(action)
    ) {
      requireBody(body.draft);

      const mode = {
        'activity-draft': 'activity',
        'writing-draft': 'writing',
        'design-draft': 'design',
      }[action];

      const task = ctx.service.saveConversationDraft({
        ...access,
        id,
        version: body.version,
        mode,
        draft: body.draft,
      });

      return ctx.json(res, 200, { ok: true, task });
    }

    if (current.taskType === 'conversation') {
      throw failure(
        400,
        'agent_conversation_action_invalid',
        '对话任务请使用对应的对话操作接口',
      );
    }

    if (action === 'activity-draft') {
      const task = ctx.service.saveActivityDraft({
        ...access,
        id,
        version: body.version,
        draft: body.draft,
      });

      return ctx.json(res, 200, { ok: true, task });
    }
    if (action === 'writing-draft') {
      const task = ctx.service.saveWritingDraft({
        ...access,
        id,
        version: body.version,
        draft: body.draft,
      });

      return ctx.json(res, 200, { ok: true, task });
    }
    if (action === 'design-draft') {
      const task = ctx.service.saveDesignDraft({
        ...access,
        id,
        version: body.version,
        draft: body.draft,
      });

      return ctx.json(res, 200, { ok: true, task });
    }

    if (action === 'revise-draft') {
      const task = await ctx.service.proposeDraftRevision({
        ...access,
        id,
        version: body.version,
        fields: body.fields,
        instruction: body.instruction,
      });

      return ctx.json(res, 200, { ok: true, task });
    }

    const active = getActiveAgentStep(current);
    if (!active) {
      throw failure(409, 'agent_task_finished', '任务草稿已准备完成');
    }

    const options = { ...access, id, version: body.version };
    let task;

    if (action === 'generate') {
      if (!validText(body.instruction, 2000, { optional: true })) {
        throw failure(400, 'agent_instruction_invalid', '补充要求格式不正确或过长');
      }
      task = await ctx.service.generate({
        ...options,
        instruction: body.instruction || '',
      });
    } else {
      if (body.stepId !== active.id) {
        throw failure(409, 'agent_step_changed', '只能操作当前步骤');
      }

      if (action === 'confirm') {
        if (active.status !== 'ready') {
          throw failure(409, 'agent_result_missing', '请先生成或保存步骤结果');
        }
        task = ctx.service.confirm({
          ...options,
          stepId: body.stepId,
        });
      } else {
        const output = body.output;
        if (
          !validText(output?.title, 200) ||
          !validText(output?.summary, 4000) ||
          !Array.isArray(output?.items) ||
          output.items.length > 40 ||
          output.items.some((item) =>
            typeof item !== 'string' || item.length > 4000)
        ) {
          throw failure(400, 'agent_output_invalid', '步骤结果格式不正确');
        }
        task = ctx.service.revise({
          ...options,
          stepId: body.stepId,
          output,
        });
      }
    }

    return ctx.json(res, 200, { ok: true, task });
  } catch (error) {
    const known = Number.isInteger(error.statusCode) &&
      error.statusCode >= 400 &&
      error.statusCode < 500;

    const modelFailure = error instanceof AgentModelError &&
      [429, 502, 504].includes(error.statusCode);

    const exposed = known || modelFailure;

    return ctx.json(res, exposed ? error.statusCode : 500, {
      ok: false,
      code: exposed
        ? error.code || 'agent_request_invalid'
        : 'agent_request_failed',
      message: exposed
        ? error.message
        : '任务处理失败，已有内容仍保留，请稍后重试。',
    });
  }
}