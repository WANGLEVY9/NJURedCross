import {createHash} from 'node:crypto';
import {workflowConfig} from './blood-roster.js';
import {newPositionId,normalizePositions} from './project-positions.js';
import {activityRegistrationLimit} from '../../public/app/shared/activity-capacity.js';
import {sessionWindows} from './ordinary-groups.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(message,code='workspace_edit_conflict')=>Object.assign(new Error(message),{statusCode:409,code});
const occupies=r=>['待筛选','已确认','已签到'].includes(r['报名状态'])&&r['请假状态']!=='已批准';
const rowFields=['活动名称','活动类别','组织类别','活动地区','负责人账号ID','报名日期','报名时段','岗位','容量','服务时长','培训时长','交通时长','地点','工作内容'];
const windowDigest=windows=>hash((windows||[]).map(({start,end})=>[start,end]).sort(([a],[b])=>a.localeCompare(b)));
const sameJob=(existing,next,priorDeadline)=>{
 const a=workflowConfig(existing),b=workflowConfig(next);
 return rowFields.every(key=>String(existing[key]??'')===String(next[key]??''))
  && hash([a.ordinary?.campus,a.flexibleCapacity||0,a.coOwners||[],a.registrationContact||null,a.registrationDeadline||priorDeadline])
   ===hash([b.ordinary?.campus,b.flexibleCapacity||0,b.coOwners||[],b.registrationContact||null,b.registrationDeadline]);
};
export function workspaceBeforeStart(event,now=Date.now()){
 const c=workflowConfig(event),starts=(c.positionPlan?.positions||c.positionDraft?.positions||[]).map(p=>p.start);
 if(!starts.length)starts.push(c.window?.start);
 return starts.length>0&&starts.every(value=>Number.isFinite(Date.parse(value))&&Date.parse(value)>now);
}
/** Pure plan: stable event and booking identities, with no external writes. */
export function planWorkspaceLiveEdit({event,data,prepared,content,actor,now,prepare,approvalHash,legacyRecovery}){
 const old=workflowConfig(event),fresh=workflowConfig(prepared),version=String(Number(event['申请版本'])+1);
 const children=data.events.filter(e=>workflowConfig(e).parentActivityId===event['活动ID']),ids=new Set([event['活动ID'],...children.map(e=>e['活动ID'])]);
 const bookings=data.registrations.filter(r=>ids.has(r['活动ID']));
 if(!workspaceBeforeStart(event,now)||!workspaceBeforeStart(prepared,now))throw fail('活动已开始或修改后的时间已过，不能修改');
 if(data.ledger.some(r=>ids.has(r['活动ID']))||old.runningReview?.status==='submitted'||old.finalHours?.status==='exported')throw fail('已有时长记录、提交审核或最终时长记录，不能改写活动安排');
 if(old.bookingMode!==content.bookingMode&&bookings.length)throw fail('已有报名记录，不能切换单岗位与多岗位；现有岗位信息仍可修改');
 const c={...old,...fresh,workspaceSubmission:old.workspaceSubmission,lastEditor:actor};delete c.workspaceEdit;
 if(old.flexibleCapacity!==undefined&&fresh.flexibleCapacity===undefined){delete c.flexibleCapacity;c.registrationLimit=fresh.registrationLimit??fresh.capacity;}
 delete c.positionDraft;delete c.positionPlan;delete c.runningReview;delete c.finalHours;
 // Full before/after evidence lives in the durable edit receipt, not a text cell.
 c.workspaceEdits=[...(old.workspaceEdits||[]).slice(-9).map(({actor,at,version})=>({actor,at,version})),{actor,at:new Date(now).toISOString(),version}];
 const groupId=old.positionPlan?.groupId||'PROJECT-'+event['活动ID'];
 const jobs=[];
 if(content.bookingMode==='grouped'){
  const positions=normalizePositions(fresh.positionDraft.positions,fresh.window),oldIds=old.positionPlan?.eventIds||[];
  const eventIds=content.positions.map(p=>{
   if(p.id.startsWith('jobref-')){
    const saved=p.id.slice(7);
    if(!oldIds.includes(saved))throw fail('岗位不属于当前活动，请重新载入');
    return saved;
   }
   const legacy=/^source-(\d+)$/.exec(p.id);
   return (legacy&&oldIds[Number(legacy[1])])||newPositionId();
  });
  if(new Set(eventIds).size!==eventIds.length)throw fail('岗位关联重复，请重新载入后修改');
  const inputHash=hash({positions,deadline:fresh.registrationDeadline});
  c.positionPlan={positions:legacyRecovery?positions:positions.map((p,i)=>({...p,positionId:eventIds[i]})),deadline:fresh.registrationDeadline,eventIds,groupId,inputHash,complete:true,actor};
  for(const [i,p]of positions.entries()){
   const existing=children.find(e=>e['活动ID']===eventIds[i]);
   const row=prepare({name:content.name,center:content.category,region:fresh.region,date:p.start.slice(0,10),slot:p.start.slice(11,19)+'-'+p.end.slice(11,19),position:p.name,location:p.location,capacity:p.capacity,...(p.flexibleCapacity!==undefined?{flexibleCapacity:p.flexibleCapacity}:{}),work:p.work||fresh.work,serviceHours:p.serviceHours??fresh.service,trainingHours:p.trainingHours??fresh.training,travelHours:p.travelHours??fresh.travel,ordinary:{groupId,start:p.start,end:p.end,campus:p.campus,hoursPending:false}});
   const childConfig={...(existing?workflowConfig(existing):{}),...workflowConfig(row),coOwners:fresh.coOwners||[],registrationContact:fresh.registrationContact,workspaceResponsibleName:fresh.workspaceResponsibleName,workspaceResponsibleNames:fresh.workspaceResponsibleNames,parentActivityId:event['活动ID'],parentPlan:inputHash,approval:c.approval,positionWork:p.work||fresh.work,positionHours:{serviceHours:p.serviceHours??fresh.service,trainingHours:p.trainingHours??fresh.training,travelHours:p.travelHours??fresh.travel},registrationDeadline:fresh.registrationDeadline};
   if(existing&&workflowConfig(existing).flexibleCapacity!==undefined&&p.flexibleCapacity===undefined){delete childConfig.flexibleCapacity;childConfig.registrationLimit=p.capacity;}
   if(existing){
    const current=workflowConfig(existing),prior=current.ordinary;
    // The editor may omit the campus on a legacy job. Preserve the original
    // session window when the submitted date/time match it, instead of
    // regenerating a different window from the project-wide fallback.
    if(!p.campus&&prior&&p.date&&p.start&&p.end){
     const start=`${p.date}T${p.start}:00+08:00`,end=`${p.date}T${p.end}:00+08:00`;
     if(start===prior.start&&end===prior.end)childConfig.ordinary={...childConfig.ordinary,...prior};
    }
   }
   Object.assign(row,{活动ID:eventIds[i],负责人账号ID:content.responsibleId,申请版本:version,批准版本:version,审批人:actor,审批时间:new Date(now).toISOString(),状态:event['状态'],报名页配置:JSON.stringify(childConfig)});
   for(const key of Object.keys(row))row[key]=String(row[key]??'');row['批准摘要']=approvalHash(row);
   const unchanged=legacyRecovery===undefined&&existing&&sameJob(existing,row,old.positionPlan?.deadline||old.registrationDeadline);
   jobs.push({existing,row:unchanged?existing:row,unchanged});
  }
 }
 const activeIds=new Set(old.positionPlan?.eventIds||[]);
 const removed=children.filter(e=>activeIds.has(e['活动ID'])&&!['已归档','已结束'].includes(e['状态'])&&!jobs.some(job=>job.row['活动ID']===e['活动ID']));
 if(bookings.some(r=>removed.some(e=>e['活动ID']===r['活动ID'])))throw fail('已有报名的岗位不能移除，请保留岗位并修改安排');
 const parentPatch={...prepared,活动ID:event['活动ID'],创建时间:event['创建时间'],状态:event['状态'],申请版本:version,批准版本:version,审批人:actor,审批时间:new Date(now).toISOString(),报名页配置:JSON.stringify(c)};
 delete parentPatch._id;for(const key of Object.keys(parentPatch))parentPatch[key]=String(parentPatch[key]??'');parentPatch['批准摘要']=approvalHash({...event,...parentPatch});
 const effective=content.bookingMode==='grouped'?jobs.map(job=>job.row):[{...event,...parentPatch}];
 for(const job of effective)if(bookings.filter(r=>r['活动ID']===job['活动ID']&&occupies(r)).length+Number(workflowConfig(job).sourceOccupied||0)>activityRegistrationLimit(job))throw fail('新人数不能少于该岗位已占用的报名名额');
 const eventMap=new Map(data.events.map(e=>[e['活动ID'],e]));for(const job of effective)eventMap.set(job['活动ID'],job);
 const jobWindows=new Map([...eventMap].map(([id,row])=>[id,sessionWindows(row)]));
 // Only re-evaluate schedule conflicts when this edit actually changes a
 // bookable time. Deadline/contact copy edits must never be blocked by an
 // unrelated historical overlap that already existed before the edit.
 const schedulesChanged=[...eventMap.values()].some(job=>{
  const previous=data.events.find(e=>e['活动ID']===job['活动ID']);
  return previous&&windowDigest(sessionWindows(job))!==windowDigest(sessionWindows(previous));
 });
 if(schedulesChanged){
  const conflictWindows=new Map();
  for(const [id,row] of eventMap){
   for(const window of jobWindows.get(id)||[]){
    const key=`${window.start}|${window.end}`;
    if(!conflictWindows.has(key))conflictWindows.set(key,[]);
    conflictWindows.get(key).push(id);
   }
  }
  if(bookings.filter(occupies).some(row=>(jobWindows.get(row['活动ID'])||[]).some(window=>[...conflictWindows].some(([key,ids])=>{
   const [start,end]=key.split('|');
   return Date.parse(start)<Date.parse(window.end)&&Date.parse(end)>Date.parse(window.start)&&ids.some(id=>id!==row['活动ID']);
  }))))throw fail('已有报名存在岗位时段重叠，请保留原岗位时段；如仅需修改截止时间，请直接保存', 'workspace_schedule_conflict');
 }
 const registrationPatches=bookings.flatMap(row=>{
  const target=effective.find(e=>e['活动ID']===row['活动ID']);
  if(!target){if(children.some(e=>e['活动ID']===row['活动ID']&&!activeIds.has(e['活动ID'])))return [];throw fail('已有报名缺少对应岗位');}
  const patch=Object.fromEntries(['活动名称','报名日期','报名时段','岗位'].filter(key=>String(row[key]??'')!==String(target[key]??'')).map(key=>[key,target[key]]));
  return Object.keys(patch).length?[{id:row._id,patch}]:[];
 });
 return {parentPatch,jobs:jobs.filter(job=>!job.unchanged).map(({existing,row})=>({id:existing?._id,row})),retainedJobs:jobs.filter(job=>job.unchanged).map(({row})=>({id:row['活动ID'],approval:row['批准摘要']})),removed:removed.map(e=>({id:e._id,patch:{状态:'已归档'}})),registrationPatches,group:content.bookingMode==='grouped'?{id:groupId,patch:{活动名称:content.name,组织类别:content.category,活动地区:parentPatch['活动地区'],负责人账号ID:content.responsibleId,班次数:jobs.length,报名截止:fresh.registrationDeadline,状态:event['状态']==='报名中'?'已发布':'草稿',报名开关:event['状态']==='报名中'?'开放':'关闭',修改人:actor,更新时间:new Date(now).toISOString()}}:null,previousGroupId:old.positionPlan?.groupId};
}
export const workspaceEditDigest=hash;
