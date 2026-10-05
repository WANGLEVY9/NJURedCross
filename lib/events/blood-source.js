/** Read generated roster definitions; never copy or expose legacy participant identities. */
import { createHash } from 'node:crypto';
import { BLOOD_POINTS, BLOOD_SHIFTS, rosterTimes } from './blood-roster.js';
export const BLOOD_SOURCE_TABLE = '市血液献血车排班表（汇总底表）';
const hash = value => createHash('sha256').update(value).digest('hex').slice(0,24);
export function generatedBloodEvents(rows, now = Date.now()) {
 const groups = new Map();
 for (const row of rows) {
  const date=String(row['日期']||'').slice(0,10),location=row['点位'],slot=row['活动时间'];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!BLOOD_POINTS.includes(location)||!BLOOD_SHIFTS.includes(slot)||!Number.isInteger(Number(row['周次']))||Number(row['周次'])<1)continue;
  if(!Number.isFinite(Date.parse(`${date}T00:00:00Z`))||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date)continue;
  const times=rosterTimes(date,slot);
  const key=`${date}|${location}|${slot}`;
  let group=groups.get(key);
  if(!group){group={date,location,slot,times,key,week:Number(row['周次']),ids:[],occupied:0,stopped:0};groups.set(key,group);}
  if(group.week!==Number(row['周次']))throw Object.assign(new Error('同一献血车班次的周次不一致'),{statusCode:409});
  group.ids.push(row._id);
  // A legacy reservation occupies a slot even if its result is still pending.
  const released=['请假','失败','未入选','已取消'].includes(row['报名结果']);
  if(!released&&(row['学号']||row['姓名']||row['报名人']||row['邮箱']||['成功','待确认','审核中'].includes(row['报名结果'])))group.occupied++;
  if(['停点','已停点'].includes(row['报名结果']))group.stopped++;
 }
 return [...groups.values()].map(g=>{
  const id=`BS-${hash(g.key)}`,name=`市血液献血车 · 第${g.week}周 · ${g.location}`;
  const service=(Date.parse(g.times.end)-Date.parse(g.times.start))/3600000;
  const config={name,date:g.date,slot:g.slot,position:'献血车志愿服务岗',capacity:g.ids.length,service,training:1,travel:1,location:g.location,work:'按所选点位与时段参与献血车志愿服务。',templateId:'blood_vehicle',blood:{mode:'blood_vehicle',week:g.week,key:g.key,...g.times},source:{kind:'generated_blood',table:BLOOD_SOURCE_TABLE,key:g.key},sourceOccupied:g.occupied};
  return {_id:id,活动ID:id,活动名称:name,活动类别:'献血车志愿服务',负责人账号ID:'njutable-automation',申请版本:1,批准版本:1,状态:g.stopped?'停点':Date.parse(g.times.end)<=now?'已结束':'报名中',报名日期:g.date,报名时段:g.slot,岗位:config.position,容量:g.ids.length,服务时长:service,培训时长:1,交通时长:1,地点:g.location,工作内容:config.work,通知草稿:`${name}\n${g.date} ${g.slot}\n地点：${g.location}`,报名页配置:JSON.stringify(config),准备状态:'已准备',停点说明:g.stopped?'本班次暂停报名':''};
 });
}
