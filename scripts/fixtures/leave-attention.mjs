import {workflowApprovalHash} from '../../lib/events/workflow.js';

/** Native lifecycle on synthetic in-memory services only; never connects to a business Base. */
export async function seedLeaveAttention({drafts,submissions,workflow}){
  const actor='synthetic-organizer';
  const positions=['鼓楼服务岗（一）','鼓楼摄影岗（二）','仙林引导岗（三）'].map((name,index)=>({id:'leave-position-'+index,name,date:'2030-10-23',start:'11:00',end:'15:00',campus:index===2?'仙林':'鼓楼',location:'合成服务点',capacity:'6',serviceHours:'4',trainingHours:'0',travelHours:'0',work:'合成现场服务'}));
  const content={name:'岗位请假待办提示（合成演示）',region:'nanjing',category:'生命中心',responsibleId:actor,bookingMode:'grouped',date:'2030-10-23',endDate:'2030-10-23',deadline:'2030-10-22T18:00',notice:'合成请假待办验收，可自由审批，重启后重置。',positions};
  const draft=await drafts.create({requestId:'synthetic-leave-attention',content},actor),proof=await drafts.preview(draft.id,{expectedVersion:1},actor);
  await drafts.confirmPreview(draft.id,{expectedVersion:1,digest:proof.digest},actor);
  const submitted=await submissions.submit(draft.id,{expectedVersion:1,digest:proof.digest},actor);
  const event=(await workflow.overview()).events.find(row=>row['活动ID']===submitted.activityId);
  await workflow.approve(event._id,'synthetic-super','super_admin',workflowApprovalHash(event));
  await workflow.publish(event._id,{actor:'synthetic-super'});
  const detail=await workflow.detail(event._id),jobs=detail.events.filter(row=>{try{return JSON.parse(row['报名页配置']).parentActivityId===event['活动ID'];}catch{return false;}});
  for(const [index,job] of jobs.entries())for(let person=0;person<2;person++){
    const studentId=String(999994000+index*10+person),account={accountId:`synthetic-leave-${index}-${person}`,studentId,realName:`合成${['服务','摄影','引导'][index]}同学${person+1}`,email:studentId+'@smail.nju.edu.cn',emailVerified:true,campus:index===2?'仙林':'鼓楼'};
    const row=await workflow.register(job._id,account);
    if(index===1||index===2&&person===0)await workflow.requestLeave(row['报名ID'],account,'合成课程冲突，请核对排班');
  }
  return event;
}
