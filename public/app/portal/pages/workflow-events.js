import {positionRoster} from '../../shared/position-roster.js';
import {canViewPositionRoster} from '../../shared/position-access.js';
import {bloodCalendar} from '../blood-calendar.js';
import {h,icon} from '../../core/dom.js';
import {request,getSessionState,ApiError} from '../../core/api.js';
import {reportError,notify} from '../../core/toast.js';
import {navigate} from '../../core/router.js';
import {shake} from '../../core/motion.js';
import {openDrawer} from '../../ui/overlay.js';
import {asyncRegion} from '../../console/lib.js';
import {pageHead,panel,field,button,badge,notice,emptyState,runWithLoading,definitionList,guidanceCards,statusIndicator,checkbox,receipt,steps} from '../../ui/primitives.js';
function participationGuide() {
 return guidanceCards([
  {iconName:'calendar',title:'选择班次',text:'按点位和时间报名，避免时段重叠。'},
  {iconName:'check',title:'报名结果',text:'提交报名后等待审核，结果将在报名记录中更新。'},
  {iconName:'camera',title:'现场签到',text:'上传包含日期和时间的现场照片。'},
 ],{title:'参与须知'});
}
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
/* Shift sign-up mirrors the regular event drawer: explicit confirmation steps,
   a slot-conflict check against existing registrations, and a receipt with the
   registration code. Identity stays read-only because the server derives it
   from the verified account. */
