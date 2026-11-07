import {registrationIsHistorical} from '../../shared/blood-lifecycle.js';
import {prepareAttendancePhoto} from '../attendance-photo.js';
import {closedActivityPage,isClosedActivity} from '../closed-activity.js';
import {activitySchedule,timeSlot} from '../../core/format.js';
import {bloodParticipationSummary,bloodRecordDetails,bloodCheckinGuide} from '../participation-guide.js';
import {participantIdentity,wishCollection,selectedSession,preserveParticipation,focusSessionChoices} from '../booking-presentation.js';
import {positionRoster} from '../../shared/position-roster.js';
import {canViewPositionRoster} from '../../shared/position-access.js';
import {bloodCalendar} from '../blood-calendar.js';
import {workflowEventPath,workflowGroupFor} from '../workflow-links.js';
import {registrationPresentation} from '../registration-presentation.js';
import {isLegacyHongyangAutoConfirmedRegistration} from '../../shared/registration-leave.js';
import {ordinarySessions} from '../ordinary-sessions.js';
import {patchQuery} from '../../core/router.js';
import {h,icon} from '../../core/dom.js';
import {request,getSessionState} from '../../core/api.js';
import {reportError,notify} from '../../core/toast.js';
import {asyncRegion} from '../../console/lib.js';
import {pageHead,panel,field,button,badge,notice,emptyState,runWithLoading,definitionList,checkbox,activityFacts} from '../../ui/primitives.js';
function participationGuide() {
 return h('section',{class:'participation-notice','aria-label':'参与须知'},
  h('h3',{},icon('calendar'),h('span',{text:'报名与签到'})),
  h('ol',{},
   h('li',{},h('b',{text:'服务信息'}),h('p',{text:'地点与时间以班次信息为准。'})),
   h('li',{},h('b',{text:'报名结果'}),h('p',{text:'提交后可在报名记录中查看结果。'})),
   h('li',{},h('b',{text:'现场签到'}),h('p',{text:'到场后上传现场照片完成签到。'}))));
}
function registrationCallout(record) {
 const result=record.result||'已提交报名';
 const pending=record.status==='待筛选'||['待确认','名单确认中'].includes(result);
 return h('div',{class:'registration-callout',data:{tone:pending?'pending':'confirmed'}},
  h('span',{class:'registration-callout__icon'},icon(pending?'clock':'check')),
  h('div',{class:'registration-callout__text'},h('b',{text:result}),h('p',{text:pending?'报名已收到。':'可在下方报名记录中办理请假、签到。'})));
}
function participationAction(title,subtitle,symbol,...body) {
 return h('details',{class:'participation-action',data:{action:symbol}},
  h('summary',{},h('span',{class:'participation-action__icon'},icon(symbol)),
   h('span',{class:'participation-action__label'},h('b',{text:title}),h('span',{text:subtitle})),icon('chevronDown','ico participation-action__chevron')),
  h('div',{class:'stack-3 participation-action__body'},...body));
}
export default async function workflowEventsPage(context={}){
 const requestedEvent=context.query?.get('event')||context.query?.get('slot');
 if(requestedEvent&&context.query?.get('view')!=='records'){try{const {event}=await request(`/api/public/events/${encodeURIComponent(`workflow:${requestedEvent}`)}`);if(isClosedActivity(event))return closedActivityPage(event);}catch(error){if(error.status!==404)throw error;}}
 const eventId=context.query?.get('event'),week=context.query?.get('week'),bloodOnly=context.query?.get('type')==='blood',recordsOnly=context.query?.get('view')==='records';let selectedId=context.query?.get('slot')||eventId;let activeGroup=null;const calendarState=/^\d{4}-\d{2}-\d{2}$/.test(week||'')?{week}:{};let disposed=false,countdown=60,submitting=false;const outcomes=new Map();const uncertainOutcomes=new Set();const acknowledgments=new Map();const syncLabel=h('span',{class:'t-caption',aria:{live:'off'},text:'正在同步班次…'});
 const loginPath=e=>`/login?next=${encodeURIComponent(workflowEventPath(e,calendarState.week))}`;
 const requestedCode=context.query?.get('registration');
 const matchesRecord=r=>recordsOnly&&requestedCode?r.code===requestedCode:activeGroup?r.ordinary?.groupId===activeGroup:!selectedId||r.eventId===selectedId;
 const session=getSessionState();const expandedRosters=new Set();let mine;const mutations=new Set();
 let registrations=[],participant={},wishlist=[],minePending,participantReady=!session.authenticated,participantError=null;
 const readMine=()=>minePending||(minePending=Promise.all([request('/api/portal/workflow/me'),request('/api/portal/workflow/wishlist').catch(()=>null)]).then(([data,wishes])=>{if(wishes)wishlist=wishes.wishlist;return data;}).then(data=>{registrations=data.registrations;for(const record of registrations){if(uncertainOutcomes.has(record.eventId)){uncertainOutcomes.delete(record.eventId);outcomes.set(record.eventId,`已查到报名记录：${record.result||record.status}。请查看下方进度。`);}}if(recordsOnly&&requestedCode&&!recordsViewChosen){const target=data.registrations.find(r=>r.code===requestedCode);recordsView=target&&registrationIsHistorical(target)?'history':'active';recordsViewChosen=true;}participant=data.participant||{};participantReady=true;participantError=null;return data;}).finally(()=>{minePending=null;}));
 function fullSlot(e){const subscribed=wishlist.some(w=>w.eventId===e.id);let control;control=button({label:subscribed?'取消空位提醒':'加入心愿清单',iconName:'heart',variant:'secondary',onClick:async()=>{try{await runWithLoading(control,()=>request(`/api/portal/workflow/events/${e.id}/wishlist`,{method:subscribed?'DELETE':'POST',body:{}}));notify.success(subscribed?'已取消提醒':'已加入心愿清单');await refreshAll();}catch(error){reportError(error,'操作未完成');}}});return h('div',{class:'vacancy-callout'},h('div',{},h('b',{text:'此班次已报满'}),h('p',{text:subscribed?'已关注此班次，空位出现时会给你发邮件，可通过邮件返回报名。':'加入心愿清单，收到空位邮件后即可回来报名。'})),session.authenticated?control:button({label:'登录后关注',href:loginPath(e),variant:'secondary'}));}
 function action(label,path,body,feedback,id){let control;control=button({label,variant:'primary',onClick:async()=>{
  if(submitting||outcomes.has(id))return;
  submitting=true;feedback.dataset.state='pending';feedback.textContent='正在提交报名，请稍候…';
  try{
   const response=await runWithLoading(control,()=>request(path,{method:'POST',body:typeof body==='function'?body():body}));
   const confirmed=response?.result?.status==='报名成功';
   outcomes.set(id,confirmed?'报名成功。':'报名已提交。');
   feedback.dataset.state='success';feedback.textContent=outcomes.get(id);control.disabled=true;
   notify.success(confirmed?'报名成功':'报名已提交',confirmed?'名额已确认。':'可查看报名记录。');
   try{await refreshAll();}catch{feedback.textContent='报名已提交，记录稍后更新。';}
  }catch(error){
   const uncertain=error.status===0||error.status>=500;
   feedback.dataset.state=uncertain?'uncertain':'error';
   feedback.textContent=uncertain?'提交结果确认中，稍后可在报名记录中查看。':`报名未完成：${error.message}`;
   if(uncertain){outcomes.set(id,feedback.textContent);uncertainOutcomes.add(id);}
   notify[uncertain?'warning':'error'](uncertain?'提交结果待确认':'报名未完成',feedback.textContent);
  }finally{submitting=false;control.disabled=outcomes.has(id)||!acknowledgments.get(id);}
 }});return control;}
 const list=asyncRegion({load:async()=>{const data=await request('/api/public/workflow/events');countdown=60;syncLabel.textContent='班次已更新';return {...data,events:data.events.filter(event=>!isClosedActivity(event))};},render:data=>{if(disposed)return h('div');const legacyBlood=eventId&&data.events.find(e=>e.id===eventId)?.blood;const ordinaryGroup=workflowGroupFor(data.events,eventId,selectedId);activeGroup=ordinaryGroup||null;const events=ordinaryGroup?data.events.filter(e=>e.ordinary?.groupId===ordinaryGroup):eventId&&!legacyBlood?data.events.filter(e=>e.id===eventId):bloodOnly||legacyBlood?data.events.filter(e=>e.blood):data.events;const renderEvent=e=>{const existing=registrations.find(r=>r.eventId===e.id&& ['待筛选','已确认','已签到'].includes(r.status));const facts=selectedSession(e);
 const feedback=h('div',{class:'workflow-submit-feedback',role:'status',aria:{live:'polite',atomic:'true'},data:{state:uncertainOutcomes.has(e.id)?'uncertain':outcomes.has(e.id)?'success':''},text:outcomes.get(e.id)||''});
 const consentHint=h('p',{class:'booking-consent-hint',role:'status',text:acknowledgments.get(e.id)?'已确认参与须知。':'请先确认参与须知。'});
 const consent=checkbox({name:'participation-notice',label:'我已阅读参与须知',checked:Boolean(acknowledgments.get(e.id)),onChange:checked=>{acknowledgments.set(e.id,checked);submit.disabled=!checked||submitting||outcomes.has(e.id);consentHint.textContent=checked?'已确认参与须知，可以提交报名。':'请先勾选参与须知，再提交报名。';}});
 const submit=action('确认报名此班次',`/api/portal/workflow/events/${e.id}/register`,()=>{
  if(!consent.control.checked)throw new Error('请先阅读并确认参与须知');
  return {consent:true};
 },feedback,e.id);
 consent.control.checked=Boolean(acknowledgments.get(e.id));
 submit.disabled=!consent.control.checked||outcomes.has(e.id);
 const signup=existing?registrationCallout(existing):(e.registrationOpen===false||e.ordinary&&!e.registrationOpen)?notice('报名已截止。',{tone:'neutral'}):e.quotaMode==='review'&&e.full?notice('报名人数已达上限，请关注后续活动。',{tone:'neutral'}):(e.blood||e.ordinary)&&e.quotaMode!=='review'&&e.remaining===0?fullSlot(e):session.authenticated&&!participantReady?(participantError?h('div',{class:'stack-3'},notice('个人资料暂未读取成功，请重试后报名。',{tone:'warning'}),button({label:'重新读取资料',onClick:()=>readMine().then(()=>list.reload()).catch(error=>reportError(error,'个人资料读取失败'))})):h('p',{class:'t-caption',role:'status',text:'正在读取我的报名信息…'})):session.authenticated?participant.campus&&!participant.missing?.length?h('div',{class:'blood-signup-controls'},consent,consentHint,submit):h('div',{class:'stack-3'},notice(['duplicate_profile','profile_missing','identity_conflict','identity_unverified'].includes(participant.qualificationState)?'急救证资料尚未正确关联，请进入会员中心核对；已填写仍出现此提示时，请联系管理员检查资料关联记录。':'请先在会员中心补全：'+(participant.missing?.length?participant.missing.join('、'):'校区')+'，再回来报名。',{tone:'warning'}),button({label:'完善个人资料',href:'/me',variant:'secondary'}),button({label:'重新核对资料',variant:'secondary',onClick:()=>refreshAll({fresh:true}).catch(error=>reportError(error,'资料核对暂未完成'))})):button({label:'登录后报名',href:loginPath(e),variant:'primary'});
 const result=panel({title:e.name,body:h('div',{class:'stack-4'},h('div',{class:'blood-detail-grid'},h('section',{class:'blood-detail-information'},facts,h('h3',{class:'blood-section-label',text:'参与安排'}),e.work&&!/^按所选.*参与.*服务[。.]?$/.test(e.work.trim())?h('p',{class:'t-secondary workflow-copy',text:e.work}):null,!e.blood&&!e.ordinary&&e.notice?h('section',{class:'workflow-published-notice','aria-label':'报名通知'},h('h3',{class:'blood-section-label',text:'报名通知'}),h('div',{class:'workflow-published-notice__body',text:timeSlot(e.notice)})):null,e.blood?bloodParticipationSummary():participationGuide()),h('section',{class:'blood-detail-personal'},h('h3',{class:'blood-section-label',text:'我的报名信息'}),session.authenticated?participantIdentity(participant):h('p',{class:'t-secondary',text:'登录后自动使用账号中的姓名与邮箱。'}),h('div',{class:'blood-detail-submit'},signup,feedback,outcomes.has(e.id)||existing?button({label:'查看我的报名记录',variant:'ghost',onClick:()=>{const target=document.querySelector('#workflow-records');if(target){target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start',behavior:'instant'});}}}):null))),e.blood&&canViewPositionRoster(session)?positionRoster(e.id,expandedRosters):null)});result.classList.add('workflow-event-detail');return result;};if(!events.length)return emptyState({title:eventId?'该活动暂未开放报名':'暂无开放活动',description:'活动需要完成审批并发布后才能报名。',actions:eventId?[button({label:'查看全部流程活动',href:'/workflow-events',variant:'secondary'})]:[]});
 if(ordinaryGroup){const detail=h('div',{class:'workflow-detail-anchor'});const show=(e,{focus=true}={})=>{selectedId=e.id;detail.replaceChildren(renderEvent(e));patchQuery({event:e.id,slot:e.id});if(focus){detail.tabIndex=-1;detail.focus({preventScroll:true});detail.scrollIntoView({block:'start',behavior:'instant'});}void mine?.reload();};const selected=events.find(e=>e.id===selectedId);if(selected)detail.append(renderEvent(selected));return h('div',{class:'stack-5'},ordinarySessions(events,registrations,show,selectedId),detail);}const blood=events.filter(e=>e.blood);if(eventId&&!legacyBlood||!blood.length)return h('div',{class:'stack-5'},...events.map(renderEvent));
 const detail=h('div',{class:'stack-5 workflow-detail-anchor'});
 const showDetail=e=>detail.replaceChildren(h('div',{class:'booking-return'},h('p',{text:'已选班次 · 核对下方安排与个人信息后提交'}),button({label:'返回日历',iconName:'chevronLeft',variant:'ghost',onClick:()=>{
  const slot=[...calendar.querySelectorAll('.blood-calendar__slot')].find(node=>node.dataset.eventId===selectedId);
  const target=(slot?.getClientRects().length?slot:null)||calendar.querySelector('.blood-calendar__date[aria-pressed="true"]');
  target?.focus({preventScroll:true});target?.scrollIntoView({behavior:'instant',block:'center'});
 }})),renderEvent(e));
 const calendar=bloodCalendar(blood,registrations,e=>{selectedId=e.id;showDetail(e);patchQuery({slot:e.id,week:calendarState.week,type:'blood'});detail.tabIndex=-1;detail.focus({preventScroll:true});detail.scrollIntoView({behavior:'instant',block:'start'});void mine?.reload();},selectedId,calendarState);
 const selected=events.find(e=>e.id===selectedId);if(selected)showDetail(selected);
 return h('div',{class:'stack-5'},calendar,detail,...events.filter(e=>!e.blood).map(renderEvent));}});
 let recordsView=context.query.get('records')==='history'?'history':'active',recordsViewChosen=context.query.has('records');
 mine=session.authenticated?asyncRegion({load:readMine,render:data=>preserveParticipation(mine,h('section',{id:'workflow-records',class:'workflow-records'},panel({title:'我的报名与签到',body:h('div',{class:'stack-5'},...(recordsOnly?[h('div',{class:'row-2 row-wrap','aria-label':'报名记录分类'},...['active','history'].map(value=>button({label:value==='active'?'正在进行':'历史报名',variant:recordsView===value?'primary':'secondary',onClick:()=>{recordsView=value;recordsViewChosen=true;patchQuery({records:value});void mine.reload();}})))]:[]),...data.registrations.filter(matchesRecord).filter(r=>!recordsOnly||(recordsView==='history')===registrationIsHistorical(r)).map(r=>{
      const attendanceRequest=data.attendanceRequests?.find(item=>item.registration_code===r.code);
      const requestReason=field({label:'补签说明',name:'attendanceRequestReason',multiline:true,rows:2,maxlength:300,value:attendanceRequest?.reason||''});
      const requestState=h('p',{class:'t-caption',text:attendanceRequest?`补签说明${attendanceRequest.status==='pending'?'待核实':attendanceRequest.status==='approved'?'已核实':'未通过'}`:''});
      const requestButton=button({label:'提交补签说明',variant:'secondary',size:'sm',onClick:async()=>{
        if(!requestReason.control.value.trim())return;
        try{await request(`/api/portal/workflow/registrations/${encodeURIComponent(r.code)}/attendance-request`,{method:'POST',body:{reason:requestReason.control.value}});notify.success('补签说明已提交');await mine.reload();}
        catch(error){reportError(error,'补签说明未提交');}
      }});requestButton.disabled=attendanceRequest?.status==='pending';
      const requestBox=h('div',{class:'stack-2'},requestState,requestReason,h('div',{},requestButton));
   const autoLeave=r.status==='待筛选'||isLegacyHongyangAutoConfirmedRegistration(r);const cancellation=r.ordinary?'申请取消报名':'申请请假';const path=`/api/portal/workflow/registrations/${encodeURIComponent(r.code)}`;const reason=field({label:'请假原因',name:'reason',multiline:true,rows:3,hint:'请填写原因。',required:true,maxlength:500});let leave;leave=button({label:cancellation,onClick:async()=>{if(mutations.has(r.code)||!reason.control.reportValidity())return;mutations.add(r.code);try{const response=await runWithLoading(leave,()=>request(`${path}/leave`,{method:'POST',body:{reason:reason.control.value}}));reason.control.value='';notify.success(response.result?.autoApproved?'报名已取消，原因已记录':'申请已提交，等待负责人审核');await refreshAll();}catch(error){reportError(error,'申请或记录刷新未完成');}finally{mutations.delete(r.code);}}});
   const photo=h('input',{type:'file',accept:'image/jpeg,image/png,image/webp','aria-label':'现场签到照片'});let attendance;attendance=button({label:'提交照片签到',onClick:async()=>{if(mutations.has(r.code))return;const file=photo.files?.[0];if(!file){notify.error('请选择 JPEG、PNG 或 WebP 现场照片');return;}mutations.add(r.code);try{await runWithLoading(attendance,async()=>{const upload=await prepareAttendancePhoto(file);return request(`${path}/attendance`,{method:'POST',form:upload,headers:{'Content-Type':upload.type}});});photo.value='';notify.success('签到证据已提交，等待管理员核验');await refreshAll();}catch(error){reportError(error,'签到或记录刷新未完成');}finally{mutations.delete(r.code);}}});
   const state=registrationPresentation(r);
   return h('section',{class:'blood-registration',data:{status:state.label,registrationCode:r.code}},
    h('div',{class:'blood-registration__heading'},h('h3',{text:r.eventName}),h('div',{class:'row-2 row-wrap'},badge(state.label,{tone:state.tone,iconName:state.symbol}),r.leaveStatus?badge(`请假${r.leaveStatus}`,{tone:'warning',iconName:'clock'}):null)),
    activityFacts([{label:'服务时间',value:activitySchedule(r.date,r.slot),iconName:'calendar'},{label:'服务点位',value:r.location,iconName:'pin'},{label:'服务岗位',value:r.position,iconName:'users'}]),
    h('div',{class:'blood-registration__journey'},h('ol',{class:'registration-progress','aria-label':'报名处理进度'},...state.steps.map((step,index)=>h('li',{data:{done:String(step.done),current:String(step.current)},'aria-current':step.current?'step':null},h('span',{class:'registration-progress__mark','aria-hidden':'true'},step.done?icon('check','ico ico--sm'):String(index+1)),h('span',{text:step.text}),h('span',{class:'sr-only',text:step.done?'，已完成':step.current?'，当前步骤':'，未完成'})))),h('p',{class:'blood-registration__hint',text:state.hint})),
    h('div',{class:'blood-registration__actions'},
     participationAction('活动详情','参与安排与说明','file',r.blood?bloodRecordDetails(r):definitionList([['报名编号',r.code],['报名结果',r.result||'—'],...(r.category?[['活动类别',r.category]]:[]),...(r.region?[['地区',r.region]]:[]),['时长录入',r.hours?.label||r.entryStatus||'待录入'],...(r.hours?.hours?[['核定志愿时长',`${r.hours.hours.serviceHours} 小时（培训 ${r.hours.hours.trainingHours}、交通 ${r.hours.hours.travelHours} 另列）`]]:[]),...(r.tableHours!=null?[['报名表时长',`${r.tableHours} 小时`]]:[])]),r.eventStatus==='停点'?notice(`本班次已停点：${r.stopReason||'请联系负责人'}。`,{tone:'warning'}):null,r.reason?notice(r.reason,{tone:'neutral'}):null,r.remark?notice(`备注：${r.remark}`,{tone:'neutral'}):null,r.notes?notice(r.notes,{tone:'neutral'}):null),
     r.leaveAllowed!==false&&['报名中','进行中','停点'].includes(r.eventStatus)&&['待筛选','已确认'].includes(r.status)&&(!autoLeave||!r.attendanceSubmitted)&&r.leaveStatus!=='待审批'?participationAction(cancellation,autoLeave?'填写原因':'填写原因','calendar',reason,h('div',{class:'blood-registration__submit'},leave)):null,
     (r.attendanceOpen===true||r.attendanceOpen===undefined&&r.eventStatus==='报名中')&&r.status==='已确认'&&r.leaveStatus!=='待审批'?(r.attendanceSubmitted?notice('签到已提交。',{tone:'info'}):participationAction('现场签到','上传照片','camera',r.blood?bloodCheckinGuide():null,photo,h('div',{class:'blood-registration__submit'},attendance),requestBox)):null));
 }),!data.registrations.some(r=>matchesRecord(r)&&(!recordsOnly||(recordsView==='history')===registrationIsHistorical(r)))?h('div',{class:'row-between row-wrap'},h('p',{text:recordsView==='history'?'暂无历史报名记录。':'暂无正在进行的报名。'}),button({label:'选择班次',variant:'secondary',onClick:focusSessionChoices})):null,!eventId&&data.profile?definitionList([['已入账服务时长',`${data.profile.serviceHours} 小时`],['培训时长',`${data.profile.trainingHours} 小时`],['交通时长',`${data.profile.travelHours} 小时`]]):null)})))}):null;
 if(session.authenticated)void readMine().then(()=>{if(!disposed)return list.reload();}).catch(error=>{participantError=error;if(!disposed)void list.reload();});
 const wishes=session.authenticated?asyncRegion({load:async()=>{const [events,data]=await Promise.all([request('/api/public/workflow/events'),request('/api/portal/workflow/wishlist')]);wishlist=data.wishlist;return {events:events.events,items:data.wishlist};},render:({events,items})=>wishCollection(events,items,item=>{let cancel;cancel=button({label:'取消提醒',size:'sm',variant:'ghost',onClick:async()=>{try{await runWithLoading(cancel,()=>request(`/api/portal/workflow/events/${encodeURIComponent(item.eventId)}/wishlist`,{method:'DELETE',body:{}}));await refreshAll();notify.success('已取消空位提醒');}catch(error){reportError(error,'取消未完成');}}});return cancel;})}):null;
 async function refreshAll({fresh=false}={}){
  if(fresh&&(submitting||mutations.size))return;
  const reads=[mine?.reload(),wishes?.reload()];
  if(fresh)reads.push(request('/api/public/workflow/events',{fresh:true}));
  await Promise.all(reads);
  if(mine?.querySelector('.region__refresh-error'))throw new Error('报名记录暂未刷新');
  await list.reload();
  if(list.querySelector('.region__refresh-error'))throw new Error('班次暂未刷新');
 }
 const profileChanged=()=>{if(!disposed&&session.authenticated)void refreshAll({fresh:true}).catch(()=>{});};window.addEventListener('account-profile-updated',profileChanged);
 const timer=setInterval(()=>{if(document.hidden||disposed||submitting||mutations.size||document.querySelector('.select-menu__trigger[aria-expanded="true"], .workflow-page details[open]')||document.activeElement?.matches('.workflow-page input, .workflow-page textarea, .workflow-page select'))return;if(--countdown<=0){countdown=60;void refreshAll({fresh:true}).catch(()=>{syncLabel.textContent='刷新暂未完成，稍后重试';});}},1000);
 return {dispose:()=>{disposed=true;clearInterval(timer);window.removeEventListener('account-profile-updated',profileChanged);},title:'活动报名与献血车排班',node:h('div',{class:'view formpage stack-6 workflow-page'},h('a',{class:'workflow-back',href:'/events'},icon('chevronLeft','ico ico--sm'),h('span',{text:'活动广场'})),pageHead({title:recordsOnly?'我的报名与签到':eventId?'选择班次，确认参与':bloodOnly||week?'献血车报名日历':'我的活动与班次',description:recordsOnly?'每一次参与，都有清晰的下一步。':'找到合适的时间与地点，让一次参与从这里开始。'}),h('div',{class:'row-between row-wrap booking-sync'},syncLabel,button({label:'刷新班次',variant:'secondary',size:'sm',onClick:()=>refreshAll({fresh:true}).catch(error=>reportError(error,'刷新暂未完成'))})),...(recordsOnly?[mine,button({label:'浏览献血车日历',href:'/workflow-events?type=blood',variant:'secondary'})]:[list,mine,wishes]))};
}
