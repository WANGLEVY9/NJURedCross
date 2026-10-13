/**
 * 活动候选字典（活动项目表）——内容投稿附件域与影像模块共用。
 *
 * 归属理由：两个业务域都需要「活动名必须来自活动项目表在该部门下的候选」
 * 这条同一条规则（v3 第 16 项影像 / v3.2 投稿附件），故抽为独立模块，
 * 避免两处各写一份判定而出现口径漂移。
 *
 * ctx 依赖：getBase()、tables.project。不读写任何本地状态。
 */

import { normalizeMediaCenter } from './store.js';

/**
 * 活动项目表 → 候选活动名（去重、去空，供下拉）。
 * 带上「中心」列，供「先选部门 → 活动下拉按部门过滤」使用。
 * 未填中心的旧活动（center=''）视为「未归类」，在任意部门下都可被选到（兜底）。
 */
export async function listActivityNames(ctx) {
  const client = await ctx.getBase();
  const rows = await client.listRows(ctx.tables.project, '', '', false, '', 2000);
  const names = [];
  const seen = new Set();
  for (const row of rows) {
    const name = String(row['活动名称'] || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const center = normalizeMediaCenter(row['中心']) || '';
    names.push({ name, status: String(row['状态'] || ''), center });
  }
  return names;
}

/** 某部门下的候选活动名（含未归类兜底：center 为空的老活动在任意部门都可见）。 */
export function activitiesForCenter(activities, center) {
  if (!center) return activities;
  return activities.filter((item) => !item.center || item.center === center);
}

/**
 * 活动名白名单校验：必须命中活动项目表在该部门下的候选（禁手填）。
 * 命中返回活动名；未命中抛 400（code 由调用方指定，用于区分业务域）。
 */
export async function assertActivityFromCatalog(ctx, center, activity, {
  code = 'attachment_activity_not_allowed',
  message = '',
} = {}) {
  const allowed = activitiesForCenter(await listActivityNames(ctx), center).map((item) => item.name);
  if (!allowed.includes(activity)) {
    const error = new Error(message
      || `活动「${activity}」不属于「${center}」，请从该部门的活动下拉中选择。若活动尚未登记，请先在活动项目表中建立。`);
    error.statusCode = 400;
    error.code = code;
    throw error;
  }
  return activity;
}
