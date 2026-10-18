import {createHash,createHmac} from 'node:crypto';
import {projectEvents} from '../../public/app/shared/activity-projects.js';
import {workflowConfig} from './blood-roster.js';
import {matchRunningImport} from './running-import.js';
const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode,code:'running_review_conflict'});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keys=['serviceHours','trainingHours','travelHours'];
export function runningSourceDigest(events,registrations,checkins,ledger){const ids=new Set(events.filter(row=>workflowConfig(row).bookingMode!=='grouped').map(row=>row['活动ID']));return hash([events.map(row=>[row._id,row['活动ID'],row['状态'],row['申请版本'],row['批准摘要']]),registrations,checkins.filter(row=>ids.has(row['活动ID'])),ledger.filter(row=>ids.has(row['活动ID']))]);}
export function normalizeRunningItem(item){
 if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(key=>!['id',...keys,'decision','reason','evidenceChecked','attendanceUrl'].includes(key))||typeof item.id!=='string'||!item.id)throw fail(400,'初审记录无效');
 const result={id:item.id};
 for(const key of keys){if(!['string','number'].includes(typeof item[key])||String(item[key]).trim()===''||!Number.isFinite(Number(item[key]))||Number(item[key])<0||Number(item[key])>100000)throw fail(400,'请填写有效的非负时长');result[key]=Number(item[key]);}
 if(!['','pass','fail'].includes(item.decision))throw fail(400,'请选择初审结果');
 result.decision=item.decision;result.reason=typeof item.reason==='string'?item.reason.trim():'';result.evidenceChecked=item.evidenceChecked===true;
 if(result.reason.length>500||result.decision==='fail'&&!result.reason)throw fail(400,'初审不通过需填写原因，最多500字');
 if(item.attendanceUrl!==undefined&&item.attendanceUrl!==''){
  if(typeof item.attendanceUrl!=='string'||item.attendanceUrl.length>2000)throw fail(400,'签到链接无效');
  let url;try{url=new URL(item.attendanceUrl);}catch{throw fail(400,'签到链接无效');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw fail(400,'签到链接只支持网页地址');result.attendanceUrl=url.href;
 }
 return result;
}

