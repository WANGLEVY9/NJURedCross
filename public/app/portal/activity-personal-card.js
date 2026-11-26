import {h} from '../core/dom.js';
import {request,getSessionState} from '../core/api.js';
import {button,definitionList,notice,skeletonBlock} from '../ui/primitives.js';
import {openFeedbackDrawer} from './feedback-drawer.js';

export function personalActivityCard(records,{ended=false}={}){
 const next=row=>['已确认','已签到'].includes(row.status)?'请按活动安排参加，时长审核进度会在此更新。':row.status==='候补'?'请等待递补通知，留意报名邮箱。':row.status==='未入选'?'本次未通过，可查看原因或选择其他活动。':row.status==='已请假'||row.status==='已取消'?'本次参与已取消。':'报名结果处理中，请留意后续通知。';
 return h('section',{class:'panel','aria-label':'我的参与进度'},h('div',{class:'panel__body stack-3'},h('h3',{class:'t-h3',text:'我的参与进度'}),
  ...records.map(row=>h('article',{class:'stack-2'},definitionList([
   ['我的报名状态',row.result||row.status||'处理中'],['岗位与时间',[row.position,row.date,row.slot].filter(Boolean).join(' · ')||'以活动安排为准'],
   ['我的时长',row.hours?.summarySynced?'已入账':row.hours?.hours?'处理中 · 已核定':'处理中'],
   ...(row.hours?.hours?[['核定时长',`服务 ${row.hours.hours.serviceHours} 小时 · 培训 ${row.hours.hours.trainingHours} 小时 · 交通 ${row.hours.hours.travelHours} 小时`]]:[]),
   ['时长进度',row.hours?.label||row.entryStatus||'待负责人确认'],['下一步',next(row)],
  ]),row.reason?notice(row.reason,{tone:'neutral'}):null)),
  ...(!records.length?[h('p',{text:'暂无本活动的报名记录。'})]:[]),
  ...(ended&&records.length?[button({label:'提交活动反馈',variant:'secondary',onClick:()=>openFeedbackDrawer({category:'活动'})}),h('p',{class:'t-caption',text:'可选择本次活动，向负责人反馈现场体验。'})]:[])));
}
/** Uses the existing account-scoped endpoint; never match a participant by name. */
export function withPersonalActivity(page,event){
 if(!getSessionState().authenticated)return page;
 const slot=h('div',{},skeletonBlock('120px'));page.node.querySelector('.stack-5')?.prepend(slot);
 const ids=new Set([event.workflowId,event.eventId,event.id,...(event.sessions||[]).flatMap(s=>[s.workflowId,s.sessionId])].filter(Boolean).map(id=>String(id).replace(/^workflow:/,'')));
 let disposed=false;const previousDispose=page.dispose;
 async function load(){
  try{const data=await request('/api/portal/workflow/me');if(disposed)return;slot.replaceChildren(personalActivityCard(data.registrations.filter(r=>ids.has(r.eventId)),{ended:event.status==='已结束'}));}
  catch{if(!disposed)slot.replaceChildren(notice('个人参与进度暂时无法加载',{tone:'warning'}),button({label:'重试加载参与进度',onClick:load}));}
 }
 void load();return {...page,dispose:()=>{disposed=true;previousDispose?.();}};
}
