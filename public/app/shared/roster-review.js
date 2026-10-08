/** Runtime roster state uses the existing event configuration; no extra table columns. */
export function rosterReview(event) {
  try { return JSON.parse(event?.['报名页配置'] || '{}').rosterReview || null; } catch { return null; }
}
export function rosterRow(event, row) {
  const draft = rosterReview(event)?.drafts?.[row._id];
  return draft && row['报名状态']!=='已请假' ? {...row, 报名状态: {confirm:'已确认',reject:'未入选',reset:'待筛选'}[draft.decision], 处理说明:draft.reason || '', rosterDraft:true} : {...row};
}
export function publishedRosterRow(event, row) {
  const review = rosterReview(event);
  // During a recoverable multi-row commit, expose only the preceding published snapshot.
  if (review?.phase !== 'publishing') return row;
  const published = review.published?.[row._id];
  return {...row, 报名状态:published?.status || '待筛选', 是否报名成功:published && published.status !== '未入选' ? 'true' : 'false', 处理说明:published?.reason || ''};
}
export function rosterMailKey(row, published) {
  return `WF-RESULT:${row['报名ID']}:${(published?.status || row['报名状态']) === '未入选' ? 'no' : 'yes'}${published?.version ? ':' + published.version : ''}`;
}
