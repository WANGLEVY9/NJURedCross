/**
 * 任务与技能模块路由（v3 S5 / 第 8 项 + D3 + D6）
 *
 * 挂载前缀：
 *   · 公众端 /api/public/tasks*        —— 心愿清单（列表）/ 申领（登录 + CSRF + 限流）
 *   · 会员端 /api/portal/skills*       —— 技能提交与查看（登录 + CSRF）
 *   · 控制台 /api/console/tasks*       —— 任务发布
 *   · 控制台 /api/console/skills*      —— 技能审核队列
 *
 * 设计要点（对应变更单）：
 *   · 任务星级 = **发布人自评**（1-5），不做账号星级门槛硬拦，只作排序与提示
 *   · 成员技能星级 = 技能表经管理员审核后写回账号表「技能星级」
 *   · 「心愿清单」= 待认领任务列表，按「星级要求」降序 + 发布时间升序
 *   · 申领复用同一套表（任务表 + 任务申领表），两个入口（任务页 / 会员中心）共用
 *
 * ctx 注入契约：json / readJson / getBase / recordAudit / enforceLimit /
 *   requirePortalSession / requireCsrf / ownsBusinessRef / businessAccountRef /
 *   sendMail? / tables{ task, claim, skill, account } / config{}
 */

import {
  SKILL_LEVELS,
  SKILL_STATUS,
  SKILL_TABLE,
  TASK_CLAIM_TABLE,
  TASK_STATUS,
  TASK_TABLE,
} from './store.js';

/** 业务编号：{前缀}-{时间36}-{随机}，与 PHO-/SUB- 等同构。 */
function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
}

/** 任务标题/说明长度上限。 */
export const TASK_TITLE_MAX = 60;
export const TASK_DESC_MAX = 400;
/** 技能说明为**必填**（D3）。 */
export const SKILL_NAME_MAX = 30;
export const SKILL_DESC_MIN = 10;
export const SKILL_DESC_MAX = 300;

const TASK_TYPES = Object.freeze(['文字撰写', '摄影摄像', '平面设计', '推文排版', '现场执行', '其他']);
const VALID_STARS = Object.freeze([1, 2, 3, 4, 5]);

export { TASK_TYPES };

function text(value, max = 0) {
  const raw = String(value ?? '').trim();
  return max > 0 ? raw.slice(0, max) : raw;
}

function star(value) {
  const n = Number(value);
  return VALID_STARS.includes(n) ? n : 0;
}

/* --------------------------------------------------------------------------
   行映射（SeaTable 中文列名 ↔ 业务对象）
   -------------------------------------------------------------------------- */

export function taskRow(task = {}) {
  return {
    任务ID: text(task.id),
    标题: text(task.title),
    说明: text(task.description, TASK_DESC_MAX),
    类型: text(task.type),
    星级要求: task.stars || '',
    发布人: text(task.publisher),
    状态: task.status || TASK_STATUS.open,
    发布时间: text(task.publishedAt),
    认领人: text(task.claimedBy),
    认领时间: text(task.claimedAt),
  };
}

export function taskFromRow(row = {}) {
  return {
    id: text(row['任务ID']),
    title: text(row['标题']),
    description: text(row['说明']),
    type: text(row['类型']),
    stars: star(row['星级要求']),
    publisher: text(row['发布人']),
    status: text(row['状态']) || TASK_STATUS.open,
    publishedAt: text(row['发布时间']),
    claimedBy: text(row['认领人']),
    claimedAt: text(row['认领时间']),
    _id: row._id,
  };
}

export function taskPortalView(task = {}) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    type: task.type,
    stars: task.stars,
    publisher: task.publisher,
    status: task.status,
    publishedAt: task.publishedAt,
    claimedBy: task.claimedBy,
    claimedAt: task.claimedAt,
  };
}

export function claimRow(claim = {}) {
  return {
    申领ID: text(claim.id),
    任务ID: text(claim.taskId),
    申领人: text(claim.claimant),
    状态: claim.status || TASK_STATUS.open,
    时间: text(claim.at),
    说明: text(claim.note, TASK_DESC_MAX),
  };
}

export function claimFromRow(row = {}) {
  return {
    id: text(row['申领ID']),
    taskId: text(row['任务ID']),
    claimant: text(row['申领人']),
    status: text(row['状态']),
    at: text(row['时间']),
    note: text(row['说明']),
    _id: row._id,
  };
}

