/** Single-process durable confirmation delivery; ambiguous SMTP outcomes require review. */
import {readPagedRows} from '../http/paged-rows.js';
import {createMutationQueue,assertCompleteRows} from './safety.js';
import {rosterMailKey,rosterReview} from '../../public/app/shared/roster-review.js';
import {ordinaryConfig} from './ordinary-groups.js';
import {approvalMessages} from './approval-mail.js';
import {createHash} from 'node:crypto';
export const NOTIFICATION_TABLE='网站报名通知任务表';
export const NOTIFICATION_COLUMNS=['幂等键','报名ID','活动ID','状态','收件人','主题','正文','尝试次数','下次尝试','更新时间'];
const confirmed=row=>['已确认','已签到'].includes(row['报名状态'])&&[true,'true'].includes(row['是否报名成功']);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const leavePrefix=row=>`WF-LEAVE:${row['报名ID']}:${digest(row['请假申请时间'])}:`;
const leaveKey=(row,approved)=>leavePrefix(row)+(approved?'approved':'rejected');
export function leaveDecisionMessage(event,row,{approved,reason},origin='https://njuredcross.cn'){
 if(typeof approved!=='boolean'||!row['报名ID']||!Number.isFinite(Date.parse(row['请假申请时间'])))throw Error('Invalid leave decision identity');
 if(event['活动ID']!==row['活动ID'])throw Error('Leave event mismatch');
 const text=typeof reason==='string'?reason.trim():'';
 if(!text||text.length>500)throw Error('Invalid leave decision reason');
 // Share the verified-address and HTTPS checks with confirmation delivery.
 const message=confirmationMessage(event,row,origin);
 return {...message,idempotencyKey:leaveKey(row,approved),subject:`南大红会｜${event['活动名称']}请假审批结果`,text:`${row['姓名']}同学：\n你在${event['活动名称']}（${row['报名日期']} ${row['报名时段']}）的请假申请${approved?'已批准':'已驳回'}。\n处理说明：${text}\n${approved?'该报名已取消，名额已释放。':'报名状态保持不变，请登录平台查看。'}\n查看报名：${new URL(origin).origin}/workflow-events?event=${encodeURIComponent(event._id)}`};
}
export function confirmationMessage(event,row,origin){
 const url=new URL(origin);if(url.protocol!=='https:')throw Error('Notification origin must use HTTPS');
 if(!/^\d+@(smail\.nju\.edu\.cn|nju\.edu\.cn)$/.test(row['邮箱']||'')||row['邮箱'].split('@')[0]!==row['学号'])throw Error('Invalid verified participant address');
 const bloodWeek=ordinaryConfig(event)?.groupId==='NJU-RC-BLOOD-WEEK-2026-10';
 const name=bloodWeek?'2026南大红会无偿献血周':event['活动名称'];
 const position=bloodWeek?'献血周服务（岗位后续分配）':row['岗位']||'请查看活动详情';
 return {to:row['邮箱'],subject:`南大红会｜${name}报名成功`,kind:'workflow-result',idempotencyKey:rosterMailKey(row),text:`${row['姓名']}同学：\n你的报名已确认成功。\n\n活动：${name}\n日期：${row['报名日期']}\n时段：${row['报名时段']}\n地点：${event['地点']||row['地点']||'请查看活动详情'}\n岗位：${position}\n报名编号：${row['报名ID']}\n\n查看报名：${url.origin}/workflow-events?event=${encodeURIComponent(event._id)}\n如不能参加，请在平台申请取消，管理员批准后方可释放名额。\n服务时长以活动规则及签到核验后的正式录入结果为准。`};
}
export function createRegistrationNotifications(base,{send,enabled=()=>false,now=Date.now,origin='https://njuredcross.cn'}={}){
 const serial=createMutationQueue();
 const rows=()=>readPagedRows(base,NOTIFICATION_TABLE,{maxRows:100000,requireComplete:true});
 const patch=(r,data)=>base.updateRow(NOTIFICATION_TABLE,r._id,{...data,更新时间:new Date(now()).toISOString()});
 function unique(all,key){const matches=all.filter(r=>r['幂等键']===key);if(matches.length>1)throw Error('Duplicate confirmation task');return matches[0];}
 async function enqueue(message,registration={}){
  const all=await rows();if(!all.some(r=>r['幂等键']==='INIT:REGISTRATION-NOTIFICATIONS'))throw Error('Notification baseline missing');
  const previous=unique(all,message.idempotencyKey);if(previous)return previous;
  const values={幂等键:message.idempotencyKey,报名ID:registration['报名ID']||'',活动ID:registration['活动ID']||'',状态:'待发送',收件人:message.to,主题:message.subject,正文:message.text,尝试次数:'0',下次尝试:'',更新时间:new Date(now()).toISOString()};
  const result=await base.appendRow(NOTIFICATION_TABLE,values);if(!result?._id)throw Error('Confirmation task write unconfirmed');
  return {...values,_id:result._id};
 }
 async function attempt(row){
  if(row['状态']==='已发送')return {ok:true,transport:'idempotent-skip'};
  if(['历史未补发','结果待核对','发送中','已取消'].includes(row['状态']))return {ok:false,transport:'blocked'};
  if(!enabled()||Number(row['尝试次数'])>=5||Date.parse(row['下次尝试']||'1970-01-01')>now())return {ok:false,transport:'deferred'};
  const count=Number(row['尝试次数']||0)+1;
  if(!Number.isSafeInteger(count)||count<1)throw Error('Invalid notification attempt count');
  await patch(row,{状态:'发送中',尝试次数:String(count)});
  let result;try{result=await send({to:row['收件人'],subject:row['主题'],text:row['正文'],kind:'workflow-result',idempotencyKey:row['幂等键']});}catch{result={ok:false};}
  const success=result?.ok&&['smtp','idempotent-skip'].includes(result.transport);
  await patch(row,{状态:success?'已发送':result?.retryable===true?'发送失败':'结果待核对',下次尝试:success?'':new Date(now()+Math.min(3600000,60000*2**(count-1))).toISOString()});
  return success?result:{ok:false,transport:'deferred'};
 }
 async function reconcile(data){return serial(async()=>{
  assertCompleteRows(data.events,data.registrations);
  for(const row of await rows())if(row['状态']==='发送中')await patch(row,{状态:'结果待核对'});
  let queued=0;
  for(const row of data.registrations){
   if(!confirmed(row)||row['请假状态']==='待审批')continue;
   const event=data.events.find(e=>e['活动ID']===row['活动ID']);if(!event||rosterReview(event))continue; // Existing reviewed-roster delivery uses dispatch below.
   const config=JSON.parse(event['报名页配置']||'{}');
   if(config.source?.kind==='generated_blood'&&row['岗位同步状态']!=='已同步')continue;
   await enqueue(confirmationMessage(event,row,origin),row);queued++;
  }
  const current=await rows();let attempted=0;
  for(const row of current){
   const registration=data.registrations.find(r=>r['报名ID']===row['报名ID']);
   if(String(row['幂等键']).startsWith('WF-LEAVE:')){
    if(!['待发送','发送失败'].includes(row['状态']))continue;
    if(!registration||!String(row['幂等键']).startsWith(leavePrefix(registration))){await patch(row,{状态:'已取消'});continue;}
    // A durable intent is written before the business mutation; never mail it early.
    if(registration['请假状态']==='待审批')continue;
    const approved=registration['请假状态']==='已批准';
    const event=data.events.find(e=>e['活动ID']===registration['活动ID']);
    if(!event)continue;
    if(!['已批准','已驳回'].includes(registration['请假状态'])||approved&&registration['报名状态']!=='已请假'){await patch(row,{状态:'已取消'});continue;}
    if(leaveKey(registration,approved)!==row['幂等键']){await patch(row,{状态:'已取消'});continue;}
    // Processing notes can later change during registration approval. Keep the
    // decision's frozen message instead of reconstructing it from those notes.
    if(registration['邮箱']!==row['收件人']){await patch(row,{状态:'结果待核对'});continue;}
    if(attempted<10&&Number(row['尝试次数']||0)<5&&Date.parse(row['下次尝试']||'1970-01-01')<=now()){attempted++;await attempt(row);}
    continue;
   }
   // Reviewed results without a registration reference retry only through the reviewed workbench.
   if(!row['报名ID'])continue;
   if(!registration||!confirmed(registration)){if(['待发送','发送失败'].includes(row['状态']))await patch(row,{状态:'已取消'});continue;}
   if(registration['请假状态']==='待审批')continue;
   if(row['收件人']!==registration['邮箱']){if(['待发送','发送失败'].includes(row['状态']))await patch(row,{状态:'结果待核对'});continue;}
   if(['待发送','发送失败'].includes(row['状态'])&&Number(row['尝试次数']||0)<5&&Date.parse(row['下次尝试']||'1970-01-01')<=now()&&attempted<10){attempted++;await attempt(row);}
  }
  return {queued};
 });}
 // Reviewed roster calls share the same durable intent and receipt, including negative outcomes.
 const dispatch=message=>serial(async()=>attempt(await enqueue(message)));
 let reviewedAfter='';
 // Invoke outside the workflow write lock: deliverRoster acquires that lock and
 // calls dispatch, which in turn acquires this worker's queue. Never invert them.
 const retryReviewed=async(data,{deliverRoster,statuses,maxEvents=5}={})=>{
  assertCompleteRows(data.events,data.registrations);
  if(typeof deliverRoster!=='function'||!Number.isSafeInteger(maxEvents)||maxEvents<1||maxEvents>20)throw Error('Invalid reviewed retry options');
  const receipts=async keys=>{
   let external={};try{external=statuses?await statuses(keys):{};}catch{/* Durable queue receipts remain available. */}
   return serial(async()=>{
    const all=await rows(),result={};
    for(const key of keys){
     const task=unique(all,key);
     if(task?.['状态']==='已发送')result[key]={status:'sent',sentAt:task['更新时间']||''};
     else if(external[key]?.status==='sent')result[key]=external[key];
     else if(task&&['待发送','发送失败'].includes(task['状态']))result[key]={status:'failed',retryable:true,deferred:Number(task['尝试次数']||0)>=5||Date.parse(task['下次尝试']||'1970-01-01')>now()};
     else result[key]={status:'unknown',blocked:Boolean(task)};
    }
    return result;
   });
  };
  const results=[],offset=Math.max(0,data.events.findIndex(event=>event._id===reviewedAfter)+1);
  const ordered=[...data.events.slice(offset),...data.events.slice(0,offset)];
  for(const event of ordered){
   const review=rosterReview(event);
   if(!review||!(review.immediateCommit||review.phase==='final'||review.immediate&&review.phase==='draft'))continue;
   if(!review.immediateCommit&&!Object.entries(review.published||{}).some(([id,published])=>{
    const row=data.registrations.find(r=>r._id===id&&r['活动ID']===event['活动ID']);
    return row&&review.deliveries?.[rosterMailKey(row,published)]?.status!=='sent';
   }))continue;
   if(results.length>=maxEvents)break;
   reviewedAfter=event._id;
   try{results.push({eventId:event._id,result:await deliverRoster(event._id,{send:dispatch,statuses:receipts,retry:true})});}
   catch{results.push({eventId:event._id,error:'reviewed_delivery_pending'});}
  }
  return {results};
 };
 // Call inside the workflow mutation lock, after validation and BEFORE committing
 // the leave decision. Then reconcile a fresh authoritative snapshot after commit.
 // No historical decisions are discovered/backfilled by this operation.
 const prepareLeaveDecision=(event,row,decision)=>serial(async()=>{
  if(row['请假状态']!=='待审批'||!['待筛选','已确认'].includes(row['报名状态']))throw Error('No pending leave request');
  const message=leaveDecisionMessage(event,row,decision,origin),task=await enqueue(message,row);
  // A failed business write may be retried with revised notes. The request is
  // still pending, so replacing an unattempted intent is safe before commit.
  if(task['收件人']!==message.to||task['主题']!==message.subject||task['正文']!==message.text){
   if(task['状态']!=='待发送'||Number(task['尝试次数'])!==0)throw Error('Leave notification intent conflict');
   const values={收件人:message.to,主题:message.subject,正文:message.text};
   await patch(task,values);Object.assign(task,values);
  }
  return task;
 });
 const approvals=(events,accounts,{deliver=false}={})=>serial(async()=>{
  const messages=approvalMessages(events,accounts,origin),keys=new Set(messages.map(m=>m.idempotencyKey));
  for(const message of messages)await enqueue(message,{活动ID:message.activityId});
  let attempted=0;
  for(const row of await rows()){
   if(!String(row['幂等键']).startsWith('APPROVAL:'))continue;
   if(row['状态']==='发送中'){await patch(row,{状态:'结果待核对'});continue;}
   if(!['待发送','发送失败'].includes(row['状态']))continue;
   if(!keys.has(row['幂等键'])){if(['待发送','发送失败'].includes(row['状态']))await patch(row,{状态:'已取消'});continue;}
   const message=messages.find(m=>m.idempotencyKey===row['幂等键']);
   if(row['收件人']!==message.to){await patch(row,{状态:'结果待核对'});continue;}
   if(deliver&&attempted<10&&Number(row['尝试次数']||0)<5&&Date.parse(row['下次尝试']||'1970-01-01')<=now()){attempted++;await attempt(row);}
  }
  return {queued:messages.length,attempted};
 });
 return {reconcile,dispatch,approvals,prepareLeaveDecision,retryReviewed};
}
