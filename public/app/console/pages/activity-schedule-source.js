import {h} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {button,notice,definitionList,field} from '../../ui/primitives.js';
import {openDrawer,confirmAction} from '../../ui/overlay.js';
import {reportError,notify} from '../../core/toast.js';
import {shanghaiInstant} from '../../shared/activity-window.js';

/** Source adapters project rows on read; never import duplicate workflow events. */
export async function openScheduleSource(onRefresh=async()=>{}){
 try{
  const {result}=await request('/api/volunteer/workflow/blood-schedule-source',{fresh:true});
  // 自动化总览需要活动全局权限；没有权限时只保留原有的只读说明。
  let automation=null;
  try{automation=(await request('/api/volunteer/workflow/blood-week',{fresh:true})).result;}catch{automation=null;}
  const body=h('div',{class:'stack-4'},
   notice('献血车属于自动排班活动：模板表 → 底表自动化生成岗位 → 平台读取。无需用“新建活动”或“来源活动纳入”重复导入。'),
   definitionList([['岗位来源底表',result.sourceTable],['模板表',result.templateTable],['已读取班次',String(result.sessionCount)],['底表有效名额合计',String(result.capacity)]]),
   !result.bookingReady?notice(`报名占位尚未就绪：请管理员核对底表文本列 ${result.missingBookingColumns.join('、')}。本入口不会自动增列或修改历史数据。`,{tone:'warning'}):notice('报名占位关联列已就绪。'),
   automation?bloodWeekAutomation(automation,onRefresh):null,
   notice('新增日期、班次、名额或停点在底表维护，刷新后读取。已有报名、签到和时长不迁移；照片证据和时长审核规则保留。'),
   result.templateAvailable?h('div',{class:'table-wrap'},h('table',{},h('thead',{},h('tr',{},...['序号','点位','活动时间'].map(text=>h('th',{text})))),h('tbody',{},...result.templateRows.map(row=>h('tr',{},...['序号','点位','活动时间'].map(key=>h('td',{text:row[key]||'—'}))))))):notice('未找到模板表；平台仍可读取已生成的底表岗位。请由底表管理员核对模板及自动化规则。',{tone:'warning'}));
  let drawer,busy=false;
  const refresh=button({label:'刷新排班',onClick:async()=>{if(busy)return;busy=true;refresh.disabled=true;try{await onRefresh();await drawer.close();}catch(error){reportError(error,'排班刷新失败');}finally{busy=false;refresh.disabled=false;}}});
  drawer=openDrawer({title:'排班来源与模板',width:850,body,footer:[button({label:'关闭',onClick:()=>drawer.close()}),refresh]});
 }catch(error){reportError(error,'排班来源与模板读取失败');}
}

const WEEKDAYS=[['1','周一'],['2','周二'],['3','周三'],['4','周四'],['5','周五'],['6','周六'],['7','周日']];
const weekdayLabel=value=>WEEKDAYS.find(([day])=>day===String(value))?.[1]||'—';
const pad=value=>String(value).padStart(2,'0');
const clock=({hour,minute})=>`${pad(hour)}:${pad(minute)}`;
const instantText=value=>value?`${Number(value.slice(5,7))}月${Number(value.slice(8,10))}日 ${value.slice(11,16)}`:'报名已开放';

/** 周次自动化：手动生成下一周次、按周配置发布时间、维护自动生成与发布规则。 */
function bloodWeekAutomation(data,onRefresh){
 const settings=data.settings||{},weeks=data.weeks||[],next=data.next||{};
 const root=h('section',{class:'stack-3','aria-label':'献血车周次自动化'});
 const status=h('p',{class:'t-caption','aria-live':'polite'});
 const reload=async()=>{try{await onRefresh();}catch{/* 刷新失败不撤销已完成的写入 */}};

 async function generate(){
  if(!next.monday)return;
  const ok=await confirmAction({title:`生成 ${next.label} 的献血车排班？`,description:`以底表 ${next.templateLabel||'最新周次'} 为模板，按同样的点位、班次与名额生成 ${next.positionCount||0} 个岗位，只替换日期。已有报名、签到与时长不受影响；生成后按规则在活动广场开放报名。`,confirmLabel:'生成排班'});
  if(!ok)return;
  try{
   const {result}=await request('/api/volunteer/workflow/blood-week/generate',{method:'POST',body:{monday:next.monday}});
   notify.success(`已生成 ${result.label}：${result.rows} 个岗位，${result.publishAt?`将于 ${instantText(result.publishAt)} 开放报名`:'报名已开放'}`);
   await reload();
  }catch(error){reportError(error,'周次排班生成未完成');}
 }

 const generateButton=button({label:'立即生成下一周次',variant:'primary',disabled:Boolean(next.error||next.exists),onClick:generate});
 const plan=next.error?notice(next.error,{tone:'warning'}):next.exists
  ?notice(`底表已有 ${next.label} 的排班记录，可在活动管理中按周次查看与发布。`,{tone:'info'})
  :notice(`下一周次 ${next.label}（${next.monday} — ${next.sunday}），模板为底表 ${next.templateLabel}，将生成 ${next.positionCount} 个岗位。`);
 const summary=definitionList([
  ['下一周次',next.label?`${next.label}（${next.monday} — ${next.sunday}）`:'—'],
  ['模板周次',next.templateLabel?`${next.templateLabel} · 第 ${next.templateWeek} 周`:'—'],
  ['自动生成',settings.autoGenerate===false?'已关闭':`每${weekdayLabel(settings.generateWeekday)} ${clock({hour:settings.generateHour,minute:settings.generateMinute})}`],
  ['自动发布',settings.autoPublish===false?'生成后立即开放':`每${weekdayLabel(settings.publishWeekday)} ${clock({hour:settings.publishHour,minute:settings.publishMinute})}`],
 ]);

 const list=h('div',{class:'stack-2'});
 const renderWeeks=()=>{
  if(!weeks.length){list.replaceChildren(notice('底表还没有已生成的周次，可先生成下一周次。',{tone:'info'}));return;}
  list.replaceChildren(...weeks.map(week=>weekRow(week,async()=>{await reload();})));
 };
 renderWeeks();
 root.append(h('div',{class:'stack-2'},h('h3',{class:'t-title',text:'周次自动生成与发布'}),summary,plan,status),generateButton,h('div',{class:'stack-2'},h('h4',{class:'t-strong',text:'已生成的周次'}),list),settingsForm(settings,async()=>{await reload();}));
 return root;
}

