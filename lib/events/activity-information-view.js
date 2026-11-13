import {workflowConfig} from './blood-roster.js';
import {activityGroupId} from '../../public/app/shared/activity-projects.js';
/** Basic activity information only; never participants, reviewer identities or mutation tokens. */
export function activityInformationView(row){
 const c=workflowConfig(row),pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]));
 return {...pick(row,['_id','活动ID','活动名称','活动类别','组织类别','活动地区','状态','报名日期','报名时段','地点','岗位','容量','服务时长','培训时长','交通时长','工作内容','通知草稿','sourceSuperseded']),groupId:activityGroupId(row),readOnly:true,
  报名页配置:JSON.stringify({...pick(c,['center','region','bookingMode','description','deadline','endDate']),
   ordinary:c.ordinary?pick(c.ordinary,['groupId','start','end','campus']):undefined,
   blood:c.blood?pick(c.blood,['mode','week','key','weekStart','start','end']):undefined,
   special:c.special?.rootId&&c.special?.week?pick(c.special,['type','rootId','week']):undefined,
   positionPlan:c.positionPlan?{groupId:c.positionPlan.groupId}:undefined,
   parentActivityId:c.parentActivityId,
   workspaceSubmission:c.workspaceSubmission?{origin:true}:undefined,
  })};
}
