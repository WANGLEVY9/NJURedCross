import {activityWishlist} from '../activity-wishlist.js';
import {activityRegistrationDetail} from '../activity-registration-detail.js';
import {registrationsNewestFirst} from '../registration-order.js';
import {positionRoster} from '../../shared/position-roster.js';
import {canViewPositionRoster} from '../../shared/position-access.js';
import {bloodCalendar} from '../blood-calendar.js';
import {workflowEventPath} from '../workflow-links.js';
import {registrationPresentation} from '../registration-presentation.js';
import {patchQuery} from '../../core/router.js';
import {h,icon} from '../../core/dom.js';
import {request,getSessionState} from '../../core/api.js';
import {reportError,notify} from '../../core/toast.js';
import {asyncRegion} from '../../console/lib.js';
import {pageHead,panel,field,button,badge,notice,emptyState,runWithLoading,definitionList,checkbox,activityFacts} from '../../ui/primitives.js';
function registrationCallout(record) {
 const result=record.result||'已提交报名';
 const pending=result==='待确认';
 return h('div',{class:'registration-callout',data:{tone:pending?'pending':'confirmed'}},
  h('span',{class:'registration-callout__icon'},icon(pending?'clock':'check')),
  h('div',{class:'registration-callout__text'},h('b',{text:result}),h('p',{text:pending?'报名已收到，等待负责人确认。可在下方查看报名进度。':'可在下方报名记录中查看进度并办理请假、签到。'})));
}
function participationAction(title,subtitle,symbol,...body) {
 return h('details',{class:'participation-action'},
  h('summary',{},h('span',{class:'participation-action__icon'},icon(symbol)),
   h('span',{class:'participation-action__label'},h('b',{text:title}),h('span',{text:subtitle})),icon('chevronDown','ico participation-action__chevron')),
  h('div',{class:'stack-3 participation-action__body'},...body));
}
export default async function workflowEventsPage(context={}){
 const eventId=context.query?.get('event'),week=context.query?.get('week'),bloodOnly=context.query?.get('type')==='blood',recordsOnly=context.query?.get('view')==='records';let selectedId=eventId||context.query?.get('slot');const calendarState=/^\d{4}-\d{2}-\d{2}$/.test(week||'')?{week}:{};let disposed=false,countdown=60,submitting=false;const outcomes=new Map();const acknowledgments=new Map();const syncLabel=h('span',{class:'t-caption',aria:{live:'off'},text:'正在同步班次…'});
 const loginPath=e=>`/login?next=${encodeURIComponent(workflowEventPath(e,calendarState.week))}`;
 const requestedCode=context.query?.get('registration');
 const matchesRecord=r=>Boolean(selectedId)&&r.eventId===selectedId&&(!recordsOnly||!requestedCode||r.code===requestedCode);
 const session=getSessionState();const expandedRosters=new Set();let mine;
 let registrations=[],participant={},wishlist=[],minePending,participantReady=!session.authenticated,participantError=null;
 const readMine=()=>minePending||(minePending=Promise.all([request('/api/portal/workflow/me'),request('/api/portal/workflow/wishlist').catch(()=>null)]).then(([data,wishes])=>{if(wishes)wishlist=wishes.wishlist;return data;}).then(data=>{registrations=data.registrations;if(recordsOnly&&requestedCode&&!selectedId)selectedId=registrations.find(r=>r.code===requestedCode)?.eventId;participant=data.participant||{};participantReady=true;participantError=null;return data;}).finally(()=>{minePending=null;}));
 function fullSlot(e){return wishes.fullSignup(e);}
 function action(label,path,body,feedback,id){let control;control=button({label,variant:'primary',onClick:async()=>{
  if(submitting||outcomes.has(id))return;
  submitting=true;feedback.dataset.state='pending';feedback.textContent='正在提交报名，请稍候…';
  try{
   await runWithLoading(control,()=>request(path,{method:'POST',body:typeof body==='function'?body():body}));
   outcomes.set(id,'报名已提交，正在等待审核。请在下方查看后续进度。');
   feedback.dataset.state='success';feedback.textContent=outcomes.get(id);control.disabled=true;
   notify.success('报名已提交','提交不代表审核通过。');
   try{await refreshAll();}catch{feedback.textContent='报名已提交，进度暂未刷新。请稍后刷新报名记录，无需重复提交。';}
  }catch(error){
   feedback.dataset.state='error';
   feedback.textContent=error.status===0?'网络连接中断，暂时无法确认提交结果。请刷新报名记录后再尝试。':`报名未完成：${error.message}。请核对班次及身份信息后重试。`;
   reportError(error,'报名未完成');
  }finally{submitting=false;control.disabled=outcomes.has(id)||!acknowledgments.get(id);}
 }});return control;}
 const list=asyncRegion({load:async()=>{const data=await request('/api/public/workflow/events');countdown=60;syncLabel.textContent='班次已更新';return data;},render:data=>{if(disposed)return h('div');const legacyBlood=eventId&&data.events.find(e=>e.id===eventId)?.blood;const events=eventId&&!legacyBlood?data.events.filter(e=>e.id===eventId):bloodOnly||legacyBlood?data.events.filter(e=>e.blood):data.events;const renderEvent=e=>{const existing=registrations.find(r=>r.eventId===e.id&& ['待筛选','已确认','已签到'].includes(r.status));const facts=activityFacts([{label:'日期与时段',value:`${e.date} ${e.slot}`,iconName:'calendar'},{label:'服务地点',value:e.location,iconName:'pin'},{label:'服务岗位',value:e.position,iconName:'users'},{label:'报名名额',value:`剩余 ${e.remaining??e.capacity} / ${e.capacity} 人`,iconName:'users'}]);
 const feedback=h('div',{class:'workflow-submit-feedback',role:'status',aria:{live:'polite',atomic:'true'},data:{state:outcomes.has(e.id)?'success':''},text:outcomes.get(e.id)||''});
 const consentHint=h('p',{class:'booking-consent-hint',role:'status',text:acknowledgments.get(e.id)?'已确认参与须知，可以提交报名。':'请先勾选参与须知，再提交报名。'});
 const consent=checkbox({name:'participation-notice',label:'我已阅读参与须知，确认报名此班次',description:'提交前请再次核对服务地点与时间。',onChange:checked=>{acknowledgments.set(e.id,checked);submit.disabled=!checked||submitting||outcomes.has(e.id);consentHint.textContent=checked?'已确认参与须知，可以提交报名。':'请先勾选参与须知，再提交报名。';}});
 const submit=action('确认报名此班次',`/api/portal/workflow/events/${e.id}/register`,()=>{
  if(!consent.control.checked)throw new Error('请先阅读并确认参与须知');
  return {consent:true};
 },feedback,e.id);
 consent.control.checked=Boolean(acknowledgments.get(e.id));
 submit.disabled=!consent.control.checked||outcomes.has(e.id);
 const signup=existing?registrationCallout(existing):Number(e.remaining??e.capacity)<=0?fullSlot(e):session.authenticated&&!participantReady?(participantError?h('div',{class:'stack-3'},notice('个人资料暂未读取成功，请重试后报名。',{tone:'warning'}),button({label:'重新读取资料',onClick:()=>readMine().then(()=>list.reload()).catch(error=>reportError(error,'个人资料读取失败'))})):h('p',{class:'t-caption',role:'status',text:'正在读取我的报名信息…'})):session.authenticated?participant.campus?h('div',{class:'blood-signup-controls'},consent,consentHint,submit):h('div',{class:'stack-3'},notice('请先在会员中心完善个人资料中的校区，再回来报名。',{tone:'warning'}),button({label:'完善个人资料',href:'/me',variant:'secondary'})):button({label:'登录后报名',href:loginPath(e),variant:'primary'});
 const result=activityRegistrationDetail({event:e,facts,participant,authenticated:session.authenticated,signup,feedback});if(e.blood&&canViewPositionRoster(session))result.querySelector('.panel__body').append(positionRoster(e.id,expandedRosters));return result;};if(!events.length)return emptyState({title:eventId?'该活动暂未开放报名':'暂无开放活动',description:'活动需要完成审批并发布后才能报名。',actions:eventId?[button({label:'查看全部流程活动',href:'/workflow-events',variant:'secondary'})]:[]});
 const blood=events.filter(e=>e.blood);if(eventId&&!legacyBlood||!blood.length)return h('div',{class:'stack-5'},...events.map(renderEvent));
 const detail=h('div',{class:'stack-5 workflow-detail-anchor'});
 const showDetail=e=>detail.replaceChildren(h('div',{class:'booking-return'},h('p',{text:'已选班次 · 核对下方安排与个人信息后提交'}),button({label:'返回日历',iconName:'chevronLeft',variant:'ghost',onClick:()=>{
  const slot=[...calendar.querySelectorAll('.blood-calendar__slot')].find(node=>node.dataset.eventId===selectedId);
  const target=(slot?.getClientRects().length?slot:null)||calendar.querySelector('.blood-calendar__date[aria-pressed="true"]');
  target?.focus({preventScroll:true});target?.scrollIntoView({behavior:'instant',block:'center'});
 }})),renderEvent(e));
 const calendar=bloodCalendar(blood,registrations,e=>{selectedId=e.id;showDetail(e);patchQuery({slot:e.id,week:calendarState.week,type:'blood'});detail.tabIndex=-1;detail.focus({preventScroll:true});detail.scrollIntoView({behavior:'instant',block:'start'});void mine?.reload();},selectedId,calendarState);
 const selected=events.find(e=>e.id===selectedId);if(selected)showDetail(selected);
 return h('div',{class:'stack-5'},calendar,detail,...events.filter(e=>!e.blood).map(renderEvent));}});
 mine=session.authenticated?asyncRegion({load:readMine,render:data=>h('section',{id:'workflow-records',class:'workflow-records'},panel({title:'我的报名与签到',body:h('div',{class:'stack-5'},...registrationsNewestFirst(data.registrations.filter(matchesRecord)).map(r=>{
   const path=`/api/portal/workflow/registrations/${encodeURIComponent(r.code)}`;const reason=field({label:'请假原因',name:'reason',multiline:true,rows:3,hint:'说明无法参加的原因，最多 500 字。提交后等待负责人审核。',required:true,maxlength:500});let leave;leave=button({label:'申请请假',onClick:async()=>{if(!reason.control.reportValidity())return;try{await runWithLoading(leave,()=>request(`${path}/leave`,{method:'POST',body:{reason:reason.control.value}}));await refreshAll();notify.success('请假申请已提交');}catch(error){reportError(error,'请假未完成');}}});
   const photo=h('input',{type:'file',accept:'image/jpeg,image/png,image/webp','aria-label':'现场签到照片'});let attendance;attendance=button({label:'提交照片签到',onClick:async()=>{const file=photo.files?.[0];if(!file||file.size>4*1024*1024){notify.error('请选择不超过4MB的现场照片');return;}try{await runWithLoading(attendance,()=>request(`${path}/attendance`,{method:'POST',form:file,headers:{'Content-Type':file.type}}));await refreshAll();notify.success('签到证据已提交，等待管理员核验');}catch(error){reportError(error,'签到未完成');}}});
   const state=registrationPresentation(r);
   return h('section',{class:'blood-registration',data:{status:state.label}},
    h('div',{class:'blood-registration__heading'},h('h3',{text:r.eventName}),h('div',{class:'row-2 row-wrap'},badge(state.label,{tone:state.tone,iconName:state.symbol}),r.leaveStatus?badge(`请假${r.leaveStatus}`,{tone:'warning',iconName:'clock'}):null)),
    activityFacts([{label:'服务时间',value:`${r.date} ${r.slot}`,iconName:'calendar'},{label:'服务点位',value:r.location,iconName:'pin'},{label:'服务岗位',value:r.position,iconName:'users'}]),
    h('div',{class:'blood-registration__journey'},h('ol',{class:'registration-progress','aria-label':'报名处理进度'},...state.steps.map((step,index)=>h('li',{data:{done:String(step.done),current:String(step.current)},'aria-current':step.current?'step':null},h('span',{class:'registration-progress__mark','aria-hidden':'true'},step.done?icon('check','ico ico--sm'):String(index+1)),h('span',{text:step.text}),h('span',{class:'sr-only',text:step.done?'，已完成':step.current?'，当前步骤':'，未完成'})))),h('p',{class:'blood-registration__hint',text:state.hint})),
    h('div',{class:'blood-registration__actions'},
     participationAction('活动详情','报名编号与处理记录','file',definitionList([['报名编号',r.code],['报名结果',r.result||'—'],['时长录入',r.entryStatus||'待录入']]),r.eventStatus==='停点'?notice(`本班次已停点：${r.stopReason||'请联系负责人'}。`,{tone:'warning'}):null,r.reason?notice(r.reason,{tone:'neutral'}):null),
     r.eventStatus==='报名中'&&['待筛选','已确认'].includes(r.status)&&r.leaveStatus!=='待审批'?participationAction('申请请假','无法参加？填写原因交由负责人审核','calendar',reason,h('div',{class:'blood-registration__submit'},leave)):null,
     r.eventStatus==='报名中'&&r.status==='已确认'&&r.leaveStatus!=='待审批'?(r.attendanceSubmitted?notice('签到已提交，等待确认。',{tone:'info'}):participationAction('现场签到','到场后上传照片，提交核验','camera',h('p',{class:'t-caption',text:'请在活动时段内上传带有日期时间的照片，大小不超过 4MB。'}),photo,h('div',{class:'blood-registration__submit'},attendance))):null));
 }),!data.registrations.some(matchesRecord)?h('div',{class:'row-between row-wrap'},h('p',{text:selectedId?'尚未报名当前活动。':'请选择一个活动或班次，查看对应的报名与签到记录。'}),button({label:'选择班次',variant:'secondary',onClick:()=>{const target=document.querySelector('.blood-calendar__date[aria-pressed="true"]')||document.querySelector('.blood-signup-controls input, .blood-detail-submit a');target?.focus();target?.scrollIntoView({block:'center'});}})):null,!eventId&&data.profile?definitionList([['已入账服务时长',`${data.profile.serviceHours} 小时`],['培训时长',`${data.profile.trainingHours} 小时`],['交通时长',`${data.profile.travelHours} 小时`]]):null)}))}):null;
 if(session.authenticated)void readMine().then(()=>{if(!disposed)return list.reload();}).catch(error=>{participantError=error;if(!disposed)void list.reload();});
 const wishes=activityWishlist({authenticated:session.authenticated,onChange:()=>refreshAll(),loginHref:loginPath});
 async function refreshAll({fresh=false}={}){
  const reads=[mine?.reload(),wishes?.reload()];
  if(fresh)reads.push(request('/api/public/workflow/events',{fresh:true}));
  await Promise.all(reads);return list.reload();
 }
 const timer=setInterval(()=>{if(document.hidden||disposed||submitting||document.querySelector('.select-menu__trigger[aria-expanded="true"], .workflow-page details[open]')||document.activeElement?.matches('.workflow-page input, .workflow-page textarea, .workflow-page select'))return;if(--countdown<=0){countdown=60;void refreshAll({fresh:true}).catch(()=>{syncLabel.textContent='刷新暂未完成，稍后重试';});}},1000);
 return {dispose:()=>{disposed=true;clearInterval(timer);},title:'活动报名与献血车排班',node:h('div',{class:'view formpage stack-6 workflow-page'},h('a',{class:'workflow-back',href:'/events'},icon('chevronLeft','ico ico--sm'),h('span',{text:'活动广场'})),pageHead({title:recordsOnly?'我的报名与签到':eventId?'活动详情与报名':bloodOnly||week?'献血车报名日历':'我的活动与班次',description:bloodOnly?'选择周次与点位，点击班次查看详情并报名。':'查看报名进度，办理请假与签到。'}),h('div',{class:'row-between row-wrap'},syncLabel,button({label:'刷新班次',variant:'secondary',size:'sm',onClick:()=>refreshAll({fresh:true})})),...(recordsOnly?[mine,button({label:'浏览献血车日历',href:'/workflow-events?type=blood',variant:'secondary'}),list,wishes.node]:[list,mine,wishes.node]))};
}
