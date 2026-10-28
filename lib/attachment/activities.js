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
 * 活动广场分类 → 投稿归档部门。
 *
 * 两套字典本来不是一回事：
 *   · 活动广场按「活动归属」分 7 类（public/app/shared/activity-taxonomy.js 的
 *     ACTIVITY_CATEGORY_OPTIONS）：主席团专项/博爱中心/生命中心/综事中心/
 *     排班专项/一加助残专项/献血车专项。
 *   · 投稿与影像按「归档部门」分 4 类（store.js 的 MEDIA_CENTERS）：
 *     生命中心/博爱中心/综事中心/主席团活动。
 *
 * 活动项目表的「中心」列由运营填写，既可能写部门名也可能写活动分类名，
 * 所以读取时先按部门白名单直取，取不到再经此表翻译。
 *
 * 2026-10-28 定案：**排班专项并入主席团活动**（此前未映射=未归类，导致这类活动
 * 进不了投稿下拉）。至此 7 个分类全部有落点，只剩「组织类别为空 / 已停用旧标签」
 * 会落到未归类并被跨库来源跳过。
 */
export const ACTIVITY_CATEGORY_TO_CENTER = Object.freeze({
  主席团专项: '主席团活动',
  排班专项: '主席团活动',
  博爱中心: '博爱中心',
  生命中心: '生命中心',
  综事中心: '综事中心',
  献血车专项: '博爱中心',
  一加助残专项: '博爱中心',
});

/** 把「中心」列取值解析成归档部门：先白名单直取，再按活动分类映射翻译，都不是则未归类。 */
export function resolveMediaCenter(value) {
  const direct = normalizeMediaCenter(value);
  if (direct) return direct;
  const key = String(value ?? '').trim();
  return normalizeMediaCenter(ACTIVITY_CATEGORY_TO_CENTER[key] || '');
}

/**
 * 活动项目表 → 候选活动名（去重、去空，供下拉）。
 * 带上「中心」列，供「先选部门 → 活动下拉按部门过滤」使用。
 * 未填中心、或填了无法映射的分类（center=''）视为「未归类」，在任意部门下都可被选到（兜底）。
 */
async function localActivityNames(ctx) {
  const client = await ctx.getBase();
  const rows = await client.listRows(ctx.tables.project, '', '', false, '', 2000);
  const names = [];
  const seen = new Set();
  for (const row of rows) {
    const name = String(row['活动名称'] || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const center = resolveMediaCenter(row['中心']);
    names.push({ name, status: String(row['状态'] || ''), center });
  }
  return names;
}

/**
 * 投稿/影像的活动候选 = 本库「活动项目表」 + 志愿服务平台的「已结束活动」。
 *
 * 两个数据源在两个不同的 SeaTable Base：
 *   · 本库「活动项目表」：运营显式登记，优先级最高（center 以它为准）；
 *   · 志愿服务平台「网站活动流程表」经 ctx.workflowActivities 注入，取已结束的活动。
 * ctx 没提供该能力、或它读取失败时，退化为只读本库——行为与改动前一致。
 *
 * 跨库活动必须能落到某个部门才接入：它的「组织类别」若为空、或指向已停用的分类
 * （例如历史上用过、现已不再维护的「公益活动」），resolveMediaCenter 会返回空，
 * 这类活动直接跳过——用户定案「不属于任何标签的活动不需要连接」。
 * 本库「活动项目表」仍保留「未归类在老活动上任意部门可见」的兜底，那是运营显式登记的。
 */
export async function listActivityNames(ctx) {
  const [local, remote] = await Promise.all([
    localActivityNames(ctx),
    typeof ctx?.workflowActivities === 'function'
      ? ctx.workflowActivities().catch(() => [])
      : Promise.resolve([]),
  ]);
  const merged = [...local];
  const seen = new Set(local.map((item) => item.name));
  for (const item of remote) {
    const name = String(item?.name || '').trim();
    if (!name || seen.has(name)) continue;
    const center = resolveMediaCenter(item?.center);
    if (!center) continue;
    seen.add(name);
    // 2026-10-27：进行中的活动也能投稿，状态原样透传（前端据此显示「进行中」）。
    const status = String(item?.status || '').trim() || '已结束';
    merged.push({ name, status, center });
  }
  return merged;
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