function openShiftDrawer(e,{participant,registrations,onDone}) {
 const stepSlot=h('div',null,steps(['确认信息','提交报名','完成'],0));
 const campusField=field({label:'参与校区',name:'campus',value:participant.campus||'',options:[{value:'',label:'请选择校区'},...['鼓楼','仙林','浦口','苏州','其他'].map(value=>({value,label:value}))],hint:'已按账号资料填入，可按本次班次需要调整。'});
 const clash=registrations.find(r=>['待筛选','已确认','已签到'].includes(r.status)&&r.date===e.date&&(r.slot===e.slot||r.slot==='全天'||e.slot==='全天'));
 const consent=checkbox({name:'consent',label:'我确认可以按时参加该班次，并同意平台为本次活动使用我的账号信息',description:'信息仅用于名额确认、现场签到与时长录入；如无法参加可在本页申请请假。'});
 /* Server errors surface inside the drawer instead of flashing the step bar
    back to zero, so a failed submit always leaves a readable reason on screen. */
 const errorSlot=h('div');
 let submitButton;submitButton=button({label:'提交报名',variant:'primary',iconName:'check',onClick:()=>submit()});
 const drawer=openDrawer({eyebrow:e.blood?'献血车志愿服务':'班次报名',title:e.name,description:`${e.date} ${e.slot} · ${e.location}`,width:520,body:[stepSlot,h('div',{class:'stack-5'},definitionList([['姓名',participant.realName||'—'],['校内邮箱',participant.email||'—'],['岗位',e.position],['报名上限',`${e.capacity} 人`]]),campusField,errorSlot,clash?notice(`你在同日同时段已有报名：${clash.eventName}（${clash.date} ${clash.slot}）。请确认时间不冲突后再提交。`,{tone:'warning',title:'可能存在时段冲突'}):null,consent)],footer:[h('p',{class:'t-caption t-faint',text:'提交前请确认校区与时间安排'}),h('span',{class:'spacer'}),button({label:'取消',variant:'ghost',onClick:()=>drawer.close()}),submitButton]});
 async function submit(){
  errorSlot.replaceChildren();
  if(!campusField.control.value){campusField.setError('请选择参与校区');shake(campusField);return;}
  campusField.setError(null);
  if(!consent.control.checked){shake(consent);notify.warning('需要你的明确同意','请勾选确认说明后再提交报名。');return;}
  try{
   const payload=await runWithLoading(submitButton,()=>request(`/api/portal/workflow/events/${e.id}/register`,{method:'POST',body:{campus:campusField.control.value}}));
   stepSlot.replaceChildren(steps(['确认信息','提交报名','完成'],2));
   drawer.setBody(stepSlot,receipt({title:payload.message||'报名已提交，等待名单确认',rows:[['报名编号',payload.result?.code||''],['活动',e.name],['班次',`${e.date} ${e.slot}`],['地点',e.location],['岗位',e.position],['参与校区',campusField.control.value],['当前状态',payload.result?.status||'待确认']]}),notice('负责人确认后可在「我的报名与签到」中申请请假，到场后提交签到照片完成登记。',{tone:'info'}));
   drawer.setFooter(button({label:'查看报名记录',variant:'ghost',iconName:'target',onClick:()=>{drawer.close();document.getElementById('workflow-records')?.scrollIntoView({behavior:'smooth',block:'start'});}}),h('span',{class:'spacer'}),button({label:'完成',variant:'primary',onClick:()=>drawer.close()}));
   notify.success('报名已提交',payload.result?.code?`报名编号 ${payload.result.code}`:'等待负责人确认',{duration:7000});
   onDone?.();
  }catch(error){
   if(error instanceof ApiError&&error.status===400){campusField.setError(error.message);shake(campusField);return;}
   if(error instanceof ApiError){errorSlot.replaceChildren(notice(error.message||'报名未提交，请稍后重试。',{tone:'warning',title:'报名未提交'}));return;}
   reportError(error,'报名未提交');
   errorSlot.replaceChildren(notice('报名未提交，请稍后重试。',{tone:'warning',title:'报名未提交'}));
  }
 }
}
export default async function workflowEventsPage(context={}){
 const eventId=context.query?.get('event'),week=context.query?.get('week'),bloodOnly=context.query?.get('type')==='blood';let selectedId=eventId;const calendarState=/^\d{4}-\d{2}-\d{2}$/.test(week||'')?{week,day:week}:{};let disposed=false,countdown=60;const syncLabel=h('span',{class:'t-caption',aria:{live:'off'},text:'正在同步班次…'});
 const session=getSessionState();const expandedRosters=new Set();let mine;
 let registrations=[],participant={},wishlist=[],minePending;
 const readMine=()=>minePending||(minePending=Promise.all([request('/api/portal/workflow/me'),request('/api/portal/workflow/wishlist')]).then(([data,wishes])=>{wishlist=wishes.wishlist;return data;}).then(data=>{registrations=data.registrations;participant=data.participant||{};return data;}).finally(()=>{minePending=null;}));
 function fullSlot(e){const subscribed=wishlist.some(w=>w.eventId===e.id);let control;control=button({label:subscribed?'取消空位提醒':'加入心愿清单',iconName:'heart',variant:'primary',onClick:async()=>{try{await runWithLoading(control,()=>request(`/api/portal/workflow/events/${e.id}/wishlist`,{method:subscribed?'DELETE':'POST',body:{}}));notify.success(subscribed?'已取消提醒':'已加入心愿清单');await Promise.all([mine?.reload(),list.reload()]);}catch(error){reportError(error,'操作未完成');}}});return h('div',{class:'vacancy-callout'},h('div',{},h('b',{text:'此班次已报满'}),h('p',{text:subscribed?'有空位时会发送邮件提醒。':'可加入心愿清单，有空位时接收邮件提醒。'})),session.authenticated?control:button({label:'登录后关注',href:`/login?next=${encodeURIComponent(`/workflow-events?event=${e.id}`)}`,variant:'primary',block:true}));}
 const list=asyncRegion({load:async()=>{const [data]=await Promise.all([request('/api/public/workflow/events'),session.authenticated?readMine().catch(()=>null):Promise.resolve()]);countdown=60;syncLabel.textContent='班次已更新 · 60秒后刷新';return data;},render:data=>{if(disposed)return h('div');const events=eventId?data.events.filter(e=>e.id===eventId):bloodOnly?data.events.filter(e=>e.blood):data.events;const renderEvent=e=>{const existing=registrations.find(r=>r.eventId===e.id&& ['待筛选','已确认','已签到'].includes(r.status));return panel({title:e.name,body:h('div',{class:'stack-4'},h('div',{class:'row-3 row-wrap'},badge(e.type||(e.blood?'献血车专项':'专项活动'),{tone:'accent'}),statusIndicator(e.remaining?`剩余 ${e.remaining} 个名额`:'此班次已报满',{tone:e.remaining?'success':'warning',live:true})),definitionList([['日期与时段',`${e.date} ${e.slot}`],['地点',e.location],['岗位',e.position],['报名上限',String(e.capacity)],...(e.recommended?[['推荐人数',String(e.recommended)]]:[])]),h('p',{class:'t-secondary workflow-copy',text:e.work||'按所选日期、点位与岗位参与服务。'}),h('hr',{class:'divider'}),existing?registrationCallout(existing):e.blood&&e.remaining===0?fullSlot(e):session.authenticated?h('div',{class:'stack-3'},button({label:'报名此班次',variant:'primary',size:'lg',block:true,iconName:'check',onClick:async()=>{
  /* The page-load read may have failed silently; retry here so a missing
     profile is reported clearly instead of rendering empty drawer fields. */
  try{await readMine();}catch(error){reportError(error,'账号资料读取失败，暂时无法报名');return;}
  if(!participant.realName||!participant.email){notify.error('请先在会员中心完善姓名和校园邮箱','完成后再回来报名，报名记录会归属到你的账号。');navigate('/me');return;}
  openShiftDrawer(e,{participant,registrations,onDone:()=>{void Promise.all([mine?.reload(),list.reload()]);}});
}}),h('p',{class:'t-caption',text:'报名通过三步确认完成；提交后由负责人确认，结果将在下方「我的报名与签到」中更新。'})):button({label:'先登录',href:`/login?next=${encodeURIComponent(eventId?`/workflow-events?event=${eventId}`:bloodOnly?'/workflow-events?type=blood':'/workflow-events')}`,variant:'primary',size:'lg',block:true,iconName:'user'}),e.blood?participationGuide():null,e.blood&&canViewPositionRoster(session)?positionRoster(e.id,expandedRosters):null)});};if(!events.length)return emptyState({title:eventId?'该活动暂未开放报名':'暂无开放活动',description:'活动需要完成审批并发布后才能报名。',actions:eventId?[button({label:'查看全部流程活动',href:'/workflow-events',variant:'secondary'})]:[]});
 const blood=events.filter(e=>e.blood);if(eventId||!blood.length)return h('div',{class:'stack-5'},...events.map(renderEvent));
 const detail=h('div',{class:'stack-5'});const selected=events.find(e=>e.id===selectedId);if(selected)detail.append(renderEvent(selected));return h('div',{class:'stack-5'},bloodCalendar(blood,registrations,e=>{selectedId=e.id;detail.replaceChildren(renderEvent(e));detail.scrollIntoView({behavior:'instant',block:'start'});void mine?.reload();},selectedId,calendarState),detail,...events.filter(e=>!e.blood).map(renderEvent));}});
 mine=session.authenticated?asyncRegion({load:readMine,render:data=>h('section',{id:'workflow-records',class:'workflow-records'},panel({title:'我的报名与签到',body:h('div',{class:'stack-5'},...data.registrations.filter(r=>!selectedId||r.eventId===selectedId).map(r=>{
   const path=`/api/portal/workflow/registrations/${encodeURIComponent(r.code)}`;const reason=field({label:'请假原因',name:'reason',required:true,maxlength:500});let leave;leave=button({label:'申请请假',onClick:async()=>{if(!reason.control.reportValidity())return;try{await runWithLoading(leave,()=>request(`${path}/leave`,{method:'POST',body:{reason:reason.control.value}}));await mine.reload();notify.success('请假申请已提交');}catch(error){reportError(error,'请假未完成');}}});
   const photo=h('input',{type:'file',accept:'image/jpeg,image/png,image/webp','aria-label':'现场签到照片'});let attendance;attendance=button({label:'提交照片签到',onClick:async()=>{const file=photo.files?.[0];if(!file||file.size>4*1024*1024){notify.error('请选择不超过4MB的现场照片');return;}try{await runWithLoading(attendance,()=>request(`${path}/attendance`,{method:'POST',form:file,headers:{'Content-Type':file.type}}));await mine.reload();notify.success('签到证据已提交，等待管理员核验');}catch(error){reportError(error,'签到未完成');}}});
   return h('section',{class:'stack-3 workflow-registration'},h('h3',{class:'t-h3',text:r.eventName}),h('p',{text:`${r.date} ${r.slot} · ${r.location} · ${r.position}`}),h('div',{class:'row-3 row-wrap'},badge(r.result,{tone:r.result==='报名成功'?'success':r.result==='报名失败'?'error':'warning'}),r.leaveStatus?badge(`请假：${r.leaveStatus}`):null),r.eventStatus==='停点'?notice(`本班次已停点：${r.stopReason}。请联系负责人确认后续安排。`,{tone:'warning'}):null,r.reason?notice(r.reason,{tone:'neutral'}):null,h('p',{class:'t-caption',text:`报名编号：${r.code} · 时长录入：${r.entryStatus}`}),r.eventStatus==='报名中'&&['待筛选','已确认'].includes(r.status)&&r.leaveStatus!=='待审批'?participationAction('申请请假','无法参加时，请填写原因。','calendar',reason,leave):null,r.eventStatus==='报名中'&&r.status==='已确认'&&r.leaveStatus!=='待审批'?(r.attendanceSubmitted?notice('签到已提交，等待确认。',{tone:'info'}):participationAction('现场签到','上传照片，完成到场登记。','camera',h('p',{class:'t-caption',text:'请在活动时段内上传带有日期时间的照片，大小不超过 4MB。'}),photo,attendance)):r.status==='已签到'?badge('签到已核验',{tone:'success'}):null);
 }),!data.registrations.some(r=>!selectedId||r.eventId===selectedId)?emptyState({title:'尚未报名',description:eventId?'选择上方班次完成报名后，确认结果会显示在这里。':'浏览活动广场，选择适合的活动参与。'}):null,!eventId&&data.profile?definitionList([['已入账服务时长',`${data.profile.serviceHours} 小时`],['培训时长',`${data.profile.trainingHours} 小时`],['交通时长',`${data.profile.travelHours} 小时`]]):null)}))}):null;
 const timer=setInterval(()=>{if(document.hidden||disposed||document.querySelector('.select-menu__trigger[aria-expanded="true"]'))return;if(--countdown<=0){countdown=60;void Promise.all([list.reload(),mine?.reload()]).catch(()=>{syncLabel.textContent='刷新暂未完成，稍后重试';});}else syncLabel.textContent=`班次自动同步 · ${countdown}秒后刷新`;},1000);
 return {dispose:()=>{disposed=true;clearInterval(timer);},title:'活动报名与献血车排班',node:h('div',{class:'view formpage stack-6 workflow-page'},h('a',{class:'workflow-back',href:'/events'},icon('chevronLeft','ico ico--sm'),h('span',{text:'活动广场'})),pageHead({title:eventId?'活动详情与报名':bloodOnly||week?'献血车报名日历':'我的活动与班次',description:eventId?'选择校区后提交报名，负责人确认后可在下方办理请假与签到。':bloodOnly?'选择周次与点位，点击班次查看详情并报名。':'查看报名进度，办理请假与签到。'}),h('div',{class:'row-between row-wrap'},syncLabel,button({label:'刷新班次',variant:'secondary',size:'sm',onClick:()=>Promise.all([list.reload(),mine?.reload()])})),list,mine)};
}
