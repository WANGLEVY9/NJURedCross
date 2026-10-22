import {createHash} from 'node:crypto';
import {workflowConfig} from './blood-roster.js';
import {workspaceContentFromEvent} from './workspace-event-copy.js';
import {normalizePositions} from './project-positions.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=message=>Object.assign(new Error(message),{statusCode:409});
const occupies=r=>['待筛选','已确认','已签到'].includes(r['报名状态'])&&r['请假状态']!=='已批准';
const window=e=>{const c=workflowConfig(e);return c.ordinary||c.window;};
export function workspaceBeforeStart(event,now=Date.now()){
 const c=workflowConfig(event),starts=(c.positionPlan?.positions||c.positionDraft?.positions||[]).map(p=>p.start);
 if(!starts.length)starts.push(c.window?.start);
 return starts.length>0&&starts.every(value=>Number.isFinite(Date.parse(value))&&Date.parse(value)>now);
}
/** Pure plan: stable event and booking identities, with no external writes. */
export function planWorkspaceLiveEdit({event,data,prepared,content,actor,now,prepare,approvalHash}){
 const old=workflowConfig(event),fresh=workflowConfig(prepared),original=workspaceContentFromEvent(event),version=String(Number(event['申请版本'])+1);
 const children=data.events.filter(e=>workflowConfig(e).parentActivityId===event['活动ID']),ids=new Set([event['活动ID'],...children.map(e=>e['活动ID'])]);
 const bookings=data.registrations.filter(r=>ids.has(r['活动ID']));
 if(!workspaceBeforeStart(event,now)||!workspaceBeforeStart(prepared,now))throw fail('活动已开始或修改后的时间已过，不能修改');
 if(data.checkins.some(r=>ids.has(r['活动ID']))||data.ledger.some(r=>ids.has(r['活动ID']))||old.runningReview?.status==='submitted'||old.finalHours?.status==='exported')throw fail('已有签到、提交审核或最终时长记录，不能改写活动安排');
 if(old.bookingMode!==content.bookingMode&&bookings.length)throw fail('已有报名记录，不能切换单岗位与多岗位；现有岗位信息仍可修改');
 const c={...old,...fresh,workspaceSubmission:old.workspaceSubmission,lastEditor:actor};delete c.workspaceEdit;
 delete c.positionDraft;delete c.positionPlan;delete c.runningReview;delete c.finalHours;
 c.workspaceEdits=[...(old.workspaceEdits||[]).slice(-9),{actor,at:new Date(now).toISOString(),version,previousContent:original,...(old.runningReview?{previousReview:old.runningReview}:{})}];
 const groupId=old.positionPlan?.groupId||'PROJECT-'+event['活动ID'];
 const jobs=[];
 if(content.bookingMode==='grouped'){
  const positions=normalizePositions(fresh.positionDraft.positions,fresh.window),oldIds=old.positionPlan?.eventIds||[];
  const eventIds=content.positions.map(p=>{const match=/^source-(\d+)$/.exec(p.id);return match&&oldIds[Number(match[1])]||'PS-'+hash([event['活动ID'],version,p.id]).slice(0,32);});
  if(new Set(eventIds).size!==eventIds.length)throw fail('岗位关联重复，请重新载入后修改');
  const inputHash=hash({positions,deadline:fresh.registrationDeadline});
  c.positionPlan={positions,deadline:fresh.registrationDeadline,eventIds,groupId,inputHash,complete:true,actor};
  for(const [i,p]of positions.entries()){
   const existing=children.find(e=>e['活动ID']===eventIds[i]);
   const row=prepare({name:content.name,center:content.category,region:fresh.region,date:p.start.slice(0,10),slot:p.start.slice(11,19)+'-'+p.end.slice(11,19),position:p.name,location:p.location,capacity:p.capacity,work:p.work||fresh.work,serviceHours:p.serviceHours??fresh.service,trainingHours:p.trainingHours??fresh.training,travelHours:p.travelHours??fresh.travel,ordinary:{groupId,start:p.start,end:p.end,campus:p.campus,hoursPending:false}});
   const childConfig={...(existing?workflowConfig(existing):{}),...workflowConfig(row),coOwners:fresh.coOwners||[],registrationContact:fresh.registrationContact,workspaceResponsibleName:fresh.workspaceResponsibleName,workspaceResponsibleNames:fresh.workspaceResponsibleNames,parentActivityId:event['活动ID'],parentPlan:inputHash,approval:c.approval,positionWork:p.work||fresh.work,positionHours:{serviceHours:p.serviceHours??fresh.service,trainingHours:p.trainingHours??fresh.training,travelHours:p.travelHours??fresh.travel},registrationDeadline:fresh.registrationDeadline};
   Object.assign(row,{活动ID:eventIds[i],负责人账号ID:content.responsibleId,申请版本:version,批准版本:version,审批人:actor,审批时间:new Date(now).toISOString(),状态:event['状态'],报名页配置:JSON.stringify(childConfig)});
   for(const key of Object.keys(row))row[key]=String(row[key]??'');row['批准摘要']=approvalHash(row);jobs.push({existing,row});
  }
 }
 const removed=children.filter(e=>!jobs.some(job=>job.row['活动ID']===e['活动ID']));
 if(bookings.some(r=>removed.some(e=>e['活动ID']===r['活动ID'])))throw fail('已有报名的岗位不能移除，请保留岗位并修改安排');
 const parentPatch={...prepared,活动ID:event['活动ID'],创建时间:event['创建时间'],状态:event['状态'],申请版本:version,批准版本:version,审批人:actor,审批时间:new Date(now).toISOString(),报名页配置:JSON.stringify(c)};
 delete parentPatch._id;for(const key of Object.keys(parentPatch))parentPatch[key]=String(parentPatch[key]??'');parentPatch['批准摘要']=approvalHash({...event,...parentPatch});
 const effective=content.bookingMode==='grouped'?jobs.map(job=>job.row):[{...event,...parentPatch}];
 for(const job of effective)if(bookings.filter(r=>r['活动ID']===job['活动ID']&&occupies(r)).length+Number(workflowConfig(job).sourceOccupied||0)>Number(job['容量']))throw fail('新人数不能少于该岗位已占用的报名名额');
 const eventMap=new Map(data.events.map(e=>[e['活动ID'],e]));for(const job of effective)eventMap.set(job['活动ID'],job);
 for(const row of bookings.filter(occupies)){
  const own=eventMap.get(row['活动ID']),a=window(own);if(!a)continue;
  if(data.registrations.some(other=>other._id!==row._id&&occupies(other)&&(row['账号ID']&&other['账号ID']===row['账号ID']||row['学号']&&other['学号']===row['学号'])&&(()=>{const b=window(eventMap.get(other['活动ID'])||{});return b&&Date.parse(a.start)<Date.parse(b.end)&&Date.parse(a.end)>Date.parse(b.start);})()))throw fail('修改后的时间与已有报名冲突，请调整岗位时段');
 }
 const registrationPatches=bookings.map(row=>{const target=effective.find(e=>e['活动ID']===row['活动ID']);if(!target)throw fail('已有报名缺少对应岗位');return {id:row._id,patch:{活动名称:target['活动名称'],报名日期:target['报名日期'],报名时段:target['报名时段'],岗位:target['岗位']}};});
 return {parentPatch,jobs:jobs.map(({existing,row})=>({id:existing?._id,row})),removed:removed.map(e=>({id:e._id,patch:{状态:'已归档'}})),registrationPatches,group:content.bookingMode==='grouped'?{id:groupId,patch:{活动名称:content.name,组织类别:content.category,活动地区:parentPatch['活动地区'],负责人账号ID:content.responsibleId,班次数:jobs.length,报名截止:fresh.registrationDeadline,状态:event['状态']==='报名中'?'已发布':'草稿',报名开关:event['状态']==='报名中'?'开放':'关闭',修改人:actor,更新时间:new Date(now).toISOString()}}:null,previousGroupId:old.positionPlan?.groupId};
}
export const workspaceEditDigest=hash;
