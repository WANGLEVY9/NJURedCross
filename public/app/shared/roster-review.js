/** Runtime roster state uses the existing event configuration; no extra table columns. */
export function rosterReview(event) {
  try { return JSON.parse(event?.['报名页配置'] || '{}').rosterReview || null; } catch { return null; }
}
const RESULT_CODES = { 已确认: 'Y', 已签到: 'Q', 未入选: 'N' };
const CODE_RESULTS = { Y: '已确认', Q: '已签到', N: '未入选' };
/**
 * 审核结果原先是 `{status, reason, version}`，每条约 100 字符。报名页配置只有 10000 字符，
 * 150 人的活动在审核途中就被撑爆，整份配置再也写不进去。新格式压成一个短串：
 * `Y<version>` / `N<version>|<reason>`，理由只在「未入选」且确实写了的时候才存
 * （报名行的处理说明里本来就有）。读取必须同时接受两种格式，历史活动才不会错位。
 */
export function decodeRosterResult(entry, row) {
  if (!entry) return null;
  if (typeof entry === 'object') return { status: entry.status || '', reason: entry.reason ?? '', version: entry.version || '' };
  const status = CODE_RESULTS[String(entry)[0]];
  if (!status) return null;
  const rest = String(entry).slice(1), bar = rest.indexOf('|');
  return { status, version: bar < 0 ? rest : rest.slice(0, bar),
    reason: bar < 0 ? row?.['处理说明'] || '' : rest.slice(bar + 1) };
}
export function encodeRosterResult({ status, reason, version } = {}, { withReason = true } = {}) {
  const code = RESULT_CODES[status];
  if (!code) return '';
  const tail = version || '';
  return withReason && code === 'N' ? `${code}${tail}|${reason || ''}` : `${code}${tail}`;
}
export function rosterRow(event, row) {
  const draft = rosterReview(event)?.drafts?.[row._id];
  return draft && row['报名状态']!=='已请假' ? {...row, 报名状态: {confirm:'已确认',reject:'未入选',reset:'待筛选'}[draft.decision], 处理说明:draft.reason || '', rosterDraft:true} : {...row};
}
export function publishedRosterRow(event, row) {
  const review = rosterReview(event);
  // During a recoverable multi-row commit, expose only the preceding published snapshot.
  if (review?.phase !== 'publishing') return row;
  const published = decodeRosterResult(review.published?.[row._id], row);
  // 发布阶段不再保留上一版快照（target 已是全量，存双份会撑爆 10000 字符的配置）。
  // 因此这里回落到中性的「待筛选」，绝不暴露写了一半的新结果。
  return {...row, 报名状态:published?.status || '待筛选', 是否报名成功:published && published.status !== '未入选' ? 'true' : 'false', 处理说明:published?.reason || ''};
}
export function rosterMailKey(row, published) {
  const entry = decodeRosterResult(published, row);
  return `WF-RESULT:${row['报名ID']}:${(entry?.status || row['报名状态']) === '未入选' ? 'no' : 'yes'}${entry?.version ? ':' + entry.version : ''}`;
}
