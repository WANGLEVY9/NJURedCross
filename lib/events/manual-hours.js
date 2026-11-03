import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {reviewDetails} from './hours-review.js';
import {registrationDetails} from './registration-schema.js';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode,code:'manual_hours_invalid'});
export const isManualHoursRegistration=row=>String(row?.['报名ID']||'').startsWith('WMH-');
export const manualHoursRequestId=row=>String(row?.['报名ID']||'').slice(4,40);
export function manualHoursDraft(request){
 if(!request)return null;
 return Object.fromEntries(['requestId','eventId','name','studentId','department','email','details','reason','evidenceChecked'].map(key=>[key,key==='evidenceChecked'?true:request[key]]));
}
export function manualHoursInput(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['requestId','eventId','token','month','name','studentId','department','email','details','reason','evidenceChecked'].includes(key)))throw fail('补录字段无效');
 if(body.month!==undefined&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month))throw fail('汇总月份无效');
 if(typeof body.requestId!=='string'||! /^[a-f0-9-]{36}$/i.test(body.requestId)||typeof body.eventId!=='string'||!body.eventId)throw fail('请重新打开人员补录窗口');
 const text=(key,max,required=true)=>{const value=body[key];if(typeof value!=='string'||value.trim().length>max||required&&!value.trim()||(key==='reason'?/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/:/[\u0000-\u001f]/).test(value))throw fail('请完整填写姓名、学号、院系和补录依据');return value.trim();};
 const result={requestId:body.requestId,eventId:body.eventId,name:text('name',80),studentId:text('studentId',32),department:text('department',120),email:text('email',160,false),reason:text('reason',500),details:body.details};
 if(!/^[0-9A-Za-z]{4,32}$/.test(result.studentId)||result.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))throw fail('学号或邮箱格式无效');
 if(body.evidenceChecked!==true)throw fail('请先核对实际服务及补录依据');
 if(!body.details||typeof body.details!=='object'||Array.isArray(body.details)||['serviceHours','trainingHours','travelHours','work','location','dates'].some(key=>!Object.hasOwn(body.details,key)))throw fail('请填写完整的实际服务明细');
 result.fingerprint=createHash('sha256').update(JSON.stringify(result)).digest('hex');return result;
}
function signature(secret,registration,checkin){
 return createHmac('sha256',typeof secret==='function'?secret():secret).update(JSON.stringify(['manual-hours-v1',registration['报名ID'],registration['活动ID'],registration['账号ID'],registration['姓名'],registration['学号'],checkin['核验人'],checkin['核验说明']])).digest('hex');
}
export function manualHoursEvidence(registration,checkin,secret){
 if(!isManualHoursRegistration(registration)||!checkin||checkin['报名行ID']!==registration._id||['活动ID','账号ID','姓名','学号'].some(key=>checkin[key]!==registration[key]))return false;
 const expected=`WMH-${signature(secret,registration,checkin)}`,actual=String(checkin['签到ID']||'');
 return actual.length===expected.length&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}
/** Writes real registration/evidence rows. It never creates an account or invents a photo. */
export function createManualHoursWriter({append,update,WF,secret,syncPosition,syncLinks,saveRequest=request=>request,now=()=>Date.now()}){
 return async function add(data,event,input,actor,participant){
  const details=reviewDetails(event,input.details);
  if(Number(details['服务时长'])+Number(details['培训时长'])+Number(details['交通时长'])<=0)throw fail('请填写大于零的实际时长');
  const receipt=saveRequest({...input,evidenceChecked:true,actor});actor=receipt.actor;
  const requestPrefix=`WMH-${input.requestId}-`,code=requestPrefix+createHash('sha256').update(JSON.stringify([input.fingerprint,actor])).digest('hex').slice(0,32);
  const identity={姓名:input.name,学号:input.studentId,院系:input.department,邮箱:input.email};
  const sameRequest=data.registrations.filter(row=>String(row['报名ID']).startsWith(requestPrefix));
  if(sameRequest.length>1)throw fail('补录记录重复，请联系管理员核对',409);
  let registration=sameRequest[0];
  const previous=data.registrations.filter(row=>row['活动ID']===event['活动ID']&&row['学号']===input.studentId&&row['报名状态']==='未入选'&&!isManualHoursRegistration(row));
  const note=`时长补录：${input.reason}`;
  if(registration&&(![code,`${code}-extra`].includes(registration['报名ID'])||['姓名','学号','院系','邮箱'].some(key=>String(registration[key]||'')!==identity[key])||registration['活动ID']!==event['活动ID']||registration['处理说明']!==note))throw fail('本次补录内容已改变，请关闭窗口重新添加',409);
  const existing=data.registrations.filter(row=>row._id!==registration?._id&&row['活动ID']===event['活动ID']&&row['学号']===input.studentId);
  if(existing.some(row=>!previous.includes(row)))throw fail('该同学在本班次已有报名记录，请修改原记录，不要重复添加',409);
  if(previous.some(row=>row['签到照片ID']||row['签到行ID']||data.checkins.some(line=>line['报名行ID']===row._id)||data.ledger.some(line=>line['报名行ID']===row._id)))throw fail('原未录取记录已有签到或时长依据，请先核对原记录',409);
  if(participant?.accountId&&previous.some(row=>row['账号ID']&&row['账号ID']!==participant.accountId))throw fail('原报名账号与核验身份不一致，请先核对',409);
  if(data.registrations.some(row=>row['学号']===input.studentId&&row['姓名']!==input.name))throw fail('同一学号已有不同姓名，请先核对身份',409);

  if(!registration){
   registration=await append(WF.registrations,{...registrationDetails(event),...identity,活动名称:event['活动名称'],活动类别:event['活动类别'],活动ID:event['活动ID'],账号ID:participant?.accountId||`manual:${input.studentId}`,报名ID:code,报名日期:event['报名日期'],报名时段:event['报名时段'],岗位:event['岗位'],报名状态:'已确认',是否报名成功:'true',录入状态:'网站待核对',处理说明:note,创建时间:new Date(now()).toISOString()});
   data.registrations.push(registration);
  }
  // 原未录取记录保留不动；独立补录行不进入已冻结的初审名单。
  await syncPosition(event,registration,{previousCodes:previous.map(row=>row['报名ID']).filter(Boolean)});
  let checkin=data.checkins.find(row=>row['报名行ID']===registration._id);
  if(!checkin){
   checkin={报名行ID:registration._id,活动ID:event['活动ID'],账号ID:registration['账号ID'],姓名:input.name,学号:input.studentId,活动时间:new Date(now()).toISOString(),核验人:actor,核验说明:note};
   checkin['签到ID']=`WMH-${signature(secret,registration,checkin)}`;
   checkin=await append(WF.checkins,checkin);data.checkins.push(checkin);
  }
  if(!manualHoursEvidence(registration,checkin,secret))throw fail('补录核验依据不一致，请联系管理员核对',409);
  if(registration['签到行ID']!==checkin._id||registration['报名状态']!=='已签到'){
   const patch={签到行ID:checkin._id,报名状态:'已签到'};await update(WF.registrations,registration,patch);Object.assign(registration,patch);
  }
  await syncLinks(registration,data);
  return {registration,checkin,details};
 };
}
