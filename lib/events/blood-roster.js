/** Read-only adaptation of the existing weekly blood-vehicle roster template. */
const days=['周一','周二','周三','周四','周五','周六','周日'];
import { BLOOD_POINTS } from '../../public/app/shared/blood-points.js';
export { BLOOD_POINTS };
export const BLOOD_SHIFTS=['上午 11~15点','下午 14~18点','下午 15~19点','上午 10~14点','下午 13~17点'];
const error=message=>Object.assign(new Error(message),{statusCode:400,code:'blood_roster_invalid'});
export function rosterTimes(date,slot){
 const m=slot.match(/(?:上午|下午)\s*(\d{1,2})~(\d{1,2})点/);
 if(!m||+m[1]>=+m[2]||+m[2]>23)throw error('班次格式不符合现有排班规则');
 return {start:`${date}T${m[1].padStart(2,'0')}:00:00+08:00`,end:`${date}T${m[2].padStart(2,'0')}:00:00+08:00`};
}
export function bloodRosterDrafts(rows,body){
 const date=String(body.monday||'');const monday=new Date(`${date}T00:00:00Z`);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(+monday)||monday.toISOString().slice(0,10)!==date||new Date(`${date}T00:00:00Z`).getUTCDay()!==1)throw error('排班起始日必须是有效的周一日期');
 if(!Number.isInteger(Number(body.week))||Number(body.week)<1||Number(body.week)>999)throw error('请明确填写原表使用的周次');
 if(!rows.length||rows.length>100)throw error('排班模板为空或过大');
 const keys=new Set();return rows.map(row=>{
  const offset=days.indexOf(row['序号']);if(offset<0||!BLOOD_POINTS.includes(row['点位'])||!BLOOD_SHIFTS.includes(row['活动时间']))throw error('模板日期、点位或班次需要人工校对');
  const day=new Date(Date.parse(`${date}T00:00:00Z`)+offset*86400000).toISOString().slice(0,10),key=`${day}|${row['点位']}|${row['活动时间']}`;
  if(keys.has(key))throw error('排班模板存在重复日期点位班次');keys.add(key);
  return {name:`市血液献血车 · 第${body.week}周 · ${row['点位']}`,category:'献血车志愿服务',date:day,slot:row['活动时间'],location:row['点位'],position:'献血车志愿服务岗',capacity:body.capacity,serviceHours:body.serviceHours,trainingHours:body.trainingHours??0,travelHours:body.travelHours??0,work:'按点位与班次开展志愿服务；签到照片须体现日期时间，时长由管理员核对。',blood:{mode:'blood_vehicle',week:Number(body.week),templateId:row._id,key,...rosterTimes(day,row['活动时间'])}};
 });
}
export function workflowConfig(event){try{return JSON.parse(event['报名页配置']||'{}');}catch{return{};}}
export function registrationResult(row){if(row['报名状态']==='未入选')return '报名失败';if(['已确认','已签到'].includes(row['报名状态']))return '报名成功';if(row['报名状态']==='已请假')return '已请假';return '待确认';}
