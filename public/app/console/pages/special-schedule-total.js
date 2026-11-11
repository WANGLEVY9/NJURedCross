import {h} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {notice} from '../../ui/primitives.js';
import {openDrawer} from '../../ui/overlay.js';

export async function openScheduleTotal(event){
 const body=h('div',{class:'stack-3'},notice('正在读取项目总表…',{tone:'neutral'}));
 openDrawer({title:event['活动名称']+' · 项目总表',width:1100,body});
 try{
  const data=await request(`/api/volunteer/workflow/events/${encodeURIComponent(event._id)}/schedule-total`,{fresh:true});
  const fields=['日期','时段','岗位','姓名','学号','报名状态','时长状态','服务时长','归档状态'];
  body.replaceChildren(h('p',{class:'t-caption',text:`${data.sessionCount} 个班次 · ${data.participantCount} 人 · ${data.rows.length} 条报名记录（含历史周次）`}),h('div',{class:'activity-registration-table registry-table'},h('table',{class:'table'},h('thead',{},h('tr',{},...fields.map(text=>h('th',{text})))),h('tbody',{},...data.rows.map(r=>h('tr',{},...[r.date,r.slot,r.location,r.name,r.studentId,r.status,r.hoursStatus,r.serviceHours??'—',r.archived?'已归档':'处理中'].map(text=>h('td',{text}))))))));
  if(!data.rows.length)body.append(notice('暂无报名记录',{tone:'neutral'}));
 }catch(error){body.replaceChildren(notice(error.message||'项目总表读取失败，请刷新重试',{tone:'warning'}));}
}
