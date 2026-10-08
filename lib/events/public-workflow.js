import { workflowEventApproved } from './workflow.js';
import { workflowConfig } from './blood-roster.js';
import { registrationOpen } from '../../public/app/shared/activity-management.js';

/** Project published workflow activities into the shared anonymous catalogue. */
export function projectWorkflowEvents(events, registrations, now = Date.now()) {
  return events.filter(row => registrationOpen(row, now) && workflowEventApproved(row)).map(row => {
    const config = workflowConfig(row);
    const own = registrations.filter(r => r['活动ID'] === row['活动ID']);
    const confirmed = own.filter(r => ['已确认', '已签到'].includes(r['报名状态'])).length;
    const pending = own.filter(r => r['报名状态'] === '待筛选').length;
    const capacity = Number(row['容量']) || 0;
    const remaining = Math.max(0, capacity - confirmed);
    return {
      eventId: `workflow:${row._id}`, workflowId: row._id,
      name: row['活动名称'], type: row['活动类别'], status: '报名中',
      description: row['工作内容'] || '', notice: row['通知草稿'] || '',
      startAt: config.blood?.start || `${row['报名日期']}T00:00:00+08:00`,
      endAt: config.blood?.end || null, schedule: `${row['报名日期']} ${row['报名时段']}`,
      registrationEnd: null, campus: '', location: row['地点'] || '',
      capacity, confirmed, waitlisted: 0, pending, remaining, full: confirmed + pending >= Number(config.registrationLimit ?? capacity),
      sessions: [], registrationMode: 'review',
    };
  });
}
