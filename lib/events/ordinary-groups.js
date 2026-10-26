/** General multi-session activities. Parent controls are separate from immutable approved sessions. */
export const ORDINARY_GROUP_TABLE='网站普通活动项目表';
export const ORDINARY_GROUP_COLUMNS=['活动组ID','活动名称','负责人账号ID','班次数','报名截止','报名开关','状态','修改人','更新时间'];
const fail=message=>Object.assign(new Error(message),{statusCode:409});
export function ordinaryConfig(row){try{return JSON.parse(row['报名页配置']||'{}').ordinary||null;}catch{return null;}}
export function publicOrdinarySession(row){const c=ordinaryConfig(row);return c?Object.fromEntries(['groupId','start','end','campus','hoursPending','registrationMode','cancelMode'].map(k=>[k,c[k]])):null;}
export function sessionWindow(row){const c=ordinaryConfig(row);if(c)return {start:c.start,end:c.end};try{return JSON.parse(row['报名页配置']||'{}').blood||null;}catch{return null;}}
export function ordinaryRegistrationOpen(row,now=Date.now()){
 if(!ordinaryConfig(row))return true;
 let settings;try{settings=JSON.parse(row['报名页配置']||'{}');}catch{return false;}
 if(settings.publishAt&&(!Number.isFinite(Date.parse(settings.publishAt))||Date.parse(settings.publishAt)>now))return false;
 const c=row.registrationControl;
 return Boolean(c&&c.enabled&&Number.isFinite(Date.parse(c.deadline))&&now<Date.parse(c.deadline)&&now<Date.parse(ordinaryConfig(row).start));
}
export function validateOrdinarySession(input,date){
 if(!input||typeof input!=='object'||Array.isArray(input))throw fail('普通班次配置无效');
 const {groupId,start,end,campus,hoursPending}=input;
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(groupId||'')||campus&&!['鼓楼','仙林','浦口','苏州'].includes(campus)||typeof hoursPending!=='boolean')throw fail('活动组、校区或时长规则无效');
 for(const value of [start,end])if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(value||'')||!Number.isFinite(Date.parse(value))||new Date(Date.parse(value)+8*3600000).toISOString().slice(0,19)!==value.slice(0,19))throw fail('普通班次起止时间无效');
 if(start.slice(0,10)!==date)throw fail('普通班次开始日期无效');
 if(Date.parse(end)<=Date.parse(start))throw fail('结束时间必须晚于开始时间');
 return {groupId,start,end,campus,hoursPending,registrationMode:'direct',cancelMode:'review'};
}
export function attachOrdinaryControls(events,groups){
 return events.map(row=>{
  const config=ordinaryConfig(row);if(!config)return row;
  const matches=groups.filter(g=>g['活动组ID']===config.groupId);
  if(matches.length!==1)throw fail('普通活动项目不存在或重复，请管理员对账');
  const g=matches[0];
  return {...row,组织类别:g['组织类别']||row['组织类别'],活动地区:g['活动地区']||row['活动地区'],registrationControl:{deadline:g['报名截止'],published:g['状态']==='已发布',enabled:g['报名开关']==='开放'&&g['状态']==='已发布',groupName:g['活动名称']}};
 });
}
