import { workflowEventApproved } from './workflow.js';
import { workflowConfig } from './blood-roster.js';
import {ordinaryConfig,ordinaryRegistrationOpen} from './ordinary-groups.js';

/** Project published workflow activities into the shared anonymous catalogue. */
export function projectWorkflowEvents(events, registrations) {
  const projected=events.filter(row => !row.sourceSuperseded && row['状态'] === '报名中' && workflowEventApproved(row)&&(!ordinaryConfig(row)||row.registrationControl?.published)).map(row => {
    const config = workflowConfig(row);
    const own = registrations.filter(r => [row['活动ID'],...(config.sourceActivityIds||[])].includes(r['活动ID']));
    const confirmed = own.filter(r => ['已确认', '已签到'].includes(r['报名状态'])).length;
    const pending = own.filter(r => r['报名状态'] === '待筛选').length;
    const capacity = Number(row['容量']) || 0;
    const remaining = Math.max(0, capacity - confirmed - Number(config.sourceOccupied||0) - pending);
    return {
      eventId: `workflow:${row._id}`, workflowId: row._id,
      name: row['活动名称'], type: row['活动类别'], status: '报名中',
      description: row['工作内容'] || '', notice: row['通知草稿'] || '',
      startAt: config.ordinary?.start || config.blood?.start || `${row['报名日期']}T00:00:00+08:00`,
      endAt: config.ordinary?.end || config.blood?.end || null, schedule: `${row['报名日期']} ${row['报名时段']}`,
      registrationEnd: row.registrationControl?.deadline||null, campus: config.ordinary?.campus||'', location: row['地点'] || '',
      capacity, confirmed, waitlisted: 0, pending, remaining, full: remaining === 0,
      sessions: [], registrationMode: config.ordinary?'direct':'review', blood: config.blood||null,
      ...(config.ordinary?{groupId:config.ordinary.groupId,registrationOpen:ordinaryRegistrationOpen(row),groupName:row.registrationControl?.groupName}:{}),
    };
  });
  const output=[],groups=new Map();
  for(const item of projected){if(!item.groupId){output.push(item);continue;}const group=groups.get(item.groupId);if(group)group.push(item);else groups.set(item.groupId,[item]);}
  for(const [groupId,items]of groups){items.sort((a,b)=>a.startAt.localeCompare(b.startAt)||a.location.localeCompare(b.location));const first=items[0];output.push({...first,name:first.groupName||first.name,groupId,capacity:items.reduce((n,x)=>n+x.capacity,0),remaining:items.reduce((n,x)=>n+x.remaining,0),confirmed:items.reduce((n,x)=>n+x.confirmed,0),pending:items.reduce((n,x)=>n+x.pending,0),full:items.every(x=>x.full),registrationOpen:items.some(x=>x.registrationOpen),status:items.some(x=>x.registrationOpen)?'报名中':'报名暂停',endAt:items.reduce((end,x)=>x.endAt>end?x.endAt:end,first.endAt),location:[...new Set(items.map(x=>x.location))].join(' / '),campus:[...new Set(items.map(x=>x.campus))].join(' / '),schedule:`${first.startAt.slice(0,10)} — ${items.at(-1).startAt.slice(0,10)}`,sessions:items.map(x=>({sessionId:x.workflowId,startAt:x.startAt,endAt:x.endAt,location:x.location,capacity:x.capacity,remaining:x.remaining,full:x.full}))});}
  return output;
}
