import { createRegistrationCounter } from './registration-counts.js';
import {registrationOpen} from '../../public/app/shared/activity-management.js';
import { workflowEventApproved } from './workflow.js';
import { workflowConfig } from './blood-roster.js';
import {ordinaryConfig,ordinaryRegistrationOpen} from './ordinary-groups.js';
import {flexibleCapacity,activityRegistrationLimit} from '../../public/app/shared/activity-capacity.js';

/** Closed registration must not hide an approved running or completed activity. */
function publiclyListedWorkflowEvent(row, now) {
  const config=workflowConfig(row);
  if (row.sourceSuperseded || !workflowEventApproved(row) || config.bookingMode === 'grouped') return false;
  if (config.publishAt && (!Number.isFinite(Date.parse(config.publishAt)) || Date.parse(config.publishAt) > now)) return false;
  if(config.blood)return registrationOpen(row,now);
  if (['进行中','已结束'].includes(row['状态'])) return true;
  return row['状态'] === '报名中' && (ordinaryConfig(row) ? Boolean(row.registrationControl?.published) : registrationOpen(row,now));
}

export function publiclyListedWorkflowEvents(events, now=Date.now()) {
  const plans=new Map(events.filter(row=>workflowConfig(row).positionPlan).map(row=>[row['活动ID'],workflowConfig(row).positionPlan]));
  return events.filter(row=>{
    const plan=plans.get(workflowConfig(row).parentActivityId);
    // Removed positions are marked ended too; only the current plan is public.
    return (!plan || plan.eventIds?.includes(row['活动ID'])) && publiclyListedWorkflowEvent(row,now);
  });
}

function groupStatus(items) {
  if (items.some(item=>item.status==='报名中')) return items.some(item=>item.registrationOpen)?'报名中':'报名暂停';
  return items.some(item=>item.status==='进行中')?'进行中':'已结束';
}

/** Project published workflow activities into the shared anonymous catalogue. */
export function projectWorkflowEvents(events, registrations, now=Date.now()) {
  let countRegistrations;
  const projected=publiclyListedWorkflowEvents(events,now).map(row => {
    const config = workflowConfig(row);
    countRegistrations ||= createRegistrationCounter(registrations);
    const { confirmed, pending } = countRegistrations([row['活动ID'], ...(config.sourceActivityIds || [])]);
    const capacity = Number(row['容量']) || 0;
    const remaining = Math.max(0, capacity - confirmed - Number(config.sourceOccupied||0) - pending);
    return {
      eventId: `workflow:${row._id}`, workflowId: row._id,
      name: row['活动名称'], type: row['活动类别'], status: row['状态'],
      center: row['组织类别'] || config.center || '', region: row['活动地区'] || config.region || '',
      description: row['工作内容'] || '', notice: row['通知草稿'] || '',
      startAt: config.ordinary?.start || config.blood?.start || config.window?.start || `${row['报名日期']}T00:00:00+08:00`,
      endAt: config.ordinary?.end || config.blood?.end || config.window?.end || null, schedule: config.window?row['报名时段']:`${row['报名日期']} ${row['报名时段']}`,
      registrationEnd: row.registrationControl?.deadline||null, campus: config.ordinary?.campus||'', location: row['地点'] || '',
      capacity, confirmed, waitlisted: 0, pending, remaining, full: confirmed+pending+Number(config.sourceOccupied||0)>=(flexibleCapacity(config.flexibleCapacity)>0?activityRegistrationLimit(row,config):Number(config.registrationLimit??capacity)),
      sessions: [], registrationMode: config.ordinary&&!flexibleCapacity(config.flexibleCapacity)?'direct':'review', blood: config.blood||null,
      ...(flexibleCapacity(config.flexibleCapacity)>0?{flexibleRegistration:true}:{}),
      registrationOpen: row['状态']==='报名中' && (config.ordinary?ordinaryRegistrationOpen(row,now):registrationOpen(row,now)),
      ...(config.ordinary?{groupId:config.ordinary.groupId,groupName:row.registrationControl?.groupName}:{}),
    };
  });
  const output=[],groups=new Map();
  for(const item of projected){if(!item.groupId){output.push(item);continue;}const group=groups.get(item.groupId);if(group)group.push(item);else groups.set(item.groupId,[item]);}
  for(const [groupId,items]of groups){items.sort((a,b)=>a.startAt.localeCompare(b.startAt)||a.location.localeCompare(b.location));const first=items[0];output.push({...first,name:first.groupName||first.name,groupId,...(items.some(x=>x.flexibleRegistration)?{flexibleRegistration:true}:{}),capacity:items.reduce((n,x)=>n+x.capacity,0),remaining:items.reduce((n,x)=>n+x.remaining,0),confirmed:items.reduce((n,x)=>n+x.confirmed,0),pending:items.reduce((n,x)=>n+x.pending,0),full:items.every(x=>x.full),registrationOpen:items.some(x=>x.registrationOpen),status:groupStatus(items),endAt:items.reduce((end,x)=>x.endAt>end?x.endAt:end,first.endAt),location:[...new Set(items.map(x=>x.location))].join(' / '),campus:[...new Set(items.map(x=>x.campus))].join(' / '),schedule:`${first.startAt.slice(0,10)} — ${items.at(-1).startAt.slice(0,10)}`,sessions:items.map(x=>({sessionId:x.workflowId,startAt:x.startAt,endAt:x.endAt,location:x.location,capacity:x.capacity,remaining:x.remaining,full:x.full}))});}
  return output;
}