export function skillRow(skill = {}) {
  return {
    技能ID: text(skill.id),
    账号: text(skill.account),
    技能名: text(skill.name, SKILL_NAME_MAX),
    说明: text(skill.description),
    证明文件: text(skill.proof),
    自评星级: skill.selfStars || '',
    状态: skill.status || SKILL_STATUS.pending,
    审核人: text(skill.reviewer),
    审核意见: text(skill.reviewNote),
    提交时间: text(skill.submittedAt),
  };
}

export function skillFromRow(row = {}) {
  return {
    id: text(row['技能ID']),
    account: text(row['账号']),
    name: text(row['技能名']),
    description: text(row['说明']),
    proof: text(row['证明文件']),
    selfStars: star(row['自评星级']),
    status: text(row['状态']) || SKILL_STATUS.pending,
    reviewer: text(row['审核人']),
    reviewNote: text(row['审核意见']),
    submittedAt: text(row['提交时间']),
    _id: row._id,
  };
}

export function skillPortalView(skill = {}) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    proof: skill.proof,
    selfStars: skill.selfStars,
    status: skill.status,
    reviewer: skill.reviewer,
    reviewNote: skill.reviewNote,
    submittedAt: skill.submittedAt,
  };
}

/**
 * 心愿清单排序：星级要求高者优先；同星级先发布者优先。
 * 已认领/已关闭的任务排在最后（仍可见，但标注状态）。
 */
export function sortWishlist(tasks = []) {
  const rank = (task) => (task.status === TASK_STATUS.open ? 0 : 1);
  return [...tasks].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    const byStars = (b.stars || 0) - (a.stars || 0);
    if (byStars !== 0) return byStars;
    return String(a.publishedAt || '').localeCompare(String(b.publishedAt || ''));
  });
}

/** 星级文案（1-5 → 「3 星 · 精通」）。 */
export function starLabel(level) {
  const found = SKILL_LEVELS.find((item) => item.level === Number(level));
  return found ? `${found.level} 星 · ${found.label}` : `${Number(level) || 0} 星`;
}

/* --------------------------------------------------------------------------
   输入校验
   -------------------------------------------------------------------------- */

/**
 * 校验发布任务的入参。返回 { ok, errors[], value }。
 * 星级必填（发布人自评），类型必须在白名单内。
 */
export function validateTaskInput(input = {}) {
  const errors = [];
  const title = text(input.title, TASK_TITLE_MAX + 1);
  const description = text(input.description, TASK_DESC_MAX + 1);
  const type = text(input.type);
  const stars = star(input.stars);
  if (!title) errors.push({ field: 'title', code: 'task_title_required', message: '请填写任务标题。' });
  else if (title.length > TASK_TITLE_MAX) errors.push({ field: 'title', code: 'task_title_too_long', message: `标题不超过 ${TASK_TITLE_MAX} 字。` });
  if (description.length > TASK_DESC_MAX) errors.push({ field: 'description', code: 'task_desc_too_long', message: `说明不超过 ${TASK_DESC_MAX} 字。` });
  if (type && !TASK_TYPES.includes(type)) errors.push({ field: 'type', code: 'task_type_invalid', message: '任务类型不在可选范围内。' });
  if (!stars) errors.push({ field: 'stars', code: 'task_stars_required', message: '请自评任务星级（1-5 星）。' });
  return {
    ok: errors.length === 0,
    errors,
    value: { title, description, type: type || TASK_TYPES[0], stars },
  };
}

/**
 * 校验技能提交。说明**必填**（D3），且有最小长度，避免「一个字」糊弄。
 */
export function validateSkillInput(input = {}) {
  const errors = [];
  const name = text(input.name, SKILL_NAME_MAX + 1);
  const description = text(input.description, SKILL_DESC_MAX + 1);
  const selfStars = star(input.selfStars);
  if (!name) errors.push({ field: 'name', code: 'skill_name_required', message: '请填写技能名称。' });
  else if (name.length > SKILL_NAME_MAX) errors.push({ field: 'name', code: 'skill_name_too_long', message: `技能名不超过 ${SKILL_NAME_MAX} 字。` });
  if (!description) errors.push({ field: 'description', code: 'skill_desc_required', message: '请填写技能说明（必填）。' });
  else if (description.length < SKILL_DESC_MIN) errors.push({ field: 'description', code: 'skill_desc_too_short', message: `技能说明至少 ${SKILL_DESC_MIN} 字。` });
  else if (description.length > SKILL_DESC_MAX) errors.push({ field: 'description', code: 'skill_desc_too_long', message: `技能说明不超过 ${SKILL_DESC_MAX} 字。` });
  if (!selfStars) errors.push({ field: 'selfStars', code: 'skill_stars_required', message: '请自评技能星级（1-5 星）。' });
  return { ok: errors.length === 0, errors, value: { name, description, selfStars } };
}

