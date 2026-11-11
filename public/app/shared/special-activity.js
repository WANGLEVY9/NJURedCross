import {shanghaiInstant} from './activity-window.js';
import {bloodWeekStart} from './activity-projects.js';

export const SPECIAL_ACTIVITY_TYPES=Object.freeze([
 {value:'schedule',label:'排班活动',mode:'schedule'},
 {value:'hospital-examination',label:'校医院体检',mode:'schedule'},
 {value:'hospital-vaccination',label:'校医院疫苗接种',mode:'schedule'},
 {value:'province-service',label:'省血液献血车',mode:'registry'},
 {value:'component-donation',label:'成分献血',mode:'completion'},
]);
export const SCHEDULE_ACTIVITY_NAMES=Object.freeze(['校医院体检','校医院疫苗接种']);
export const PROVINCE_SERVICE_LOCATIONS=Object.freeze(['大洋百货献血车','鼓楼广场献血车','大行宫献血车','浮桥献血车']);
export const REGISTRY_HOURS=Object.freeze({
 'province-service':Object.freeze({travelHours:2,trainingHours:2,serviceHours:4}),
 'component-donation':Object.freeze({travelHours:1,trainingHours:1,serviceHours:4}),
});
export function registryHours(event){
 let c;try{c=JSON.parse(event?.['报名页配置']||'{}');}catch{return null;}
 return c.registryHours||REGISTRY_HOURS[c.special?.type]||null;
}
const fail=message=>Object.assign(new Error(message),{statusCode:400,code:'special_activity_invalid'});
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const only=(value,keys)=>plain(value)&&Object.keys(value).every(key=>keys.includes(key));
export const specialType=value=>SPECIAL_ACTIVITY_TYPES.find(item=>item.value===value)||null;
export const scheduleType=value=>specialType(value)?.mode==='schedule';
export function specialSessionDeadline(event){
 try{
  const c=JSON.parse(event?.['报名页配置']||'{}'),s=c.special;
  if(s?.v!==1||!scheduleType(s?.type)||!s.rootId||!c.ordinary)return null;
  if(!Number.isInteger(s.cutoffMinutes)||s.cutoffMinutes<0||s.cutoffMinutes>43200||!shanghaiInstant(c.ordinary.start))return null;
  return new Date(Date.parse(c.ordinary.start)-Math.max(1440,s.cutoffMinutes)*60000).toISOString();
 }catch{return null;}
}
export function specialActivity(event){
 try{const c=JSON.parse(event?.['报名页配置']||'{}');return c.special?.v===1&&specialType(c.special?.type)?c.special:null;}catch{return null;}
}
export function validServiceDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Boolean(shanghaiInstant(value+'T00:00'));}
function text(value,label,max=120){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u001f]/.test(value))throw fail(label+'无效');return value.trim();}
function number(value,label,min,max){if(!['number','string'].includes(typeof value)||String(value).trim()===''||!Number.isFinite(Number(value))||Number(value)<min||Number(value)>max)throw fail(label+'无效');return Number(value);}
const time=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
/** Versioned, explicit opt-in. No activity-name guessing and no changes to old drafts. */
export function normalizeSpecialActivity(input,{date,endDate}={}){
 if(!only(input,['v','type','dates','places','cutoffMinutes','dailyCapacity'])||input.v!==1||!specialType(input.type))throw fail('专项类型无效');
 const result={v:1,type:input.type};
 if(scheduleType(input.type)){
  if(!validServiceDate(date)||!validServiceDate(endDate)||date>endDate)throw fail('请选择有效的服务日期范围');
  if(!Array.isArray(input.dates)||!input.dates.length||input.dates.length>120||new Set(input.dates).size!==input.dates.length||input.dates.some(day=>!validServiceDate(day)||day<date||day>endDate))throw fail('请选择日期范围内不重复的服务日期');
  result.dates=[...input.dates].sort();
  result.cutoffMinutes=number(input.cutoffMinutes,'提前截止分钟',0,43200);
  if(!Number.isInteger(result.cutoffMinutes))throw fail('提前截止分钟须为整数');
  if(!Array.isArray(input.places)||!input.places.length||input.places.length>20)throw fail('请设置服务岗位');
  const names=new Set();
  result.places=input.places.map(place=>{
   if(!only(place,['location','periods']))throw fail('服务岗位字段无效');
   const location=text(place.location,'服务岗位');if(names.has(location))throw fail('服务岗位重复');names.add(location);
   if(!Array.isArray(place.periods)||!place.periods.length||place.periods.length>10)throw fail('请设置服务时段');
   const periods=place.periods.map(period=>{
    if(!only(period,['start','end','capacity','serviceHours','trainingHours','travelHours'])||!time(period.start)||!time(period.end)||period.start>=period.end)throw fail('服务时段无效');
    const capacity=number(period.capacity,'每班名额',1,100000);if(!Number.isInteger(capacity))throw fail('每班名额须为整数');
    return {start:period.start,end:period.end,capacity,serviceHours:number(period.serviceHours,'服务时长',0.1,100000),trainingHours:number(period.trainingHours??0,'培训时长',0,100000),travelHours:number(period.travelHours??0,'交通时长',0,100000)};
   }).sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end));
   if(periods.some((period,i)=>i&&period.start<periods[i-1].end))throw fail('同一地点的服务时段不能重复或重叠');
   return {location,periods};
  });
  if(result.dates.length*result.places.reduce((sum,p)=>sum+p.periods.length,0)>200)throw fail('单个项目最多200个班次，请拆分服务日期范围');
 }else{
  if(['dates','places','cutoffMinutes'].some(key=>input[key]!==undefined))throw fail('登记活动不设置排班或报名时段');
  if(input.type==='province-service'){
   result.dailyCapacity=number(input.dailyCapacity,'每日名额',1,100000);
   if(!Number.isInteger(result.dailyCapacity))throw fail('每日名额须为整数');
  }else if(input.dailyCapacity!==undefined)throw fail('完成登记不设置报名名额');
 }
 return result;
}
/** Drafts may be incomplete. Persist only known business fields, never runtime records. */
export function normalizeSpecialDraft(input){
 if(!only(input,['v','type','dates','places','cutoffMinutes','dailyCapacity'])||input.v!==1||!specialType(input.type))throw fail('专项类型无效');
 if(!scheduleType(input.type))return normalizeSpecialActivity(input);
 if(!Array.isArray(input.dates)||input.dates.length>120||new Set(input.dates).size!==input.dates.length||input.dates.some(day=>!validServiceDate(day)))throw fail('排班日期无效');
 if(!Array.isArray(input.places)||input.places.length>20)throw fail('服务岗位无效');
 const places=input.places.map(place=>{
  if(!only(place,['location','periods'])||typeof place.location!=='string'||place.location.length>120||!Array.isArray(place.periods)||place.periods.length>10)throw fail('服务岗位字段无效');
  return {location:place.location.trim(),periods:place.periods.map(period=>{
   if(!only(period,['start','end','capacity','serviceHours','trainingHours','travelHours']))throw fail('服务时段字段无效');
   const row={};for(const key of ['start','end','capacity','serviceHours','trainingHours','travelHours']){
    if(period[key]!==undefined&&!['string','number'].includes(typeof period[key]))throw fail('服务时段字段无效');
    row[key]=String(period[key]??'');if(row[key].length>20)throw fail('服务时段字段过长');
   }return row;
  })};
 });
 const cutoffMinutes=number(input.cutoffMinutes??0,'提前截止分钟',0,43200);
 if(!Number.isInteger(cutoffMinutes))throw fail('提前截止分钟须为整数');
 return {v:1,type:input.type,dates:[...input.dates].sort(),places,cutoffMinutes};
}
/** Stable location order, then time. A selected date is the only way a day is generated. */
export function specialScheduleSessions(special){
 if(!scheduleType(special?.type))return [];
 return special.dates.flatMap(date=>special.places.flatMap((place,placeIndex)=>place.periods.map(period=>({date,location:place.location,placeIndex,...period,startAt:`${date}T${period.start}:00+08:00`,endAt:`${date}T${period.end}:00+08:00`,deadline:new Date(Date.parse(`${date}T${period.start}:00+08:00`)-Math.max(1440,special.cutoffMinutes)*60000).toISOString(),week:bloodWeekStart(date)}))));
}
export function normalizeCompletionRegistration(input,now=Date.now()){
 if(!only(input,['requestId','date','duration','quantity','photoId'])||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId||''))throw fail('登记请求标识无效');
 if(!validServiceDate(input.date)||input.date>new Date(now+8*3600000).toISOString().slice(0,10))throw fail('实际献血日期无效或晚于今天');
 const duration=number(input.duration,'实际献血时长',0.1,24),quantity=number(input.quantity,'献血量',1,1000);
 if(Math.round(duration*10)!==duration*10||!Number.isInteger(quantity))throw fail('时长最多一位小数，献血量须为正整数');
 if(!/^[a-f0-9-]{36}$/i.test(input.photoId||''))throw fail('请上传献血证截图或照片');
 return {v:1,requestId:input.requestId,date:input.date,duration,quantity,photoId:input.photoId};
}
/** Province service is a completed-service report, with private attendance proof. */
export function normalizeProvinceRegistration(input,now=Date.now()){
 if(!only(input,['requestId','date','start','end','location','photoId'])||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId||''))throw fail('登记字段或请求标识无效');
 if(!validServiceDate(input.date)||!time(input.start)||!time(input.end)||input.start>=input.end)throw fail('请填写有效的服务日期及起止时间');
 if(Date.parse(`${input.date}T${input.end}:00+08:00`)>now)throw fail('服务尚未完成，请完成后登记');
 if(!PROVINCE_SERVICE_LOCATIONS.includes(input.location))throw fail('请选择有效的服务岗位');
 if(!/^[a-f0-9-]{36}$/i.test(input.photoId||''))throw fail('请上传签到凭证');
 return {v:1,requestId:input.requestId,date:input.date,start:input.start,end:input.end,location:input.location,photoId:input.photoId};
}
