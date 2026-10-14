/** Persistent vacancy subscriptions. Public payloads never include recipients. */
import { randomUUID } from 'node:crypto';
import { createMutationQueue } from './safety.js';
import { workflowRows, workflowEventApproved } from './workflow.js';
import { workflowConfig } from './blood-roster.js';
import {ordinaryRegistrationOpen,sessionWindow} from './ordinary-groups.js';
export const WISHLIST_SCHEMA={name:'网站献血车心愿清单',columns:['订阅ID','活动ID','账号ID','邮箱','状态','创建时间','提醒时间','尝试时间']};
const conflict=message=>Object.assign(new Error(message),{statusCode:409});
export function remainingPlaces(event, registrations){const config=workflowConfig(event);if(config.managed)return Math.max(0,Number(config.remaining)||0);return Math.max(0,Number(event['容量'])-Number(config.sourceOccupied||0)-registrations.filter(r=>[event['活动ID'],...(config.sourceActivityIds||[])].includes(r['活动ID'])&&['待筛选','已确认','已签到'].includes(r['报名状态'])).length);}
function eventStart(event){const config=workflowConfig(event);return Date.parse(sessionWindow(event)?.start||config.startAt||`${event['报名日期']}T00:00:00+08:00`);}
function approved(event){return workflowConfig(event).managed||workflowEventApproved(event);}
function ownsRegistration(event,row,accountId){return row['账号ID']===accountId&&[event['活动ID'],...(workflowConfig(event).sourceActivityIds||[])].includes(row['活动ID'])&&['待筛选','待确认','已确认','已签到','候补'].includes(row['报名状态']);}
export function createWishlist(base,workflow,{sendMail,origin,getManagedData,now=()=>Date.now()}={}){
 const serial=createMutationQueue();let delivering=false;
 const rows=()=>workflowRows(base,WISHLIST_SCHEMA.name);
 const patch=(row,value)=>base.updateRow(WISHLIST_SCHEMA.name,row._id,value);
 const own=async account=>(await rows()).filter(r=>r['账号ID']===account.accountId&&r['状态']==='等待空位').map(r=>({eventId:r['活动ID'],createdAt:r['创建时间']}));
 async function read(includeManaged){const data=await workflow.publicRead();if(!includeManaged||!getManagedData)return data;const managed=await getManagedData();return {events:[...data.events,...managed.events],registrations:[...data.registrations,...managed.registrations]};}
 async function subscribe(id,account){return serial(async()=>{
  if(!account.accountId||!account.emailVerified||!account.email)throw conflict('请先验证校园邮箱');
  const data=await read(id.startsWith('managed:')),event=data.events.find(e=>e._id===id);
  if(!event||event['状态']!=='报名中'||!approved(event)||!Number.isFinite(eventStart(event))||eventStart(event)<=now()||!ordinaryRegistrationOpen(event,now())||(workflowConfig(event).registrationEnd&&Date.parse(workflowConfig(event).registrationEnd)<=now()))throw conflict('该活动不能订阅');
  if(data.registrations.some(r=>ownsRegistration(event,r,account.accountId)))throw conflict('你已报名此活动');
  const previous=(await rows()).find(r=>r['账号ID']===account.accountId&&r['活动ID']===id&&r['状态']==='等待空位');if(previous)return;
  if(remainingPlaces(event,data.registrations)>0)throw conflict('该班次已有空位，可以直接报名');
  const result=await base.appendRow(WISHLIST_SCHEMA.name,{订阅ID:randomUUID(),活动ID:id,账号ID:account.accountId,邮箱:account.email,状态:'等待空位',创建时间:new Date(now()).toISOString()});if(!result?._id)throw conflict('订阅结果尚未确认，请刷新查看');
 });}
 async function unsubscribe(id,account){return serial(async()=>{for(const row of await rows())if(row['账号ID']===account.accountId&&row['活动ID']===id&&row['状态']==='等待空位')await patch(row,{状态:'已取消'});});}
 async function deliver(){if(delivering)return;delivering=true;try{
  const subscriptions=(await rows()).filter(r=>r['状态']==='等待空位');if(!subscriptions.length)return;
  const data=await read(subscriptions.some(row=>row['活动ID'].startsWith('managed:')));
  for(const subscription of subscriptions){
   const event=data.events.find(e=>e._id===subscription['活动ID']),start=event?eventStart(event):NaN;
   if(!event||!Number.isFinite(start)||start<=now()||event['状态']!=='报名中'||!ordinaryRegistrationOpen(event,now())||(workflowConfig(event).registrationEnd&&Date.parse(workflowConfig(event).registrationEnd)<=now())){await serial(async()=>{const fresh=(await rows()).find(r=>r._id===subscription._id);if(fresh?.['状态']==='等待空位')await patch(fresh,{状态:'已到期'});});continue;}
   if(!approved(event)||remainingPlaces(event,data.registrations)===0)continue;
   // Serialize against cancellation. Failures retry after five minutes; subscription ID is the mail idempotency key.
   await serial(async()=>{const fresh=(await rows()).find(r=>r._id===subscription._id);if(fresh?.['状态']!=='等待空位'||now()-Date.parse(fresh['尝试时间']||'1970-01-01')<300000)return;
    if(data.registrations.some(r=>ownsRegistration(event,r,fresh['账号ID']))){await patch(fresh,{状态:'已报名'});return;}
    await patch(fresh,{尝试时间:new Date(now()).toISOString()});
    const blood=Boolean(workflowConfig(event).blood);
    const link=workflowConfig(event).managed?`/events/${encodeURIComponent(event['活动ID'])}`:blood?`/workflow-events?type=blood&slot=${encodeURIComponent(event._id)}`:`/workflow-events?event=${encodeURIComponent(event._id)}`;
    const result=await sendMail({to:fresh['邮箱'],subject:blood?'献血车班次有空位了':'你关注的活动有空位了',kind:blood?'blood-vacancy':'activity-vacancy',idempotencyKey:`blood-wishlist:${fresh['订阅ID']}`,text:`你关注的活动现在有空位：\n${event['活动名称']}\n${event['报名日期']} ${event['报名时段']}\n${event['地点']}\n\n查看并报名：${origin}${link}\n\n此邮件是空位提醒，名额以提交报名时的实际情况为准。`});
    if(result.ok)await patch(fresh,{状态:'已提醒',提醒时间:new Date(now()).toISOString()});
   });
  }
 }finally{delivering=false;}}
 return {own,subscribe,unsubscribe,deliver};
}