/**
 * 审核技能入参：decision ∈ approve|reject；approve 时可用星级覆盖自评。
 */
export function validateSkillReview(input = {}) {
  const errors = [];
  const decision = text(input.decision);
  const level = star(input.level);
  const note = text(input.note, SKILL_DESC_MAX);
  if (!['approve', 'reject'].includes(decision)) errors.push({ field: 'decision', code: 'skill_decision_invalid', message: '审核结论必须是通过或驳回。' });
  if (decision === 'approve' && !level) errors.push({ field: 'level', code: 'skill_level_required', message: '通过时请确认最终星级（1-5 星）。' });
  if (decision === 'reject' && !note) errors.push({ field: 'note', code: 'skill_note_required', message: '驳回请写明原因。' });
  return { ok: errors.length === 0, errors, value: { decision, level, note } };
}

/* --------------------------------------------------------------------------
   路由
   -------------------------------------------------------------------------- */

async function listRows(ctx, table, limit = 2000) {
  const client = await ctx.getBase();
  return client.listRows(table, '', '', false, '', limit);
}

/** 公众端：/api/public/tasks* */
export async function publicTaskRoutes(req, res, url, ctx) {
  const tail = decodeURIComponent(url.pathname.replace(/^\/api\/public\/tasks\/?/, ''));

  // GET /api/public/tasks —— 心愿清单（公开读，登录后可见）
  if (req.method === 'GET' && tail === '') {
    const session = ctx.requirePortalSession(req, res);
    if (!session) return;
    const rows = await listRows(ctx, ctx.tables.task);
    const tasks = sortWishlist(rows.map(taskFromRow)).map(taskPortalView);
    return ctx.json(res, 200, {
      ok: true,
      tasks,
      types: TASK_TYPES,
      levels: SKILL_LEVELS,
      myStars: ctx.accountStars?.(session) ?? 0,
      stats: {
        open: tasks.filter((t) => t.status === TASK_STATUS.open).length,
        claimed: tasks.filter((t) => t.status === TASK_STATUS.claimed).length,
      },
    });
  }

  // POST /api/public/tasks/:id/claim —— 申领
  const claimMatch = tail.match(/^([A-Za-z0-9-]+)\/claim$/);
  if (req.method === 'POST' && claimMatch) {
    const session = ctx.requirePortalSession(req, res);
    if (!session) return;
    if (!ctx.requireCsrf(req, res, session)) return;
    return handleClaim(req, res, ctx, session, claimMatch[1]);
  }

  // GET /api/public/tasks/mine —— 我申领过的任务
  if (req.method === 'GET' && tail === 'mine') {
    const session = ctx.requirePortalSession(req, res);
    if (!session) return;
    const claims = (await listRows(ctx, ctx.tables.claim)).map(claimFromRow)
      .filter((claim) => ctx.ownsBusinessRef(session, claim.claimant));
    const tasks = (await listRows(ctx, ctx.tables.task)).map(taskFromRow);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    return ctx.json(res, 200, {
      ok: true,
      claims: claims.map((claim) => ({ ...claim, task: byId.has(claim.taskId) ? taskPortalView(byId.get(claim.taskId)) : null })),
    });
  }

  return false;
}

