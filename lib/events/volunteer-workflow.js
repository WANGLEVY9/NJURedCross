/** Exact existing NJUTable semantics. Derived readiness is never an approval. */
export const VOLUNTEER_WORKFLOW_TABLES = Object.freeze({
  applications: '登记审批', notices: '报名通知', registrations: '活动报名总表',
  checkins: '活动签到', hours: '活动及时长汇总表', exports: '志愿时长录入excel生成', profiles: '个人主页（编辑版）',
});

export function linkedRowIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => typeof item === 'string' ? item : item?.row_id).filter(id => typeof id === 'string' && id.trim()))];
}

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function hours(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (value === '' || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function registrationReadiness(row, checkinsById) {
  const confirmed = row['是否报名成功'] === true;
  const entered = row['录入状态'] === '已录入';
  const value = hours(row['志愿时长']);
  const evidenceIds = linkedRowIds(row['签到表']);
  const evidence = evidenceIds.map(id => checkinsById.get(id)).filter(Boolean);
  const verified = evidence.filter(checkin =>
    text(row['学号']) && text(checkin['学号']) === text(row['学号']) &&
    linkedRowIds(checkin['活动名称']).includes(row._id));
  const problems = [];
  if (evidenceIds.length !== verified.length) problems.push('签到关联缺失或身份/报名关联不一致');
  if (entered && !confirmed) problems.push('标记已录入但未勾选报名成功');
  if (entered && (value == null || value <= 0)) problems.push('标记已录入但缺少有效正时长');
  if (row['志愿时长'] != null && row['志愿时长'] !== '' && value == null) problems.push('时长格式无效');
  if (text(row['录入状态']) && !['已录入', '待录入'].includes(text(row['录入状态']))) problems.push('录入状态未识别');
  const state = problems.length ? '需核验' : entered ? '源表已录入' : !confirmed ? '待名单确认' : !verified.length ? '待签到核验' : value == null || value <= 0 ? '待核定时长' : '待录入';
  return { confirmed, entered, hours: value, verifiedCheckins: verified.length, evidenceIds, state, problems };
}

/** Aggregate by category/name/date, preserving legacy ambiguity instead of fuzzy joining. */
export function summarizeVolunteerWorkflow(registrations, checkins) {
  const checkinsById = new Map(checkins.map(row => [row._id, row]));
  const registrationsById = new Map(registrations.map(row => [row._id, row]));
  const states = {};
  const groups = new Map();
  let orphanCheckins = 0;
  for (const checkin of checkins) {
    const ids = linkedRowIds(checkin['活动名称']);
    if (!ids.length || ids.some(id => !registrationsById.has(id))) orphanCheckins++;
  }
  for (const row of registrations) {
    const readiness = registrationReadiness(row, checkinsById);
    states[readiness.state] = (states[readiness.state] || 0) + 1;
    const identity = [text(row['活动类别']), text(row['活动名称']), text(row['报名日期'])];
    const key = JSON.stringify(identity);
    if (!groups.has(key)) groups.set(key, { category: identity[0], name: identity[1] || '未命名活动', date: identity[2], registrations: 0, confirmed: 0, checkedIn: 0, entered: 0, pendingHours: 0, issues: 0 });
    const group = groups.get(key);
    group.registrations++;
    group.confirmed += Number(readiness.confirmed);
    group.checkedIn += Number(readiness.verifiedCheckins > 0);
    group.entered += Number(readiness.entered);
    group.pendingHours += Number(readiness.state === '待录入' || readiness.state === '待核定时长');
    group.issues += Number(readiness.problems.length > 0);
  }
  return { states, orphanCheckins, groups: [...groups.values()], registrationsWithVerifiedCheckin: [...groups.values()].reduce((sum, group) => sum + group.checkedIn, 0) };
}

/** Draft output only: re-read selected source rows, never increment profile totals. */
export function previewHoursEntry(registrations, checkins, requestedIds) {
  if (!Array.isArray(requestedIds) || !requestedIds.length || requestedIds.length > 200 || requestedIds.some(id => typeof id !== 'string' || !id)) {
    const error = new Error('请选择 1～200 条报名记录'); error.statusCode = 400; throw error;
  }
  const byId = new Map(registrations.map(row => [row._id, row]));
  const byCheckin = new Map(checkins.map(row => [row._id, row]));
  const selected = [...new Set(requestedIds)];
  const items = selected.map(id => {
    const row = byId.get(id);
    if (!row) return { registrationId: id, ready: false, reason: '报名记录不存在' };
    const readiness = registrationReadiness(row, byCheckin);
    const ready = readiness.state === '待录入' && Boolean(text(row['学号']) && text(row['姓名']) && text(row['活动名称']) && text(row['报名日期']));
    return {
      registrationId: id, ready,
      state: readiness.state, reason: ready ? '' : readiness.problems.join('；') || (readiness.state === '待录入' ? '缺少学号/姓名/活动名称/报名日期' : readiness.state),
      // Only approved console scope may receive these operational identifiers.
      ...(ready ? { studentId: text(row['学号']), name: text(row['姓名']), activity: text(row['活动名称']), date: text(row['报名日期']), slot: text(row['报名时段']), position: text(row['岗位']), hours: readiness.hours } : {}),
    };
  });
  return { mode: 'preview', writes: false, source: VOLUNTEER_WORKFLOW_TABLES.registrations, ready: items.every(item => item.ready), selected: selected.length, items, requiresManualReview: true, incrementsProfileTotals: false };
}
