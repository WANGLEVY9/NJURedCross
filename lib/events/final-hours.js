import {createHash} from 'node:crypto';
import {projectEvents} from '../../public/app/shared/activity-projects.js';
import {finalTrainingHours} from '../../public/app/shared/activity-final-hours.js';
import {runningSourceDigest} from './running-review.js';
import {workflowConfig} from './blood-roster.js';
import {finalHoursWorkbook} from './final-hours-workbook.js';
import {finalHoursDates} from './final-hours-dates.js';
const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode,code:'final_hours_conflict'});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const editKeys=['serviceHours','trainingHours','travelHours','location','dates','work','remark','decision','reason','evidenceChecked'];
const safeName=name=>`${String(name||'志愿活动').replace(/[\r\n\\/:*?"<>|]/g,'_').slice(0,90)}-分工时长表.xlsx`;
export function createFinalHours({read,write,update,WF,approved,authorizeRead,authorizeReview,recipient,now=()=>Date.now()}){
 async function context(id,actor,editing=false){
  const data=await read(),event=data.events.find(row=>row._id===id),c=workflowConfig(event||{});
  if(!event||!c.workspaceSubmission||c.parentActivityId||c.runningReview?.status!=='submitted')throw fail(409,'活动尚未提交时长审核');
  await authorizeRead(event,actor);let canEdit=false;try{await authorizeReview(event,actor);canEdit=true;}catch(error){if(editing)throw error;}
  if(editing&&c.finalHours?.status==='exported')throw fail(409,'最终表已导出，不能继续修改');
  if(c.finalHours?.status==='exported')return {event,c,rows:c.finalHours.rows,token:c.finalHours.token,canEdit:false,status:'exported'};
  const events=projectEvents(data.events,event),jobs=events.filter(row=>workflowConfig(row).bookingMode!=='grouped'),ids=new Set(jobs.map(row=>row['活动ID']));
  if(events.some(row=>row['状态']!=='进行中'||!approved(row)))throw fail(409,'项目状态或批准信息已变化');
  const registrations=data.registrations.filter(row=>ids.has(row['活动ID'])&&['已确认','已签到'].includes(row['报名状态'])&&row['请假状态']!=='已批准');
  if(c.runningReview.sourceDigest!==runningSourceDigest(events,registrations,data.checkins,data.ledger))throw fail(409,'参与或签到依据已改变，请核对初审来源后再审核');
  const first=c.runningReview.entries;if(!Array.isArray(first)||first.length!==registrations.length||new Set(first.map(row=>row.id)).size!==first.length)throw fail(409,'时长初审名单不完整');
  const rows=registrations.map(reg=>{
   const original=first.find(row=>row.id===reg._id),job=jobs.find(row=>row['活动ID']===reg['活动ID']),previous=c.finalHours?.rows?.find(row=>row.id===reg._id);
   if(!original)throw fail(409,'时长初审名单已改变');
   const base={id:reg._id,name:reg['姓名'],studentId:reg['学号'],department:reg['院系']||'',location:job['地点']||'',dates:finalHoursDates(job,reg),work:job['工作内容']||'',remark:'',serviceHours:original.serviceHours,trainingHours:finalTrainingHours(original.trainingHours),travelHours:original.travelHours,decision:original.decision,reason:original.reason,evidenceChecked:original.evidenceChecked,firstDecision:original.decision,position:job['岗位']||job['活动名称']};
   if(previous)for(const key of editKeys)base[key]=previous[key];return base;
  });
  const token=hash([c.runningReview.previewToken,c.runningReview.sourceDigest,rows,c.finalHours?.updatedAt||'']);
  return {data,event,c,events,registrations,rows,token,canEdit,status:'review'};
 }
 function changedRows(ctx,items){
  if(!Array.isArray(items)||!items.length||items.length>200||new Set(items.map(item=>item?.id)).size!==items.length)throw fail(400,'请选择有效的时长行');
  const rows=structuredClone(ctx.rows);
  for(const item of items){const row=rows.find(row=>row.id===item?.id);if(!row||Object.keys(item).some(key=>!['id',...editKeys].includes(key)))throw fail(400,'不能修改身份或其他活动的时长');
   for(const key of editKeys)if(Object.hasOwn(item,key))row[key]=item[key];
   for(const key of ['serviceHours','trainingHours','travelHours']){if(!['string','number'].includes(typeof row[key])||String(row[key]).trim()===''||!Number.isFinite(Number(row[key]))||Number(row[key])<0||Number(row[key])>100000)throw fail(400,'时长必须为有效非负数字');row[key]=Number(row[key]);}
   if(!Number.isInteger(row.trainingHours))throw fail(400,'培训时长须按模板填写整数');
   for(const key of ['location','dates','work','remark','reason']){if(typeof row[key]!=='string'||row[key].length>1000)throw fail(400,'工作明细不能为空或过长');row[key]=row[key].trim();}
   if(!['pass','fail'].includes(row.decision)||row.decision==='fail'&&!row.reason)throw fail(400,'未通过须填写原因');
   if(row.decision==='pass'){
    if(!row.location||!row.dates||!row.work)throw fail(400,'请补齐实际工作地点、日期与工作内容');
   }
  }
  return rows;
 }
 const view=ctx=>({name:ctx.event['活动名称'],token:ctx.token,status:ctx.status,canEdit:ctx.canEdit,rows:ctx.rows,mailStatus:ctx.c.finalHours?.mail?.status||'',exportedAt:ctx.c.finalHours?.exportedAt||''});
 const service={
  finalHours:async(id,actor)=>view(await context(id,actor)),
  saveFinalHours:(id,body,actor)=>write(async()=>{const ctx=await context(id,actor,true);if(body.token!==ctx.token)throw fail(409,'时长表已更新，请重新打开');const rows=changedRows(ctx,body.items);ctx.c.finalHours={status:'review',rows,updatedBy:actor,updatedAt:new Date(now()).toISOString()};await update(WF.events,ctx.event,{报名页配置:JSON.stringify(ctx.c)});return {saved:true};}),
  exportFinalHours:(id,body,actor)=>write(async()=>{
   const ctx=await context(id,actor);await authorizeReview(ctx.event,actor);
   if(ctx.status==='exported'){if(body.token===ctx.c.finalHours.requestToken&&actor===ctx.c.finalHours.exportedBy)return {exported:true};throw fail(409,'最终表已导出，请下载归档文件');}
   if(body.token!==ctx.token)throw fail(409,'时长表已更新，请重新预览');
   const rows=changedRows(ctx,ctx.rows.map(row=>Object.fromEntries(['id',...editKeys].map(key=>[key,row[key]])))),eligible=rows.filter(row=>row.decision==='pass'&&row.serviceHours+row.trainingHours+row.travelHours>0);
   if(!eligible.length)throw fail(409,'没有审核通过的有效时长，不能导出结束活动');
   const to=await recipient(ctx.event),workbook=await finalHoursWorkbook(eligible);
   const token=hash([ctx.token,rows]),exportedAt=new Date(now()).toISOString();
   ctx.c.finalHours={status:'exported',rows,token,requestToken:ctx.token,exportedBy:actor,exportedAt,filename:safeName(ctx.event['活动名称']),fileBase64:workbook.toString('base64'),mail:{status:'pending',to:to.email,accountId:to.accountId,...(to.recipients?{recipients:to.recipients.map(row=>({...row,status:'pending'}))}:{}),key:`workflow-hours:${ctx.event._id}:${token}`}};
   await update(WF.events,ctx.event,{状态:'已结束',报名页配置:JSON.stringify(ctx.c)});return {exported:true};
  }),
  downloadFinalHours:async(id,actor)=>{const ctx=await context(id,actor);if(ctx.status!=='exported')throw fail(409,'请先由本地区主席团导出最终表');return {buffer:Buffer.from(ctx.c.finalHours.fileBase64,'base64'),filename:ctx.c.finalHours.filename};},
  deliverFinalHours:async(id,actor,send)=>{
   const ctx=await context(id,actor);if(ctx.status!=='exported')throw fail(409,'最终表尚未导出');
   const mail=ctx.c.finalHours.mail;if(mail.status==='sent')return {status:'sent'};
   let result;
   const current=await recipient(ctx.event);
   if(current.accountId!==mail.accountId||current.email!==mail.to)throw fail(409,'负责人邮箱已变化，请核对原邮件任务，不能改发给其他地址');
   if(mail.recipients){
    if(JSON.stringify(current.recipients||[{accountId:current.accountId,email:current.email}])!==JSON.stringify(mail.recipients.map(({accountId,email})=>({accountId,email}))))throw fail(409,'负责人名单或邮箱已变化，请核对原邮件任务');
    const recipients=structuredClone(mail.recipients),buffer=Buffer.from(ctx.c.finalHours.fileBase64,'base64'),title=String(ctx.event['活动名称']).replace(/[\r\n]+/g,' ').slice(0,300);
    for(const target of recipients){
     if(['sent','unknown'].includes(target.status))continue;
     let response;try{response=await send({to:target.email,subject:`${title}：最终时长表`,text:`活动“${ctx.event['活动名称']}”的时长审核已完成。最终分工时长表见附件，请核对并录入时长；也可在活动管理的已结束页面下载。`,kind:'workflow-hours',idempotencyKey:`${mail.key}:${target.accountId}`,attachments:[{filename:ctx.c.finalHours.filename,content:buffer,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}]});}catch{response={ok:false,code:'mail_delivery_unknown'};}
     target.status=response.ok&&['smtp','idempotent-skip'].includes(response.transport)?'sent':response.code==='mail_delivery_unknown'?'unknown':'failed';
    }
    const status=recipients.every(row=>row.status==='sent')?'sent':recipients.some(row=>row.status==='unknown')?'unknown':'failed';
    await write(async()=>{const fresh=await context(id,actor);if(fresh.c.finalHours.token!==ctx.c.finalHours.token)throw fail(409,'归档版本已变化');if(fresh.c.finalHours.mail.status==='sent')return;fresh.c.finalHours.mail={...fresh.c.finalHours.mail,status,recipients};await update(WF.events,fresh.event,{报名页配置:JSON.stringify(fresh.c)});});return {status};
   }
   try{const buffer=Buffer.from(ctx.c.finalHours.fileBase64,'base64'),title=String(ctx.event['活动名称']).replace(/[\r\n]+/g,' ').slice(0,300);result=await send({to:mail.to,subject:`${title}：最终时长表`,text:`活动“${ctx.event['活动名称']}”的时长审核已完成。最终分工时长表见附件，请核对并录入时长；也可在活动管理的已结束页面下载。`,kind:'workflow-hours',idempotencyKey:mail.key,attachments:[{filename:ctx.c.finalHours.filename,content:buffer,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}]});}catch{result={ok:false,code:'mail_delivery_unknown'};}
   const status=result.ok&&['smtp','idempotent-skip'].includes(result.transport)?'sent':result.code==='mail_delivery_unknown'?'unknown':'failed';
   await write(async()=>{const fresh=await context(id,actor);if(fresh.c.finalHours.token!==ctx.c.finalHours.token)throw fail(409,'归档版本已变化');if(fresh.c.finalHours.mail.status==='sent')return;fresh.c.finalHours.mail={...fresh.c.finalHours.mail,status};await update(WF.events,fresh.event,{报名页配置:JSON.stringify(fresh.c)});});return {status};
  },
 };
 service.deliverPendingFinalHours=async send=>{
  const data=await read(),pending=data.events.filter(row=>{const c=workflowConfig(row);return c.finalHours?.status==='exported'&&['pending','failed'].includes(c.finalHours.mail?.status);}).slice(0,8);
  for(const row of pending){try{await service.deliverFinalHours(row._id,workflowConfig(row).finalHours.exportedBy,send);}catch{/* Frozen job remains available for scoped reconciliation. */}}
  return {examined:pending.length};
 };
 return service;
}
