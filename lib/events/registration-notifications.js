/** Single-process durable confirmation delivery; ambiguous SMTP outcomes require review. */
import {readPagedRows} from '../http/paged-rows.js';
import {createMutationQueue} from './safety.js';
import {rosterMailKey,rosterReview} from '../../public/app/shared/roster-review.js';
export const NOTIFICATION_TABLE='网站报名通知任务表';
export const NOTIFICATION_COLUMNS=['幂等键','报名ID','活动ID','状态','收件人','主题','正文','尝试次数','下次尝试','更新时间'];
export function confirmationMessage(event,row,origin){
 const url=new URL(origin);if(url.protocol!=='https:')throw Error('Notification origin must use HTTPS');
 if(!/^\d+@(smail\.nju\.edu\.cn|nju\.edu\.cn)$/.test(row['邮箱']||'')||row['邮箱'].split('@')[0]!==row['学号'])throw Error('Invalid verified participant address');
 return {to:row['邮箱'],subject:`南大红会｜${event['活动名称']}报名成功`,kind:'workflow-result',idempotencyKey:rosterMailKey(row),text:`${row['姓名']}同学：\n你的报名已确认成功。\n\n活动：${event['活动名称']}\n日期：${row['报名日期']}\n时段：${row['报名时段']}\n地点：${event['地点']||row['地点']||'请查看活动详情'}\n岗位：${row['岗位']||'请查看活动详情'}\n报名编号：${row['报名ID']}\n\n查看报名：${url.origin}/workflow-events?event=${encodeURIComponent(event._id)}\n如不能参加，请在平台申请取消，管理员批准后方可释放名额。\n服务时长以活动规则及签到核验后的正式录入结果为准。`};
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
  for(const row of await rows())if(row['状态']==='发送中')await patch(row,{状态:'结果待核对'});
  let queued=0;
  for(const row of data.registrations){
   if(!['已确认','已签到'].includes(row['报名状态'])||row['请假状态']==='待审批')continue;
   const event=data.events.find(e=>e['活动ID']===row['活动ID']);if(!event||rosterReview(event))continue; // Existing reviewed-roster delivery uses dispatch below.
   const config=JSON.parse(event['报名页配置']||'{}');
   if(config.source?.kind==='generated_blood'&&row['岗位同步状态']!=='已同步')continue;
   await enqueue(confirmationMessage(event,row,origin),row);queued++;
  }
  const current=await rows();let attempted=0;
  for(const row of current){
   const registration=data.registrations.find(r=>r['报名ID']===row['报名ID']);
   // Reviewed results without a registration reference retry only through the reviewed workbench.
   if(!row['报名ID'])continue;
   if(!registration||!['已确认','已签到'].includes(registration['报名状态'])){if(['待发送','发送失败'].includes(row['状态']))await patch(row,{状态:'已取消'});continue;}
   if(registration['请假状态']==='待审批')continue;
   if(row['收件人']!==registration['邮箱']){if(['待发送','发送失败'].includes(row['状态']))await patch(row,{状态:'结果待核对'});continue;}
   if(['待发送','发送失败'].includes(row['状态'])&&attempted++<10)await attempt(row);
  }
  return {queued};
 });}
 // Reviewed roster calls share the same durable intent and receipt, including negative outcomes.
 const dispatch=message=>serial(async()=>attempt(await enqueue(message)));
 return {reconcile,dispatch};
}
