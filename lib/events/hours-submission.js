import {activityProjectKey,projectEvents} from '../../public/app/shared/activity-projects.js';
import {hoursReadiness,supportsHoursSubmission} from '../../public/app/shared/hours-submission.js';

const fail=message=>Object.assign(new Error(message),{statusCode:409});
export function createHoursSubmission({store,read,write,evidence,assertReviewer=async()=>{},strictReview=false,now=()=>Date.now()}){
 const key=activityProjectKey;
 const state=(all,event)=>all[key(event)]||{revision:0,phase:'draft',absences:{}};
 async function context(id){
  const data=await read(),event=data.events.find(row=>row._id===id||row['活动ID']===id);
  if(!event)throw fail('活动不存在');
  const events=projectEvents(data.events,event).filter(row=>supportsHoursSubmission(row)===supportsHoursSubmission(event)),ids=new Set(events.flatMap(row=>[row['活动ID'],...JSON.parse(row['报名页配置']||'{}').sourceActivityIds||[]]));
  const registrations=data.registrations.filter(row=>ids.has(row['活动ID']));
  const ledger=data.ledger.filter(row=>ids.has(row['活动ID']));
  const current=state(await store.read(),event);
  return {data,event,events,registrations,ledger,current,...hoursReadiness(registrations,ledger,current)};
 }
 return {
  async projectHoursState(events){const all=await store.read();return events.map(event=>supportsHoursSubmission(event)?({...event,hoursSubmission:state(all,event)}):event);},
  async assertHoursUnlocked(event){if(!supportsHoursSubmission(event))return {revision:0,phase:'draft',absences:{}};const current=state(await store.read(),event);if(current.phase==='submitted'||event['状态']==='已结束')throw fail('时长表已提交或活动已结束；请先由指定审核人退回再修改');return current;},
  async assertHoursReviewable(event){if(!supportsHoursSubmission(event))return;const current=state(await store.read(),event);if((strictReview||current.revision)&&current.phase!=='submitted')throw fail('时长表已退回或尚未提交，请等待负责人重新提交');if(event['状态']==='已结束')throw fail('活动已结束，不能修改时长审核结果');},
  async assertHoursSubmitted(id){const c=await context(id);if(c.current.phase!=='submitted')throw fail('请先由负责人完整处理名单并提交整份时长表');return c;},
  hoursSubmissionStatus:context,
  markHoursAbsence:(id,registrationId,reason,revision,actor)=>write(async()=>{
   const c=await context(id);
   if(!supportsHoursSubmission(c.event))throw fail('自动生成献血车班次保留原流程，不使用整表提交');
   if(c.current.phase==='submitted'||!['报名中','进行中','停点'].includes(c.event['状态']))throw fail('当前时长表不能修改到场情况');
   const row=c.required.find(row=>row._id===registrationId);
   if(!row||row['请假状态']==='待审批'||row['是否报名成功']!=='true')throw fail('请选择当前活动中无待审批请假的录取人员');
   if(row['报名状态']==='已签到'||c.ledger.some(entry=>entry['报名行ID']===registrationId))throw fail('已有签到或时长记录，不能标记缺席');
   if(reason!==null&&(typeof reason!=='string'||!reason.trim()||reason.length>500))throw fail('请填写不超过500字的缺席说明');
   return store.update(key(c.event),revision,current=>{
    if(current.phase==='submitted')throw fail('时长表已提交');
    const absences={...current.absences};if(reason===null)delete absences[registrationId];else absences[registrationId]={reason:reason.trim(),actor,at:new Date(now()).toISOString()};
    return {...current,absences};
   });
  }),
  submitHoursSheet:(id,revision,actor)=>write(async()=>{
   const c=await context(id);
   if(!supportsHoursSubmission(c.event))throw fail('自动生成献血车班次保留原流程，不使用整表提交');
   if(!c.events.some(event=>['进行中','停点'].includes(event['状态']))||c.events.some(event=>event['状态']==='报名中'))throw fail('请先截止整个活动的报名，再提交时长表');
   if(c.current.phase==='submitted')throw fail('时长表已经提交，请勿重复提交');
   if(c.pending.length)throw fail(`还有 ${c.pending.length} 人未处理，请先完善时长、请假或缺席记录`);
   for(const entry of c.ledger){
    if(!c.required.some(row=>row._id===entry['报名行ID']))throw fail('时长记录与当前有效名单不一致，请先核对');
    await evidence(entry['报名行ID'],c.data).then(source=>source.assertEntry(entry));
   }
   return store.update(key(c.event),revision,current=>({...current,phase:'submitted',submittedBy:actor,submittedAt:new Date(now()).toISOString(),returnReason:''}));
  }),
  returnHoursSheet:(id,revision,reason,actor)=>write(async()=>{
   const c=await context(id);
   if(!supportsHoursSubmission(c.event))throw fail('自动生成献血车班次保留原流程，不使用整表提交');
   if(c.current.phase!=='submitted'||c.events.some(event=>event['状态']==='已结束'))throw fail('仅审核中的时长表可以退回');
   for(const event of c.events)await assertReviewer(event,actor);
   if(typeof reason!=='string'||!reason.trim()||reason.length>500)throw fail('请填写不超过500字的退回原因');
   return store.update(key(c.event),revision,current=>({...current,phase:'returned',returnedBy:actor,returnedAt:new Date(now()).toISOString(),returnReason:reason.trim()}));
  }),
 };
}
