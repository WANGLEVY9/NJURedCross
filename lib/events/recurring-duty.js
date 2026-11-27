import {bloodWeekStart,bloodWeekEnd} from '../../public/app/shared/activity-projects.js';
import {ORDINARY_GROUP_TABLE} from './ordinary-groups.js';

import {DUTY_NAME,DUTY_CAPACITY,specialSessionDeadline} from '../../public/app/shared/special-activity.js';
import {noticeTemplate} from '../../public/app/shared/activity-management.js';
export {DUTY_NAME};
const KEY='recurring:province-publicity-duty';
const addDays=(date,count)=>new Date(Date.parse(date+'T00:00:00Z')+count*86400000).toISOString().slice(0,10);
/** Materialize normal workflow rows under its existing write lock. Never touch the municipal source table. */
export function createRecurringDuty({rows,append,update,prepare,approveHash,assignApproval,store,now,eventsTable,evidenceTables}){
 const status=()=>({enabled:false,mode:'rolling',weeks:[],...store.information(KEY),capacity:DUTY_CAPACITY,currentWeek:bloodWeekStart(new Date(now()+8*3600000).toISOString().slice(0,10))});
 async function generate(){
  const settings=status();if(!settings.enabled)return {generated:0};
  const today=new Date(now()+8*3600000).toISOString().slice(0,10),monday=bloodWeekStart(today);
  const stored=await rows(eventsTable),groups=await rows(ORDINARY_GROUP_TABLE);let generated=0;
  let protectedActivities;
  async function upgradeCapacity(row,groupId){
   const config=JSON.parse(row['报名页配置']||'{}');
   // Only migrate intact one-seat managed shifts that can still accept bookings.
   // Historical capacity participates in hours evidence hashes and must stay frozen.
   const deadline=specialSessionDeadline(row);
   if(config.recurringDuty!==true||config.special?.rootId!=='PROVINCE-PUBLICITY-DUTY'||config.ordinary?.groupId!==groupId||row['状态']!=='报名中'||Number(row['容量'])!==1||Number(config.capacity)!==1||config.registrationLimit!==undefined&&Number(config.registrationLimit)!==1||config.runningReview||config.finalHours||!deadline||Date.parse(deadline)<=now()||row['批准摘要']!==approveHash(row))return;
   if(!protectedActivities)protectedActivities=new Set((await Promise.all(evidenceTables.map(rows))).flat().map(entry=>entry['活动ID']));
   if(protectedActivities.has(row['活动ID']))return;
   const next={...config,capacity:DUTY_CAPACITY,...(config.registrationLimit!==undefined?{registrationLimit:DUTY_CAPACITY}:{})};
   const patch={容量:String(DUTY_CAPACITY),报名页配置:JSON.stringify(next)};
   if(row['通知草稿']===noticeTemplate(config))patch['通知草稿']=noticeTemplate(next);
   patch['批准摘要']=approveHash({...row,...patch});
   await update(eventsTable,row,patch);Object.assign(row,patch);
  }
  // Manual selections stay fixed; rolling mode extends the three-week horizon.
  const starts=settings.mode==='manual'?settings.weeks.filter(day=>day>=monday).sort():Array.from({length:3},(_,i)=>addDays(monday,i*7));
  for(const start of starts){
   const groupId='DUTY-'+start;
   const matches=groups.filter(g=>g['活动组ID']===groupId);if(matches.length>1)throw Error('省红会值班活动组重复，请核对');
   let group=matches[0];
   const published=group?.['状态']==='已发布';
   const members=stored.filter(e=>JSON.parse(e['报名页配置']||'{}').ordinary?.groupId===groupId);
   if(store.get(`schedule:PROVINCE-PUBLICITY-DUTY:${start}:hours-archive`)||members.some(e=>JSON.parse(e['报名页配置']||'{}').workspaceRemoval))continue;
   const dates=Array.from({length:5},(_,i)=>addDays(start,i));
   if(!dates.length)continue;
   if(!group)group=await append(ORDINARY_GROUP_TABLE,{活动组ID:groupId,活动名称:DUTY_NAME,组织类别:'排班专项',活动地区:'南京地区',负责人账号ID:settings.actor,班次数:dates.length*2,报名截止:dates.at(-1)+'T09:00:00+08:00',报名开关:'关闭',状态:'草稿',修改人:settings.actor,更新时间:new Date(now()).toISOString()});
   for(const date of dates)for(const [startTime,endTime]of [['09:00','12:00'],['14:00','17:00']]){
    const activityId=`DUTY-${date}-${startTime.slice(0,2)}`;
    const found=stored.filter(e=>e['活动ID']===activityId);if(found.length>1)throw Error('省红会值班班次重复，请核对');if(found.length){await upgradeCapacity(found[0],groupId);continue;}
    let row=prepare({name:DUTY_NAME,category:'排班专项',center:'排班专项',region:'南京活动',date,slot:startTime+'-'+endTime,position:'省红会组宣部',location:'省红会组宣部',capacity:settings.capacity,serviceHours:3,trainingHours:1,travelHours:1,work:'服务地址：江苏省红十字会，上海路15号银城大厦8楼。协助组宣部老师完成信息统计与收集等工作。服务满20小时可向省红会组宣部申请相关证明。',ordinary:{groupId,start:`${date}T${startTime}:00+08:00`,end:`${date}T${endTime}:00+08:00`,campus:'',hoursPending:false}});
    const c=JSON.parse(row['报名页配置']);c.special={v:1,type:'schedule',rootId:'PROVINCE-PUBLICITY-DUTY',week:start,cutoffMinutes:1440};c.recurringDuty=true;
    Object.assign(row,{活动ID:activityId,负责人账号ID:settings.actor,申请版本:'1',批准版本:'1',状态:'报名中',审批人:settings.actor,审批时间:new Date(now()).toISOString(),创建时间:new Date(now()).toISOString(),报名页配置:JSON.stringify(c)});
    row=await assignApproval(row);
    row=Object.fromEntries(Object.entries(row).map(([key,value])=>[key,String(value??'')]));
    row['批准摘要']=approveHash(row);
    stored.push(await append(eventsTable,row));generated++;
   }
   await update(ORDINARY_GROUP_TABLE,group,{状态:'已发布',班次数:dates.length*2,报名开关:published?group['报名开关']:'开放',更新时间:new Date(now()).toISOString()});
  }
  return {generated,through:starts.length?bloodWeekEnd(starts.at(-1)):null};
 }
 return {status,generate,async configure(input,actor){
  if(!input||typeof input.enabled!=='boolean'||Object.keys(input).some(k=>!['enabled','mode','weeks'].includes(k))||input.mode!==undefined&&!['rolling','manual'].includes(input.mode)||input.weeks!==undefined&&(!Array.isArray(input.weeks)||input.weeks.length>52||new Set(input.weeks).size!==input.weeks.length||input.weeks.some(day=>typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day||bloodWeekStart(day)!==day)))throw Object.assign(Error('值班周次配置无效，请选择有效且不重复的周一日期'),{statusCode:400});
  const old=status(),startDate=new Date(now()+8*3600000).toISOString().slice(0,10);
  const next={...old,enabled:input.enabled,mode:input.mode??old.mode,weeks:input.weeks??old.weeks,actor,startDate:old.startDate||startDate,capacity:DUTY_CAPACITY};
  store.setInformation(KEY,next);
  // Stop/reopen only unarchived weeks; registration and evidence rows are retained.
  const events=await rows(eventsTable),groups=await rows(ORDINARY_GROUP_TABLE);
  for(const group of groups.filter(g=>String(g['活动组ID']).startsWith('DUTY-')&&g['状态']==='已发布')){
   const members=events.filter(e=>JSON.parse(e['报名页配置']||'{}').ordinary?.groupId===group['活动组ID']);
   const openWeeks=next.mode==='manual'?next.weeks:Array.from({length:3},(_,i)=>addDays(next.currentWeek,i*7));
   if(members.length&&members.every(e=>!JSON.parse(e['报名页配置']||'{}').workspaceRemoval&&!store.get(`schedule:PROVINCE-PUBLICITY-DUTY:${bloodWeekStart(e['报名日期'])}:hours-archive`)))await update(ORDINARY_GROUP_TABLE,group,{报名开关:input.enabled&&openWeeks.includes(String(group['活动组ID']).slice(5))?'开放':'关闭'});
  }
  if(input.enabled)await generate();return status();
 }};
}