async function handleClaim(req, res, ctx, session, taskId) {
  ctx.enforceLimit(req, 'task', 20);
  const client = await ctx.getBase();
  const rows = await listRows(ctx, ctx.tables.task);
  const found = rows.map(taskFromRow).find((task) => task.id === taskId);
  if (!found) return ctx.json(res, 404, { ok: false, code: 'task_not_found', message: '任务不存在。' });
  if (found.status !== TASK_STATUS.open) {
    return ctx.json(res, 409, { ok: false, code: 'task_not_open', message: `任务当前状态为「${found.status}」，无法申领。` });
  }
  const body = await ctx.readJson(req).catch(() => ({}));
  const note = text(body?.note, TASK_DESC_MAX);
  const claimant = ctx.businessAccountRef(session);
  const claimId = makeId('TSK');
  const at = new Date().toISOString();

  // 一套表两个入口：申领写「任务申领表」，同时在「任务表」落到认领人与状态。
  await client.appendRow(ctx.tables.claim, claimRow({ id: claimId, taskId: found.id, claimant, status: TASK_STATUS.claimed, at, note }));
  await client.updateRow(ctx.tables.task, found._id, {
    状态: TASK_STATUS.claimed, 认领人: claimant, 认领时间: at,
  });
  await ctx.recordAudit?.(session, {
    action: 'task.claim', target: found.id, detail: `申领任务「${found.title}」`,
  }).catch(() => {});

  // 邮件提醒（未配置 SMTP 时静默跳过，不阻断申领）。
  let mailed = false;
  try {
    mailed = await ctx.notifyClaim?.({ task: found, claimId, note, session }) === true;
  } catch { mailed = false; }

  return ctx.json(res, 201, {
    ok: true,
    claim: { id: claimId, taskId: found.id, status: TASK_STATUS.claimed, at, note },
    mailed,
    message: `已认领「${found.title}」。`,
  });
}

/** 会员端：/api/portal/skills* */
export async function portalSkillRoutes(req, res, url, ctx) {
  const tail = decodeURIComponent(url.pathname.replace(/^\/api\/portal\/skills\/?/, ''));
  const session = ctx.requirePortalSession(req, res);
  if (!session) return;

  // GET /api/portal/skills —— 我的技能
  if (req.method === 'GET' && tail === '') {
    const rows = await listRows(ctx, ctx.tables.skill);
    const mine = rows.map(skillFromRow).filter((skill) => ctx.ownsBusinessRef(session, skill.account));
    return ctx.json(res, 200, {
      ok: true,
      skills: mine.map(skillPortalView),
      levels: SKILL_LEVELS,
      stars: ctx.accountStars?.(session) ?? 0,
    });
  }

  // POST /api/portal/skills —— 提交技能（技能 + 图片 + 必填说明）
  if (req.method === 'POST' && tail === '') {
    if (!ctx.requireCsrf(req, res, session)) return;
    return handleSkillSubmit(req, res, ctx, session);
  }

  return false;
}

async function handleSkillSubmit(req, res, ctx, session) {
  ctx.enforceLimit(req, 'skill', 10);
  const body = await ctx.readJson(req).catch(() => ({}));
  const check = validateSkillInput(body);
  if (!check.ok) {
    return ctx.json(res, 400, {
      ok: false, code: check.errors[0].code, message: check.errors[0].message, errors: check.errors,
    });
  }
  const client = await ctx.getBase();
  const existing = (await listRows(ctx, ctx.tables.skill)).map(skillFromRow)
    .filter((skill) => ctx.ownsBusinessRef(session, skill.account));
  if (existing.some((skill) => skill.name === check.value.name && skill.status === SKILL_STATUS.pending)) {
    return ctx.json(res, 409, { ok: false, code: 'skill_pending_exists', message: '同名技能已提交过，正在等待审核。' });
  }
  const skill = {
    id: makeId('SKL'),
    account: ctx.businessAccountRef(session),
    name: check.value.name,
    description: check.value.description,
    proof: text(body?.proof),
    selfStars: check.value.selfStars,
    status: SKILL_STATUS.pending,
    submittedAt: new Date().toISOString(),
  };
  await client.appendRow(ctx.tables.skill, skillRow(skill));
  return ctx.json(res, 201, { ok: true, skill: skillPortalView(skill), message: '技能已提交，等待管理员审核。' });
}

