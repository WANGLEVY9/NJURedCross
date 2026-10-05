import {bloodCalendar} from '../blood-calendar.js';
import {h,icon} from '../../core/dom.js';
import {request,getSessionState} from '../../core/api.js';
import {reportError,notify} from '../../core/toast.js';
import {asyncRegion} from '../../console/lib.js';
import {pageHead,panel,field,button,badge,notice,emptyState,runWithLoading,definitionList,guidanceCards} from '../../ui/primitives.js';
function participationGuide() {
 return guidanceCards([
  {iconName:'calendar',title:'选择班次',text:'按点位和时间报名，避免时段重叠。'},
  {iconName:'users',title:'替补报名',text:'可申请两周内的空余班次。'},
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
export default async function workflowEventsPage(context={}){
 const eventId=context.query?.get('event');let selectedId=eventId;
 const session=getSessionState();let mine;
 let registrations=[],participant={},minePending;
 const readMine=()=>minePending||(minePending=request('/api/portal/workflow/me').then(data=>{registrations=data.registrations;participant=data.participant||{};return data;}).finally(()=>{minePending=null;}));
 function action(label,path,body){let control;control=button({label,variant:'secondary',onClick:async()=>{try{await runWithLoading(control,()=>request(path,{method:'POST',body:typeof body==='function'?body():body}));notify.success('报名已提交', '可在本页查看确认结果。');await Promise.all([mine?.reload(),list.reload()]);}catch(error){reportError(error,'操作未完成');}}});return control;}
 const list=asyncRegion({load:async()=>{const [data]=await Promise.all([request('/api/public/workflow/events'),session.authenticated?readMine().catch(()=>null):Promise.resolve()]);return data;},render:data=>{const events=eventId?data.events.filter(e=>e.id===eventId):data.events;const renderEvent=e=>{const campus=field({label:'参与校区',value:participant.campus||'',options:[{value:'',label:'请选择校区'},...['鼓楼','仙林','浦口','苏州','其他'].map(value=>({value,label:value}))]});const existing=registrations.find(r=>r.eventId===e.id&& !['已取消','已拒绝','报名失败'].includes(r.status));return panel({title:e.name,body:h('div',{class:'stack-4'},definitionList([['日期与时段',`${e.date} ${e.slot}`],['地点',e.location],['岗位',e.position],['报名上限',String(e.capacity)],...(e.recommended?[['推荐人数',String(e.recommended)]]:[])]),h('p',{class:'t-secondary workflow-copy',text:e.work||'按所选日期、点位与岗位参与服务。'}),e.blood?participationGuide():null,existing?registrationCallout(existing):session.authenticated?h('div',{class:'row-3 row-wrap workflow-actions'},campus,action('报名此班次',`/api/portal/workflow/events/${e.id}/register`,()=>({campus:campus.control.value})),e.blood?action('申请替补',`/api/portal/workflow/events/${e.id}/register`,()=>({replacement:true,campus:campus.control.value})):null):button({label:'先登录',href:`/login?next=${encodeURIComponent(eventId?`/workflow-events?event=${eventId}`:'/workflow-events')}`,variant:'primary'}))});};if(!events.length)return emptyState({title:eventId?'该活动暂未开放报名':'暂无开放的试点活动',description:'活动需要完成审批并发布后才能报名。',actions:eventId?[button({label:'查看全部流程活动',href:'/workflow-events',variant:'secondary'})]:[]});
 const blood=events.filter(e=>e.blood);if(eventId||!blood.length)return h('div',{class:'stack-5'},...events.map(renderEvent));
 const detail=h('div',{class:'stack-5'});const selected=events.find(e=>e.id===selectedId);if(selected)detail.append(renderEvent(selected));return h('div',{class:'stack-5'},bloodCalendar(blood,registrations,e=>{selectedId=e.id;detail.replaceChildren(renderEvent(e));detail.scrollIntoView({behavior:'instant',block:'start'});void mine?.reload();},selectedId),detail,...events.filter(e=>!e.blood).map(renderEvent));}});
 mine=session.authenticated?asyncRegion({load:readMine,render:data=>h('section',{id:'workflow-records',class:'workflow-records'},panel({title:'我的报名与签到',body:h('div',{class:'stack-5'},...data.registrations.filter(r=>!selectedId||r.eventId===selectedId).map(r=>{
   const path=`/api/portal/workflow/registrations/${encodeURIComponent(r.code)}`;const reason=field({label:'请假原因',name:'reason',required:true,maxlength:500});let leave;leave=button({label:'申请请假',onClick:async()=>{if(!reason.control.reportValidity())return;try{await runWithLoading(leave,()=>request(`${path}/leave`,{method:'POST',body:{reason:reason.control.value}}));await mine.reload();notify.success('请假申请已提交');}catch(error){reportError(error,'请假未完成');}}});
   const photo=h('input',{type:'file',accept:'image/jpeg,image/png,image/webp','aria-label':'现场签到照片'});let attendance;attendance=button({label:'提交照片签到',onClick:async()=>{const file=photo.files?.[0];if(!file||file.size>4*1024*1024){notify.error('请选择不超过4MB的现场照片');return;}try{await runWithLoading(attendance,()=>request(`${path}/attendance`,{method:'POST',form:file,headers:{'Content-Type':file.type}}));await mine.reload();notify.success('签到证据已提交，等待管理员核验');}catch(error){reportError(error,'签到未完成');}}});
   return h('section',{class:'stack-3 workflow-registration'},h('h3',{class:'t-h3',text:r.eventName}),h('p',{text:`${r.date} ${r.slot} · ${r.location} · ${r.position}`}),h('div',{class:'row-3 row-wrap'},badge(r.result,{tone:r.result==='报名成功'?'success':r.result==='报名失败'?'danger':'warning'}),r.leaveStatus?badge(`请假：${r.leaveStatus}`):null),r.eventStatus==='停点'?notice(`本班次已停点：${r.stopReason}。请联系负责人确认后续安排。`,{tone:'warning'}):null,r.reason?notice(r.reason,{tone:'neutral'}):null,h('p',{class:'t-caption',text:`报名编号：${r.code} · 时长录入：${r.entryStatus}`}),r.eventStatus==='报名中'&&['待筛选','已确认'].includes(r.status)&&r.leaveStatus!=='待审批'?participationAction('申请请假','无法参加时，请填写原因。','calendar',reason,leave):null,r.eventStatus==='报名中'&&r.status==='已确认'&&r.leaveStatus!=='待审批'?(r.attendanceSubmitted?notice('签到已提交，等待确认。',{tone:'info'}):participationAction('现场签到','上传照片，完成到场登记。','camera',h('p',{class:'t-caption',text:'请在活动时段内上传带有日期时间的照片，大小不超过 4MB。'}),photo,attendance)):r.status==='已签到'?badge('签到已核验',{tone:'success'}):null);
 }),!data.registrations.some(r=>!selectedId||r.eventId===selectedId)?emptyState({title:'尚未报名',description:eventId?'选择上方班次完成报名后，确认结果会显示在这里。':'浏览活动广场，选择适合的活动参与。'}):null,!eventId&&data.profile?definitionList([['已入账服务时长',`${data.profile.serviceHours} 小时`],['培训时长',`${data.profile.trainingHours} 小时`],['交通时长',`${data.profile.travelHours} 小时`]]):null)}))}):null;
 return {title:'活动报名与献血车排班',node:h('div',{class:'view formpage stack-6 workflow-page'},h('a',{class:'workflow-back',href:'/events'},icon('chevronLeft','ico ico--sm'),h('span',{text:'活动广场'})),pageHead({title:eventId?'活动详情与报名':'我的活动与班次',description:'使用已验证资料报名，在下方记录查看待确认、报名成功或失败，并办理请假与签到。'}),list,mine)};
}