/** Independent director review. One parent-row commit; never creates attendance or final ledger. */
export function createRunningReview({read,write,update,WF,approved,authorize,secret,now=()=>Date.now()}){
 async function context(id,actor,writing=false){
  const data=await read(),event=data.events.find(row=>row._id===id),c=workflowConfig(event||{});
  if(!event)throw fail(404,'活动不存在');
  if(!c.workspaceSubmission||c.parentActivityId||c.approval?.mode!=='workspace-regional')throw fail(409,'请从新版项目活动进入时长初审');
  const events=projectEvents(data.events,event),jobs=events.filter(row=>workflowConfig(row).bookingMode!=='grouped');
  const state=c.finalHours?.status==='exported'?'已结束':'进行中';
  if(!events.length||events.some(row=>row['状态']!==state||!approved(row)))throw fail(409,'项目状态或批准信息已变化，请刷新');
  let canRecord=false;try{for(const target of events)await authorize(target,actor);canRecord=true;}catch(error){if(writing)throw error;}
  if(writing&&c.runningReview?.status==='submitted')throw fail(409,'时长已提交主席团审核');
  const ids=new Set(jobs.map(row=>row['活动ID']));
  const registrations=data.registrations.filter(row=>ids.has(row['活动ID'])&&['已确认','已签到'].includes(row['报名状态'])&&row['请假状态']!=='已批准');
  if(registrations.length>200)throw fail(409,'单次时长初审最多支持200条参与记录，请联系管理员核对');
  if(new Set(registrations.map(row=>row._id)).size!==registrations.length)throw fail(409,'参与记录重复，请核对');
  // Bind preview to every identity, outcome, attendance and existing ledger revision.
  const sourceDigest=runningSourceDigest(events,registrations,data.checkins,data.ledger);
  const token=hash([sourceDigest,c.runningReview||null]);
  return {data,event,c,events,jobs,registrations,sourceDigest,token,canRecord};
 }
 function recordDigest(ctx,id){const row=ctx.registrations.find(row=>row._id===id),event=ctx.jobs.find(event=>event['活动ID']===row?.['活动ID']);return hash([event?.['批准摘要'],row,ctx.data.checkins.filter(check=>check['报名行ID']===id),ctx.data.ledger.filter(entry=>entry['报名行ID']===id)]);}
 function savedEntries(ctx){return (ctx.c.runningReview?.entries||[]).filter(item=>ctx.registrations.some(row=>row._id===item.id)).map(saved=>{
  const {sourceDigest,...item}=saved;
  if(ctx.c.runningReview?.status==='submitted'){const final=ctx.c.finalHours?.rows?.find(row=>row.id===item.id);return final?{...item,serviceHours:final.serviceHours,trainingHours:final.trainingHours,travelHours:final.travelHours}:item;}
  return sourceDigest===recordDigest(ctx,item.id)?item:{...item,decision:'',evidenceChecked:false};
 });}
 function itemsFor(ctx,items,{complete=false}={}){
  if(!Array.isArray(items)||items.length>200||!items.length&&ctx.registrations.length)throw fail(400,'初审名单无效');
  const normalized=items.map(normalizeRunningItem),ids=new Set(normalized.map(row=>row.id));
  if(ids.size!==items.length||normalized.some(item=>!ctx.registrations.some(row=>row._id===item.id)))throw fail(409,'参与名单已变化，请刷新');
  if(complete&&(ids.size!==ctx.registrations.length||normalized.some(item=>!item.decision)))throw fail(409,'请完成全部岗位参与人员的初审');
  return normalized.sort((a,b)=>a.id.localeCompare(b.id));
 }
 const sign=(ctx,items,actor)=>createHmac('sha256',secret).update(JSON.stringify([ctx.event._id,ctx.token,items,actor])).digest('hex');
 const view=ctx=>({token:ctx.token,canRecord:ctx.canRecord&&ctx.c.runningReview?.status!=='submitted',status:ctx.c.runningReview?.status||'draft',entries:savedEntries(ctx),submittedAt:ctx.c.runningReview?.submittedAt||''});
 return {
  runningReview:async(id,actor)=>view(await context(id,actor)),
  importRunningReview:async(id,rows,actor)=>{
   const ctx=await context(id,actor,true);
   return {token:ctx.token,items:matchRunningImport(rows,ctx.registrations,ctx.jobs,savedEntries(ctx))};
  },
  saveRunningReview:(id,body,actor)=>write(async()=>{
   const ctx=await context(id,actor,true);if(body.token!==ctx.token)throw fail(409,'名单或初审已更新，请刷新后再保存');
   const incoming=itemsFor(ctx,body.items),entries=new Map(savedEntries(ctx).map(item=>[item.id,item]));
   for(const item of incoming)entries.set(item.id,item);
   ctx.c.runningReview={status:'draft',entries:[...entries.values()].filter(item=>ctx.registrations.some(row=>row._id===item.id)).map(item=>({...item,sourceDigest:recordDigest(ctx,item.id)})),updatedBy:actor,updatedAt:new Date(now()).toISOString()};
   await update(WF.events,ctx.event,{报名页配置:JSON.stringify(ctx.c)});return {saved:true};
  }),
  previewRunningReview:async(id,body,actor)=>{
   const ctx=await context(id,actor,true);if(body.token!==ctx.token)throw fail(409,'名单或初审已更新，请刷新后重新预览');
   if(!ctx.registrations.length)throw fail(409,'没有可提交的参与记录');
   const items=itemsFor(ctx,body.items,{complete:true});
   return {token:ctx.token,previewToken:sign(ctx,items,actor),items,rows:items.map(item=>{const row=ctx.registrations.find(row=>row._id===item.id),job=ctx.jobs.find(job=>job['活动ID']===row['活动ID']);return {...item,name:row['姓名'],studentId:row['学号'],position:job['岗位']||job['活动名称'],date:row['报名日期']||job['报名日期'],slot:row['报名时段']||job['报名时段']};})};
  },
  submitRunningReview:(id,body,actor)=>write(async()=>{
   // An identical lost-response retry only reads the already committed submission.
   const before=await context(id,actor);for(const target of before.events)await authorize(target,actor);
   if(before.c.runningReview?.status==='submitted'){
    if(before.c.runningReview.previewToken===body.previewToken&&before.c.runningReview.submittedBy===actor&&hash(before.c.runningReview.entries)===hash((body.items||[]).map(normalizeRunningItem).sort((a,b)=>a.id.localeCompare(b.id))))return {submitted:true};
    throw fail(409,'时长已提交，请刷新查看');
   }
   const ctx=before;if(body.token!==ctx.token)throw fail(409,'名单或初审已更新，请重新预览');
   const items=itemsFor(ctx,body.items,{complete:true});if(typeof body.previewToken!=='string'||body.previewToken!==sign(ctx,items,actor))throw fail(409,'请先预览最新完整时长表');
   if(!ctx.registrations.length)throw fail(409,'没有可提交的参与记录');
   ctx.c.runningReview={status:'submitted',entries:items,submittedBy:actor,submittedAt:new Date(now()).toISOString(),sourceDigest:ctx.sourceDigest,previewToken:body.previewToken};
   await update(WF.events,ctx.event,{报名页配置:JSON.stringify(ctx.c)});return {submitted:true};
  }),
 };
}