function weekRow(week,onChanged){
 const time=field({label:'开放报名时间（北京时间）',name:`publish-${week.monday}`,type:'datetime-local',step:60,value:week.publishAt?week.publishAt.slice(0,16):''});
 const editor=h('div',{class:'row-2 row-wrap',hidden:true},time,
  button({label:'保存时间',onClick:async()=>{
   const instant=shanghaiInstant(time.control.value);
   time.control.setCustomValidity(!instant?'请选择开放报名时间':instant.timestamp<=Date.now()?'请选择未来的北京时间':'');
   if(!time.control.reportValidity())return;
   try{await request('/api/volunteer/workflow/blood-week/publish',{method:'POST',body:{monday:week.monday,publishAt:instant.canonical}});notify.success(`${week.label} 将于 ${instantText(instant.canonical)} 开放报名`);await onChanged();}
   catch(error){reportError(error,'发布时间未保存');}
  }}),
  button({label:'取消定时',variant:'ghost',disabled:!week.publishAt,onClick:async()=>{
   try{await request('/api/volunteer/workflow/blood-week/publish',{method:'POST',body:{monday:week.monday,publishAt:null}});notify.success(`${week.label} 已立即开放报名`);await onChanged();}
   catch(error){reportError(error,'发布时间未撤销');}
  }}));
 const toggle=button({label:'调整发布时间',size:'sm',onClick:()=>{editor.hidden=!editor.hidden;if(!editor.hidden)time.control.focus();}});
 const content=h('div',{class:'source-registration-card__content'},
  h('h4',{text:week.label}),
  h('p',{class:'t-caption',text:`${week.monday} — ${week.sunday} · ${week.sessions} 个班次 · ${week.capacity} 个名额`}),
  h('p',{class:'t-caption',text:week.publishAt?`报名开放：${instantText(week.publishAt)}`:'报名开放时间：立即'}));
 return h('article',{class:'source-registration-card','aria-label':week.label},content,h('div',{class:'source-registration-card__action'},toggle),editor);
}

function settingsForm(settings,onSaved){
 let busy=false;
 const auto=field({label:'每周自动生成',name:'autoGenerate',options:[{value:'true',label:'开启'},{value:'false',label:'关闭'}],value:settings.autoGenerate===false?'false':'true'});
 const genDay=field({label:'生成周几',name:'generateWeekday',options:WEEKDAYS.map(([value,label])=>({value,label})),value:String(settings.generateWeekday??3)});
 const genTime=field({label:'生成时间（北京时间）',name:'generateTime',type:'time',value:clock({hour:settings.generateHour??9,minute:settings.generateMinute??0})});
 const autoPublish=field({label:'生成后自动定时发布',name:'autoPublish',options:[{value:'true',label:'开启'},{value:'false',label:'关闭'}],value:settings.autoPublish===false?'false':'true'});
 const pubDay=field({label:'发布周几',name:'publishWeekday',options:WEEKDAYS.map(([value,label])=>({value,label})),value:String(settings.publishWeekday??4)});
 const pubTime=field({label:'发布时间（北京时间）',name:'publishTime',type:'time',value:clock({hour:settings.publishHour??9,minute:settings.publishMinute??0})});
 const save=button({label:'保存自动化规则',variant:'primary',onClick:async()=>{
  if(busy)return;
  const [generateHour,generateMinute]=genTime.control.value.split(':').map(Number);
  const [publishHour,publishMinute]=pubTime.control.value.split(':').map(Number);
  if(!Number.isInteger(generateHour)||!Number.isInteger(publishHour)){notify.warning('请填写有效的北京时间');return;}
  busy=true;save.disabled=true;
  try{
   await request('/api/volunteer/workflow/blood-week/settings',{method:'PATCH',body:{
    autoGenerate:auto.control.value==='true',generateWeekday:Number(genDay.control.value),generateHour,generateMinute:generateMinute||0,
    autoPublish:autoPublish.control.value==='true',publishWeekday:Number(pubDay.control.value),publishHour,publishMinute:publishMinute||0,
   }});
   notify.success('自动化规则已保存，下一次生成按新规则执行；已生成的周次可在上方单独调整。');
   await onSaved();
  }catch(error){reportError(error,'自动化规则未保存');}
  finally{busy=false;save.disabled=false;}
 }});
 return h('section',{class:'stack-2','aria-label':'自动排班规则'},
  h('h4',{class:'t-strong',text:'自动排班规则'}),
  h('div',{class:'activity-draft-grid'},auto,genDay,genTime,autoPublish,pubDay,pubTime),
  notice('规则只在配置的时间点由后台执行一次；生成后该周次不会重复写入。修改规则不影响已生成周次的发布时间。',{tone:'info'}),
  save);
}
