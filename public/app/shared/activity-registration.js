/** Derived capacity substate; it never changes the workflow phase. */
import {activityRegistrationLimit} from './activity-capacity.js';
export function registrationCapacity(event,registrations=[]){
  let config;try{config=JSON.parse(event?.['报名页配置']||'{}');}catch{return {full:false,occupied:0,capacity:0};}
  const capacity=Number(event?.['容量']);
  const ids=new Set([event?.['活动ID'],...(config.sourceActivityIds||[])]);
  const occupied=Number(config.sourceOccupied||0)+registrations.filter(row=>ids.has(row['活动ID'])&&['待筛选','已确认','已签到'].includes(row['报名状态'])).length;
  const limit=activityRegistrationLimit(event,config);
  return {capacity,occupied,full:event?.['状态']==='报名中'&&Number.isFinite(limit)&&limit>0&&occupied>=limit};
}
