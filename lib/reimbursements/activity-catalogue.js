import { workflowConfig } from '../events/blood-roster.js';
import { workflowEventApproved } from '../events/workflow.js';
import { activityKind } from '../../public/app/shared/activity-taxonomy.js';
import { reimbursementCampus, reimbursementActivityCategory } from '../../public/app/shared/reimbursement-activities.js';

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
