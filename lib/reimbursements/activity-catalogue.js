import { workflowConfig } from '../events/blood-roster.js';
import { workflowEventApproved } from '../events/workflow.js';
import { activityKind } from '../../public/app/shared/activity-taxonomy.js';
import { reimbursementCampus, reimbursementActivityCategory } from '../../public/app/shared/reimbursement-activities.js';

/**
 * 排班表把时分写在时间字符串里（`2026-11-19T10:00:00+08:00`）。直接取字面时分，
 * 不做时区换算：字符串本身已经是本地时间，再按 UTC 解析会整体偏移一次。
 * `00:00` 表示只登记了日期、没有具体时段，留空以免下拉里出现无意义的零点。
 */
export function activityTimeSlot(value) {
  const match = /(?:^|[T\s])(\d{1,2}):(\d{2})/.exec(String(value || ''));
  if (!match) return '';
  const hour = Number(match[1]), minute = Number(match[2]);
  if (hour > 23 || minute > 59) return '';
  const slot = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return slot === '00:00' ? '' : slot;
}

/** Finance can reference approved ended activities; this does not reopen public registration. */
export function reimbursementActivityCatalogue(publicEvents, workflowEvents, isApproved = workflowEventApproved) {
  const events = new Map(publicEvents.map(event => [String(event.eventId || event.id), { ...event,
    category: reimbursementActivityCategory(event), campus: event.campus || reimbursementCampus(event.region)
      || reimbursementCampus(event.category) || reimbursementCampus(event.activityCategory) || reimbursementCampus(event.type) }]));
  for (const row of workflowEvents) {
    if (row.sourceSuperseded || !['报名中', '进行中', '已结束', '已完成', '已归档'].includes(row['状态']) || !isApproved(row)) continue;
    const config = workflowConfig(row), id = `workflow:${row._id}`;
    const group = config.ordinary?.groupId;
    const publicGroup = group && [...events.values()].find(event => event.groupId === group);
    const key = publicGroup?.eventId || (group ? `workflow-group:${group}` : id);
    if (events.has(key)) continue;
    const region = row['活动地区'] || config.region || '';
    const participantCount = Number(config.participantCount ?? row['活动人数']);
    const campus = config.ordinary?.campus || row['校区'] || reimbursementCampus(region) || (row['活动类别'] === '苏州分部' ? '苏州' : '');
    events.set(key, { eventId: key, name: config.ordinary?.groupName || row['活动名称'],
      center: row['组织类别'] || config.center || '', type: row['活动类别'],
      category: activityKind({ center: row['组织类别'] || config.center, type: row['活动类别'] }), campus,
      startAt: config.ordinary?.start || config.blood?.start || config.window?.start || row['报名日期'] || '',
      location: row['地点'] || '', description: row['活动简介'] || row['工作内容'] || '',
      participantCount: Number.isSafeInteger(participantCount) && participantCount > 0 ? participantCount : null });
  }
  return [...events.values()].map(event => ({ ...event, category: event.category || activityKind(event),
    campus: ['仙林', '鼓楼', '浦口', '南京', '苏州'].includes(event.campus) ? event.campus : reimbursementCampus(event.campus) || reimbursementCampus(event.region),
  }));
}

/**
 * 目录对同一个活动会换 id：补上项目分组前是 `workflow:<行ID>`，分组后变成
 * `workflow-group:<项目ID>`，公开可见性一变又可能换成首行 ID。持久化状态只做
 * upsert，旧 id 会一直留着，前端下拉就把同一活动列两遍。
 *
 * 只淘汰「目录当前已经用另一个 id 列出的同一活动」，因此暂时不可见的活动
 * （报名暂停、退回待审等）不会被删掉，财务仍可照常报销。仍被申请引用的条目
 * 一律保留，否则老申请的补充提交取不到活动名。
 */
export function retireSupersededActivities(activities, live, referenced = new Set()) {
  const shown = new Set();
  for (const activity of live.values()) shown.add(`${activity.name}|${activity.date || ''}`);
  for (const [id, activity] of activities)
    if (activity?.catalogSource === true && !live.has(id) && !referenced.has(id)
      && shown.has(`${activity.name}|${activity.date || ''}`)) activities.delete(id);
}
