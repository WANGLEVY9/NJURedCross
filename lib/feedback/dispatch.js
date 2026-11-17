/* ==========================================================================
   dispatch.js — problem-feedback business-domain mapping.
   Maps a feedback 分类 (category) to the responsible 业务域 (department).
   The mapping is a replaceable configuration function: code carries no hard
   account identities, so the team can re-point a category to a different
   department (or load the mapping from a config table) without touching the
   service. Until the unified department enum lands, the defaults mirror the
   centres in lib/events/service-context.js.
   ========================================================================== */

export const FEEDBACK_CATEGORIES = Object.freeze(['注册', '登录', '资料', '报名', '时长', 'Bug', '其他']);
export const FEEDBACK_SOURCE = Object.freeze({ PORTAL: '公众端', CONSOLE: '管理端' });

const DEFAULT_CATEGORY_DOMAIN = Object.freeze({
  '注册': '综事中心',
  '登录': '综事中心',
  '资料': '综事中心',
  '报名': '综事中心',
  '时长': '生命中心',
  'Bug': '综事中心',
  '其他': '综事中心',
});

export function categoryDomain(category, mapping = DEFAULT_CATEGORY_DOMAIN) {
  return mapping[String(category || '')] || '综事中心';
}

export function feedbackDomainOptions(mapping = DEFAULT_CATEGORY_DOMAIN) {
  return FEEDBACK_CATEGORIES.map((category) => ({ category, domain: categoryDomain(category, mapping) }));
}
