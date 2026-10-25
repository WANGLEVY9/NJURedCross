import {registrationOpen} from '../../public/app/shared/activity-management.js';
import {workflowEventApproved} from './workflow.js';
import {workflowConfig} from './blood-roster.js';
import {ordinaryConfig,ordinaryRegistrationOpen,publicOrdinarySession} from './ordinary-groups.js';

/** Project links resolve only to sessions that already passed publication gates. */
export function publicWorkflowEvents(data,now=Date.now()){
 const counts=new Map(),ids=new Map(data.events.map(e=>[e['活动ID'],e._id]));
 for(const r of data.registrations)if(['待筛选','已确认','已签到'].includes(r['报名状态']))counts.set(r['活动ID'],(counts.get(r['活动ID'])||0)+1);
 return data.events.filter(row=>!row.sourceSuperseded&&row['状态']==='报名中'&&(!workflowConfig(row).publishAt||Number.isFinite(Date.parse(workflowConfig(row).publishAt))&&Date.parse(workflowConfig(row).publishAt)<=now)&&workflowEventApproved(row)&&(ordinaryConfig(row)||registrationOpen(row,now))&&(!ordinaryConfig(row)||row.registrationControl?.published)).map(row=>{
  const c=workflowConfig(row),ordinary=ordinaryConfig(row),capacity=Number(row['容量']);
  const occupied=[...new Set([row['活动ID'],...(c.sourceActivityIds||[])])].reduce((n,id)=>n+(counts.get(id)||0),0);
  return {id:row._id,name:row['活动名称'],date:row['报名日期'],slot:row['报名时段'],position:row['岗位'],location:row['地点'],capacity,recommended:c.recommended||null,
   remaining:Math.max(0,capacity-Number(c.sourceOccupied||0)-occupied),quotaMode:c.registrationLimit!==undefined&&!ordinary&&!c.blood?'review':null,
   full:(counts.get(row['活动ID'])||0)>=Number(c.registrationLimit??row['容量']),work:row['工作内容']||'',notice:row['通知草稿'],blood:c.blood||null,
   ...(ordinary?{ordinary:publicOrdinarySession(row),parentEventId:ids.get(c.parentActivityId)||null,registrationEnd:row.registrationControl?.deadline||null,registrationOpen:ordinaryRegistrationOpen(row,now)}:{})};
 });
}
