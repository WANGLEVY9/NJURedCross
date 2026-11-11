import {bloodWeekStart,bloodWeekEnd} from '../../public/app/shared/activity-projects.js';
import {ORDINARY_GROUP_TABLE} from './ordinary-groups.js';

export const DUTY_NAME='省红会组宣部值班';
const KEY='recurring:province-publicity-duty';
const addDays=(date,count)=>new Date(Date.parse(date+'T00:00:00Z')+count*86400000).toISOString().slice(0,10);
/** Materialize normal workflow rows under its existing write lock. Never touch the municipal source table. */
export function createRecurringDuty({rows,append,update,prepare,approveHash,assignApproval,store,now,eventsTable}){
 const status=()=>({enabled:false,capacity:1,...store.information(KEY)});
 async function generate(){
  const settings=status();if(!settings.enabled)return {generated:0};
  const today=new Date(now()+8*3600000).toISOString().slice(0,10),monday=bloodWeekStart(today);
  const stored=await rows(eventsTable),groups=await rows(ORDINARY_GROUP_TABLE);let generated=0;
  // Keep this and the next two weeks available. The timer extends this horizon indefinitely.
  for(let week=0;week<3;week++){
   const start=addDays(monday,week*7),groupId='DUTY-'+start;
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
    const found=stored.filter(e=>e['活动ID']===activityId);if(found.length>1)throw Error('省红会值班班次重复，请核对');if(found.length)continue;
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
  return {generated,through:bloodWeekEnd(addDays(monday,14))};
 }
 return {status,generate,async configure(input,actor){
  if(!input||typeof input.enabled!=='boolean'||Object.keys(input).some(k=>k!=='enabled'))throw Object.assign(Error('值班开关参数无效'),{statusCode:400});
  const old=status(),startDate=new Date(now()+8*3600000).toISOString().slice(0,10);
  store.setInformation(KEY,{...old,enabled:input.enabled,actor,startDate:old.startDate||startDate,capacity:1});
  // Stop/reopen only unarchived weeks; registration and evidence rows are retained.
  const events=await rows(eventsTable),groups=await rows(ORDINARY_GROUP_TABLE);
  for(const group of groups.filter(g=>String(g['活动组ID']).startsWith('DUTY-')&&g['状态']==='已发布')){
   const members=events.filter(e=>JSON.parse(e['报名页配置']||'{}').ordinary?.groupId===group['活动组ID']);
   if(members.length&&members.every(e=>!JSON.parse(e['报名页配置']||'{}').workspaceRemoval&&!store.get(`schedule:PROVINCE-PUBLICITY-DUTY:${bloodWeekStart(e['报名日期'])}:hours-archive`)))await update(ORDINARY_GROUP_TABLE,group,{报名开关:input.enabled?'开放':'关闭'});
  }
  if(input.enabled)await generate();return status();
 }};
}