/** 控制台：/api/console/tasks* + /api/console/skills* */
export async function consoleTaskRoutes(req, res, url, ctx) {
  const path = url.pathname;
  const session = ctx.session;

  // POST /api/console/tasks —— 发布任务（发布人自评星级）
  if (path === '/api/console/tasks' && req.method === 'POST') {
    return handlePublishTask(req, res, ctx, session);
  }

  // GET /api/console/skills —— 技能审核队列
  if (path === '/api/console/skills' && req.method === 'GET') {
    const rows = await listRows(ctx, ctx.tables.skill);
    const skills = rows.map(skillFromRow);
    const queue = skills.filter((skill) => skill.status === SKILL_STATUS.pending);
    return ctx.json(res, 200, {
      ok: true,
      queue: queue.map((skill) => ({ ...skillPortalView(skill), account: skill.account })),
      reviewed: skills.filter((skill) => skill.status !== SKILL_STATUS.pending)
        .map((skill) => ({ ...skillPortalView(skill), account: skill.account })),
      levels: SKILL_LEVELS,
    });
  }

  // POST /api/console/skills/:id/review —— 审核（通过 → 写账号星级）
  const reviewMatch = path.match(/^\/api\/console\/skills\/([A-Za-z0-9-]+)\/review$/);
  if (req.method === 'POST' && reviewMatch) {
    return handleSkillReview(req, res, ctx, session, reviewMatch[1]);
  }

  return false;
}

async function handlePublishTask(req, res, ctx, session) {
  const body = await ctx.readJson(req).catch(() => ({}));
  const check = validateTaskInput(body);
  if (!check.ok) {
    return ctx.json(res, 400, {
      ok: false, code: check.errors[0].code, message: check.errors[0].message, errors: check.errors,
    });
  }
  const client = await ctx.getBase();
  const task = {
    id: makeId('TSK'),
    title: check.value.title,
    description: check.value.description,
    type: check.value.type,
    stars: check.value.stars,
    publisher: ctx.businessAccountRef(session),
    status: TASK_STATUS.open,
    publishedAt: new Date().toISOString(),
  };
  await client.appendRow(ctx.tables.task, taskRow(task));
  await ctx.recordAudit?.(session, {
    action: 'task.publish', target: task.id, detail: `发布任务「${task.title}」（${task.stars} 星）`,
  }).catch(() => {});
  return ctx.json(res, 201, { ok: true, task: taskPortalView(task), message: '任务已发布，成员可在心愿清单中认领。' });
}

async function handleSkillReview(req, res, ctx, session, skillId) {
  const body = await ctx.readJson(req).catch(() => ({}));
  const check = validateSkillReview(body);
  if (!check.ok) {
    return ctx.json(res, 400, {
      ok: false, code: check.errors[0].code, message: check.errors[0].message, errors: check.errors,
    });
  }
  const client = await ctx.getBase();
  const found = (await listRows(ctx, ctx.tables.skill)).map(skillFromRow).find((skill) => skill.id === skillId);
  if (!found) return ctx.json(res, 404, { ok: false, code: 'skill_not_found', message: '技能记录不存在。' });
  if (found.status !== SKILL_STATUS.pending) {
    return ctx.json(res, 409, { ok: false, code: 'skill_already_reviewed', message: `该技能已审核（${found.status}）。` });
  }
  const reviewer = ctx.displayName?.(session) || session.username;
  const at = new Date().toISOString();
  const approved = check.value.decision === 'approve';
  await client.updateRow(ctx.tables.skill, found._id, {
    状态: approved ? SKILL_STATUS.approved : SKILL_STATUS.rejected,
    审核人: reviewer,
    审核意见: check.value.note,
    自评星级: approved ? check.value.level : found.selfStars,
  });

  // 通过 → 星级写回账号表（取该账号已通过技能的最高星级）。
  let accountStars = 0;
  if (approved) {
    const all = (await listRows(ctx, ctx.tables.skill)).map(skillFromRow);
    accountStars = Math.max(0, ...all
      .filter((skill) => skill.account === found.account && skill.status === SKILL_STATUS.approved)
      .map((skill) => skill.selfStars), check.value.level);
    await ctx.applyAccountStars?.(found.account, accountStars, session);
  }

  await ctx.recordAudit?.(session, {
    action: approved ? 'skill.approve' : 'skill.reject',
    target: found.id,
    detail: `${approved ? '通过' : '驳回'}技能「${found.name}」`,
  }).catch(() => {});

  return ctx.json(res, 200, {
    ok: true,
    decision: check.value.decision,
    accountStars,
    message: approved ? `已通过，账号技能星级更新为 ${accountStars} 星。` : '已驳回，成员可修改后重新提交。',
  });
}

export { TASK_STATUS, SKILL_STATUS };
