import {createHash} from 'node:crypto';
import {normalizeCompletionRegistration,validServiceDate} from '../../public/app/shared/special-activity.js';
import {registrationDetails,cellText} from './registration-schema.js';
const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode,code:'special_registry_conflict'});
export const registryType=event=>{try{const c=JSON.parse(event?.['报名页配置']||'{}');return c.special?.v===1&&['province-service','component-donation'].includes(c.special.type)?c.special.type:null;}catch{return null;}};
export function registryMetadata(row){
 try{const meta=JSON.parse(cellText(row?.['备注2']));return meta?.v===1&&meta.kind==='service-registry'&&['province-service','component-donation'].includes(meta.type)?meta:null;}catch{return null;}
}
const fingerprint=input=>createHash('sha256').update(JSON.stringify(input)).digest('hex');
function identity(account){
 if(!account?.accountId||!account.realName||!account.studentId||account.emailVerified!==true||!/^\d+@(smail\.nju\.edu\.cn|nju\.edu\.cn)$/.test(account.email||'')||account.email.split('@')[0]!==account.studentId)throw fail(403,'请使用已验证且学号一致的校园邮箱账号登记');
}
/** Uses the existing typed registration writer and the same durable business write lock. */
export function createSpecialRegistry({read,write,writeReview=write,append,update,WF,approved,authorize,verify,now=()=>Date.now()}){
 async function context(id){const data=await read(),event=data.events.find(e=>e._id===id);if(!event||!registryType(event)||!approved(event))throw fail(409,'登记项目不存在或配置需核对');return {data,event,type:registryType(event)};}
 return {
  async list(id,account){
   const {data,event,type}=await context(id);
   if(account)identity(account);
   return {event,type,rows:data.registrations.filter(r=>r['活动ID']===event['活动ID']&&(!account||r['账号ID']===account.accountId)).map(row=>({...row,registry:registryMetadata(row)})).sort((a,b)=>String(b['报名日期']).localeCompare(String(a['报名日期']))||String(a['创建时间']).localeCompare(String(b['创建时间'])))};
  },
  register:(id,input,account)=>write(async()=>{
   identity(account);const {data,event,type}=await context(id);
   if(event['状态']!=='进行中')throw fail(409,'本项目已结束登记，历史记录仍可查看');
   let registration;
   if(type==='component-donation')registration=normalizeCompletionRegistration(input,now());
   else{
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['requestId','date'].includes(k))||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId||'')||!validServiceDate(input.date))throw fail(400,'请选择服务日期');
    registration={requestId:input.requestId,date:input.date};
   }
   const digest=fingerprint(Object.fromEntries(Object.entries(registration).filter(([key])=>key!=='photoId'))),prior=data.registrations.filter(r=>r['活动ID']===event['活动ID']);
   const retry=prior.filter(r=>registryMetadata(r)?.requestId===registration.requestId);
   if(retry.length){if(retry.length!==1||retry[0]['账号ID']!==account.accountId||registryMetadata(retry[0]).digest!==digest)throw fail(409,'登记请求已使用，请刷新核对原记录');return retry[0];}
   const sameDay=prior.filter(r=>r['报名日期']===registration.date&&(r['账号ID']===account.accountId||r['学号']===account.studentId));
   const correction=sameDay.length===1&&sameDay[0]['账号ID']===account.accountId&&registryMetadata(sameDay[0])?.state==='returned'&&!data.ledger.some(l=>l['报名行ID']===sameDay[0]._id)?sameDay[0]:null;
   if(sameDay.length&&!correction)throw fail(409,'这一天已有登记，请查看我的登记记录');
   if(type==='province-service'){
    const quota=JSON.parse(event['报名页配置']).special.dailyCapacity;
    if(!Number.isInteger(quota)||quota<1)throw fail(409,'每日名额配置无效，请联系管理员');
    if(prior.filter(r=>r['报名日期']===registration.date&&registryMetadata(r)?.state!=='returned').length>=quota)throw fail(409,'这一天的登记名额已满，请选择其他日期');
   }
   const meta={...registration,v:1,kind:'service-registry',type,digest,state:'pending',revision:correction?registryMetadata(correction).revision+1:1};
   const values={...registrationDetails(event,account),活动名称:event['活动名称'],报名ID:correction?.['报名ID']||'REG-'+event['活动ID']+'-'+registration.requestId,活动ID:event['活动ID'],账号ID:account.accountId,学号:account.studentId,姓名:account.realName,邮箱:account.email,院系:account.department||'',校区:account.campus||'',报名日期:registration.date,报名时段:'',岗位:'',报名状态:'待筛选',是否报名成功:'false',录入状态:'网站待核对',志愿时长:'',献血量:type==='component-donation'?registration.quantity:'',备注2:JSON.stringify(meta),创建时间:correction?.['创建时间']||new Date(now()).toISOString()};
   if(correction){await update(WF.registrations,correction,values);return {...correction,...values};}
   return append(WF.registrations,values);
  }),
  decide:(id,items,decision,reason,actor)=>writeReview(async()=>{
   const {data,event}=await context(id);await authorize(event,actor);
   if(!Array.isArray(items)||!items.length||items.length>100||new Set(items.map(x=>x.id)).size!==items.length||!['verify','return'].includes(decision)||typeof reason!=='string'||!reason.trim()||reason.length>400)throw fail(400,'请选择有效记录并填写核验说明');
   const targets=items.map(item=>{const row=data.registrations.find(r=>r._id===item.id&&r['活动ID']===event['活动ID']),meta=registryMetadata(row);if(!row||!meta||meta.revision!==item.revision||meta.state!=='pending'||data.ledger.some(l=>l['报名行ID']===row._id))throw fail(409,'所选记录已变化，请刷新核对');return {row,meta};});
   const results=[];
   for(const {row,meta}of targets){
    // A verified certificate remains separate from final hours approval and posting.
    if(decision==='verify')await verify(event,row,meta,actor,reason.trim(),data);
    const next={...meta,state:decision==='verify'?'verified':'returned',revision:meta.revision+1,reason:reason.trim(),verifiedBy:actor,verifiedAt:new Date(now()).toISOString()};
    await update(WF.registrations,row,{备注2:JSON.stringify(next),处理说明:reason.trim()});results.push({id:row._id,ok:true});
   }
   return {results};
  }),
 };
}
