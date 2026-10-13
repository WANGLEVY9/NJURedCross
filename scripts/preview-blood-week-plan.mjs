/** Credential-free planning only. No NJUTable connection, writes or email. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function bloodWeekPlan() {
 const projectId='NJU-RC-BLOOD-WEEK-2026-10';
 const registrationEnd='2026-10-28T00:00:00+08:00';
 const venues=[{id:'gulou',campus:'鼓楼',location:'鼓楼校区逸夫馆报告厅'},{id:'xianlin',campus:'仙林',location:'仙林校区大活多功能厅'}];
 const dates=['2026-10-29','2026-10-30'];
 const times=[['08:30','10:30'],['10:30','12:30'],['12:30','14:30'],['14:30','16:30']];
 const sessions=dates.flatMap(date=>venues.flatMap(venue=>times.map(([start,end])=>({
  projectId,sessionId:`${projectId}-${date.slice(8)}-${venue.id}-${start.replace(':','')}`,
  date,campus:venue.campus,location:venue.location,startAt:`${date}T${start}:00+08:00`,endAt:`${date}T${end}:00+08:00`,
  slot:`${start}–${end}`,capacity:30,position:'献血周志愿服务岗',hoursRuleStatus:'待确定',registrationEnd,
 }))));
 return {
  mode:'plan-only',writes:0,emails:0,projectId,name:'献血周志愿服务活动',region:'nanjing',type:'ordinary',ownerName:'金中宸',registrationEnd,
  work:'参与无偿献血服务工作，进行引导、解答疑问、录入信息，适时观察献血者情况，并在必要时协助医护人员提供帮助，确保活动安全、有序进行。',
  rules:{registration:'有名额直接确认，满额拒绝报名但可订阅空位提醒',multiple:'允许多个不重叠班次',cancellation:'申请后管理员审核，通过后释放名额',hours:'规则待确定，不计算、不批准、不入账时长',registrationControl:'管理员可调整活动组统一截止时间或提前停止报名；截止/关闭不取消已有报名，不关闭签到与核验'},
  pendingConfirmation:['负责人姓名需匹配唯一的有效管理账号','审批/发布操作者必须沿用现有权限及审计流程'],
  sessionCount:sessions.length,totalCapacity:sessions.reduce((sum,s)=>sum+s.capacity,0),sessions,
 };
}

if(resolve(process.argv[1]||'')===fileURLToPath(import.meta.url))console.log(JSON.stringify(bloodWeekPlan(),null,2));
