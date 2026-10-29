import {bloodWeekPicker} from './blood-week-picker.js';
import {editRegistrationContact} from './activity-contact.js';
import {bloodRegistrationBoard} from './blood-registration-board.js';
import {h} from '../../core/dom.js';
import {request,getSessionState} from '../../core/api.js';
import {button,field,notice,panel,definitionList} from '../../ui/primitives.js';
import {openDrawer,confirmAction} from '../../ui/overlay.js';
import {notify,reportError} from '../../core/toast.js';
import {activityStage,stageLabel,canEditMeta} from '../../shared/activity-stage.js';
import {activityProjects} from '../../shared/activity-projects.js';
import {buildPositionMap,labelPosition} from '../../shared/position-labels.js';
import {serviceWorkspace} from './activity-service.js';
import {hoursSubmissionPanel} from './hours-submission-panel.js';
import {legacyRosterPanel} from './activity-legacy-roster.js';
import {rosterPanel,publicationPanel} from './activity-management.js';
import {canReviewActivity,canReviewHours,returnActivityApproval} from './activity-approval.js';
import {configureProjectPositions} from './activity-positions.js';
import {protectDrawerDraft} from '../../ui/drawer-draft.js';
import {openActivityChangeDrawer,isActivityChangeSupported} from './activity-change-editor.js';
import {patchQuery} from '../../core/router.js';

const root='/api/volunteer/workflow';
const config=event=>{try{return JSON.parse(event?.['报名页配置']||'{}');}catch{return {};}};
const projectRows=(events,event)=>activityProjects(events).find(project=>project.sessions?.some(row=>row._id===event._id||row['活动ID']===event['活动ID']))?.sessions||[event];
const result=row=>row['报名状态']==='待筛选'?'待确认':row['报名状态']==='未入选'?'报名失败':['已确认','已签到'].includes(row['报名状态'])?'报名成功':row['报名状态'];
const compare=(a,b)=>String(a||'').localeCompare(String(b||''),'zh-CN',{numeric:true});

/** The unified workspace keeps historical business rules, but renders every
 * legacy project phase beside the selected project instead of opening the old page. */
export function legacyActivityWorkspace({event,events,data,actionsNode,weekOptions=[],onWeekChange=()=>{},onChanged=()=>{}}){
 let disposed=false,busy=false,nestedEditor=null,service=null,directory=null,directoryError=false,directoryPending=null;
 let bloodView=new URL(window.location.href).searchParams.get('rosterView')==='list'?'list':'board';
 const rosterStates=new Map(),serviceStates=new Map();
 const session=getSessionState();
 const actor=session.user?.accountId||session.user?.username;
 const superAdmin=session.user?.role==='super_admin';
 const node=h('div',{class:'activity-legacy-workspace'});
 const toolbar=h('div',{class:'activity-draft-toolbar'});
 const body=h('div',{class:'stack-4 activity-legacy-content'});
 node.append(toolbar,body);
 const current=()=>data.events.find(row=>row._id===event._id||row['活动ID']===event['活动ID'])||event;
 const sessions=()=>projectRows(data.events,current());
 const stage=()=>activityStage(current(),{ledger:data.ledger});
 const parallel=()=>config(current()).source?.kind==='generated_blood';
 const requestedTask=new URL(window.location.href).searchParams.get('scheduleTask');
 let parallelTask=['sessions','registration','checkins','hours'].includes(requestedTask)?requestedTask:'registration';
 async function selectParallelTask(task){
  if(!['sessions','registration','checkins','hours'].includes(task)||busy||service?.isSaving?.())return;
  if(service?.hasUnsaved?.()&&!await confirmAction({title:'放弃未保存的时长修改？',confirmLabel:'放弃修改'}))return;
  service?.dispose?.();parallelTask=task;patchQuery({scheduleTask:task});render();
 }
 const canManage=()=>{
  const row=current(),c=config(row);
  return superAdmin||String(row['负责人账号ID']||'')===String(actor)||(c.coOwners||[]).map(String).includes(String(actor))||row.approvalAccess?.canReview===true;
 };
 const mutate=async(path,payload={},method='POST')=>{
  const response=await request(root+path,{method,body:payload});
  await onChanged();
  return response;
 };

 function sessionTable(rows){
  const plan=config(current()).positionDraft||config(current()).positionPlan,map=buildPositionMap(plan?.positions||[]);
  return h('div',{class:'activity-registration-table activity-legacy-sessions'},h('table',{},
   h('thead',{},h('tr',{},...['日期 / 时段','岗位','地点','人数','状态'].map(text=>h('th',{text}))))
   ,h('tbody',{},...rows.map(row=>{
    const p=map.get(row['岗位ID'])||map.get(String(row['岗位']||''));
    return h('tr',{},h('td',{text:`${row['报名日期']||'待定'} ${row['报名时段']||''}`.trim()}),h('td',{text:p?labelPosition(map,p):row['岗位']||'统一报名'}),h('td',{text:row['地点']||'待定'}),h('td',{text:String(row['容量']||'—')}),h('td',{text:row['状态']||'草稿'}));
   }))));
 }

 function openInformation(){
  const row=current(),c=config(row),rows=sessions();
  const drawer=openDrawer({title:'活动信息查看',width:900,body:h('div',{class:'stack-4'},
   panel({title:'活动概览',body:definitionList([
    ['活动名称',row['活动名称']],
    ['地区',row['活动地区']||(c.region==='苏州活动'?'苏州地区':'南京地区')],
    ['类别',row['组织类别']||c.center||row['活动类别']||'待补充'],
    ['负责人',row['负责人账号ID']||'未设置'],
    ['审批',row['审批人']?`版本 ${row['批准版本']} · ${row['审批时间']||''}`:'尚未通过审批'],
    ['活动说明',c.workspaceDescription||c.content||row['工作内容']||'未填写'],
   ])}),sessionTable(rows),panel({title:'报名通知',body:h('pre',{class:'activity-notice',text:row['通知草稿']||'尚未生成报名通知。'})}))
   ,footer:[button({label:'关闭',onClick:()=>drawer.close()})]});
 }

 async function editInformation(){
  const row=current(),c=config(row);
  if(c.positionPlan||c.parentActivityId||c.ordinary||c.blood){
   notify.warning('此活动由项目或排班表维护','请在岗位配置或来源表中调整；也可复制为新活动后编辑。');
   return;
  }
  if(!canEditMeta(row,{ledger:data.ledger})||data.registrations.length){
   notify.warning('当前阶段不能直接修改活动信息');
   return;
  }
  const name=field({label:'活动名称',required:true,value:row['活动名称']}),
   date=field({label:'活动日期',type:'date',required:true,value:row['报名日期'],disabled:Boolean(c.window)}),
   slot=field({label:'活动时段',required:true,value:row['报名时段'],disabled:Boolean(c.window)}),
   location=field({label:'活动地点',required:true,value:row['地点']}),
   capacity=field({label:'报名人数',type:'number',min:1,step:1,required:true,value:row['容量']}),
   serviceHours=field({label:'服务时长（小时）',type:'number',min:0.01,step:'any',required:true,value:row['服务时长']}),
   trainingHours=field({label:'培训时长（小时）',type:'number',min:0,step:'any',value:row['培训时长']}),
   travelHours=field({label:'交通时长（小时）',type:'number',min:0,step:'any',value:row['交通时长']}),
   work=field({label:'工作内容',multiline:true,rows:4,maxlength:500,required:true,value:row['工作内容']});
  let saving=false,drawer,confirm;
  confirm=button({label:'保存并重新审批',variant:'primary',onClick:async()=>{
   if(saving||[name,date,slot,location,capacity,serviceHours,trainingHours,travelHours,work].some(control=>!control.control.reportValidity()))return;
   saving=true;confirm.disabled=true;
   try{
    await request(`${root}/events/${encodeURIComponent(row._id)}`,{method:'PATCH',body:{
     name:name.control.value,date:date.control.value,slot:slot.control.value,location:location.control.value,
     capacity:capacity.control.value,serviceHours:serviceHours.control.value,trainingHours:trainingHours.control.value,
     travelHours:travelHours.control.value,work:work.control.value,position:row['岗位']||'',
     region:c.region||(row['活动地区']==='苏州地区'?'苏州活动':'南京活动'),
     center:row['组织类别']&&row['组织类别']!=='未分类'?row['组织类别']:c.center,
     category:row['活动类别'],bookingMode:c.bookingMode,templateId:c.templateId||'general',
     coOwners:c.coOwners||[],reviewerIds:c.reviewerIds||[],...(c.window?{window:c.window}:{}),
    }});
    saving=false;await drawer.close();notify.success('活动信息已保存，需重新提交审批');await onChanged();
   }catch(error){reportError(error,'活动信息未保存');}
   finally{saving=false;confirm.disabled=false;}
  }});
  drawer=openDrawer({title:'活动信息修改',width:820,body:h('div',{class:'activity-draft-grid'},name,date,slot,location,capacity,serviceHours,trainingHours,travelHours,work),
   beforeClose:()=>!saving,footer:[button({label:'取消',onClick:()=>drawer.close()}),confirm]});
 }

 function approvalActions(){
  const row=current(),actions=[];
  if(stage()==='approval'&&canReviewActivity(row,actor,superAdmin)){
   const token=row.positionToken;
   actions.push(button({label:'审批通过',variant:'primary',onClick:async()=>{
    if(busy)return;busy=true;
    try{await mutate(`/events/${encodeURIComponent(row._id)}/approve`,{token});notify.success('活动已通过审批');}
    catch(error){reportError(error,'审批未完成');}finally{busy=false;}
   }}),button({label:'审批退回',onClick:()=>returnActivityApproval(row,async(path,payload)=>{await mutate(path,payload);notify.success('活动已退回修改');})}));
  }
  return actions;
 }

 function stopBlood(){
  const reason=field({label:'停点原因',required:true,multiline:true,maxlength:500});let saving=false,drawer,confirm;
  confirm=button({label:'确认停点',variant:'primary',onClick:async()=>{
   if(saving||!reason.control.reportValidity())return;saving=true;confirm.disabled=true;
   try{await mutate(`/events/${encodeURIComponent(current()._id)}/stop`,{reason:reason.control.value});await drawer.close();notify.success('班次已停点');}
   catch(error){reportError(error,'停点未完成');}finally{saving=false;confirm.disabled=false;}
  }});
  drawer=openDrawer({title:'停点并显示原因',body:reason,footer:[button({label:'取消',onClick:()=>drawer.close()}),confirm]});
 }

 function registration(){
  const row=current(),rows=data.registrations.filter(registration=>sessions().some(session=>session['活动ID']===registration['活动ID']));
  const container=h('div',{class:'stack-4'},h('p',{class:'t-caption',text:'正在加载报名名单…'}));
  const build=()=>{
   if(parallel()){
    const state=legacyRosterState(row),view=h('div'),switcher=button({label:bloodView==='board'?'切换为列表':'切换为排班看板',onClick:()=>{bloodView=bloodView==='board'?'list':'board';patchQuery({rosterView:bloodView});container.replaceChildren(build());}});
    view.append(bloodView==='board'?panel({title:'报名与请假',actions:[switcher],body:bloodRegistrationBoard({events:sessions(),registrations:rows,state,busy,canManage:canManage(),onApprove:approveRegistration,onReject:registration=>reasonAction('拒绝录取并通知',`/registrations/${registration._id}/reject`),onLeave:(registration,approved)=>reasonAction(approved?'批准请假':'驳回请假',`/registrations/${registration._id}/${approved?'leave-approve':'leave-reject'}`),weekPicker:weekPicker,onRenotify:repeatNotifications,onToggleSession:(event,enabled,control)=>changeSourceRegistration(event,enabled,'session',control),onBatchLeave:approved=>batchLeave(row,approved),onBatch:(selected,decision,reopen,reason)=>processBoard(selected,decision,reopen,reason)})}):legacyRosterPanel({event:row,events:sessions(),registrations:rows,directory:directory?.participants||[],directoryError,state,busy,onBatch:()=>batchRegistrations(row,state),onBatchLeave:approved=>batchLeave(row,approved),onApprove:approveRegistration,onReason:reasonAction,context:legacyRosterContext,matches:(registration,state)=>matchesLegacyRoster(registration,state),compact:true,showLegend:sessions().length<=8,headerActions:[switcher]}));
    if(bloodView==='list'){const table=view.querySelector('.activity-legacy-roster__table');if(table)table.before(weekPicker());else view.append(weekPicker());}
    return view;
   }
   if(config(row).ordinary||config(row).blood){
    return legacyRosterPanel({event:row,events:sessions(),registrations:rows,directory:directory?.participants||[],directoryError,state:legacyRosterState(row),busy,
     onBatch:()=>batchRegistrations(row,legacyRosterState(row)),onBatchLeave:approved=>batchLeave(row,approved),onApprove:registrationRow=>approveRegistration(registrationRow),
     onReason:reasonAction,context:legacyRosterContext,matches:(registration,state)=>matchesLegacyRoster(registration,state),compact:parallel(),showLegend:sessions().length<=8});
   }
   return rosterPanel(row,rows,{refresh:onChanged,directory:directory?.participants||[],directoryError,events:sessions()});
  };
  void loadDirectory().then(()=>{if(!disposed)container.replaceChildren(build());}).catch(()=>{if(!disposed){directoryError=true;container.replaceChildren(build());}});
  return container;
 }

 function legacyRosterState(row){
  const key=`legacy-roster:${row._id}`;if(!rosterStates.has(key))rosterStates.set(key,{search:'',date:'',position:'',session:'',status:'',campus:'',leave:'',order:'asc',selectionMode:'approval',selected:new Set()});return rosterStates.get(key);
 }
 function legacyRosterContext(registration){
  const session=sessions().find(row=>row['活动ID']===registration['活动ID']);
  return {date:registration['报名日期']||session?.['报名日期']||'',position:registration['岗位']||session?.['岗位']||'',session:registration['活动ID']||'',slot:registration['报名时段']||session?.['报名时段']||'',location:registration['地点']||session?.['地点']||'',campus:session?config(session).ordinary?.campus||config(session).blood?.campus||session['校区']||'':''};
 }
 function matchesLegacyRoster(registration,state){
  const context=legacyRosterContext(registration),query=state.search.trim().toLowerCase();
  return (!query||`${registration['姓名']||''} ${registration['学号']||''}`.toLowerCase().includes(query))&&(!state.date||state.date===context.date)&&(!state.position||state.position===context.position)&&(!state.session||state.session===context.session)&&(!state.campus||state.campus===context.campus)&&(!state.leave||state.leave===(registration['请假状态']||'none'))&&(!state.status||(state.status==='leave'?registration['请假状态']==='待审批':state.status===registration['报名状态']));
 }
 async function batchRegistrations(row,state){
  const selected=data.registrations.filter(registration=>state.selected.has(registration._id)&&matchesLegacyRoster(registration,state)&&registration['报名状态']==='待筛选'&&registration['请假状态']!=='待审批');
  if(!selected.length){notify.warning('请先选择待确认的报名记录');return;}
  busy=true;
  try{
   const response=await request(`${root}/registrations/batch`,{method:'POST',body:{ids:selected.map(registration=>registration._id),action:'confirm'}});
   const failed=(response.results||[]).filter(item=>!item.ok);notify[failed.length?'warning':'success'](failed.length?`${failed.length} 条报名未完成`:'报名结果已保存',failed.map(item=>item.message).join('；'));
  }catch(error){notify.warning('批量结果待核对','请刷新名单确认，无需重复提交已成功记录。');}
  finally{busy=false;await onChanged();}
 }
 async function batchLeave(row,approved){
  const state=legacyRosterState(row),selected=data.registrations.filter(registration=>state.selected.has(registration._id)&&matchesLegacyRoster(registration,state)&&registration['请假状态']==='待审批'&&['待筛选','已确认'].includes(registration['报名状态']));
  if(!selected.length){notify.warning('请先选择待处理的请假申请');return;}
  const reason=field({label:'处理说明',required:true,multiline:true,maxlength:500});let saving=false,drawer,confirm;
  confirm=button({label:`确认${approved?'批准':'驳回'}`,variant:'primary',onClick:async()=>{
   if(saving||!reason.control.reportValidity())return;saving=true;confirm.disabled=true;
   try{await request(`${root}/registrations/batch`,{method:'POST',body:{ids:selected.map(registration=>registration._id),action:approved?'leave-approve':'leave-reject',reason:reason.control.value}});await drawer.close();notify.success('请假决定已保存');await onChanged();}
   catch(error){reportError(error,'请假处理结果待核对，请刷新名单');}
   finally{saving=false;confirm.disabled=false;}
  }});
  drawer=openDrawer({title:`批量${approved?'批准':'驳回'}请假`,body:reason,footer:[button({label:'取消',onClick:()=>drawer.close()}),confirm]});
 }
 async function approveRegistration(registration){
  try{await request(`${root}/registrations/${encodeURIComponent(registration._id)}/confirm`,{method:'POST',body:{}});notify.success('报名已确认');await onChanged();}
  catch(error){reportError(error,'报名批准未完成');}
 }
 function reasonAction(label,path){
  const vacancy=parallel()&&path.endsWith('/reject')?field({label:'该名额后续安排',options:[{value:'open',label:'重新开放，其他同学可报名'},{value:'closed',label:'不再开放，仅关闭这个名额'}]}):null;
  const reason=field({label:'处理说明',required:true,multiline:true,maxlength:500});let saving=false,drawer,confirm;
  confirm=button({label:'确认处理',variant:'primary',onClick:async()=>{
   if(saving||!reason.control.reportValidity())return;saving=true;confirm.disabled=true;
   try{await request(root+path,{method:'POST',body:{reason:reason.control.value,...(vacancy?{reopen:vacancy.control.value==='open'}:{})}});await drawer.close();notify.success('处理已完成');await onChanged();}
   catch(error){reportError(error,'处理未完成');}finally{saving=false;confirm.disabled=false;}
  }});
  drawer=openDrawer({title:label,body:h('div',{class:'stack-4'},reason,vacancy),footer:[button({label:'取消',onClick:()=>drawer.close()}),confirm]});
  protectDrawerDraft(drawer,{isBusy:()=>saving});
 }
 async function processBoard(rows,decision,reopen,reason){
  if(busy)return;busy=true;let saved=0;
  try{
   for(const row of rows){await request(`${root}/registrations/${encodeURIComponent(row._id)}/${decision}`,{method:'POST',body:decision==='reject'?{reason,reopen}:{}});saved++;}
   notify.success(`已处理 ${saved} 人`, '邮件沿用现有通知流程，请在列表中核对发送状态。');
  }catch(error){reportError(error,`已处理 ${saved} / ${rows.length} 人，请刷新核对后仅重试未处理记录`);}
  finally{busy=false;await onChanged();}
 }
 async function repeatNotifications(rows){
  if(busy||!rows.length)return;busy=true;
  try{
   const batches=[],items=[];
   for(const event of sessions()){
    const group=rows.filter(row=>row['活动ID']===event['活动ID']);
    for(let i=0;i<group.length;i+=10){const ids=group.slice(i,i+10).map(row=>row._id),url=`${root}/events/${encodeURIComponent(event._id)}/notify-results`;const preview=await request(url,{method:'POST',body:{preview:true,ids}});items.push(...preview.items);batches.push({url,ids});}
   }
   if(items.length!==rows.length||items.some(item=>item.reason)){openDrawer({title:'通知核验未通过',body:h('div',{},...items.map(item=>h('p',{text:`${item.name}：${item.reason||'邮箱可用'}`})))});return;}
   if(!await confirmAction({title:`再次通知 ${items.length} 人？`,description:items.map(item=>`${item.name} · ${item.email}\n${item.information}`).join('\n\n'),confirmLabel:'确认发送'}))return;
   const requestId=crypto.randomUUID();let failed=0;
   for(const batch of batches){const result=await request(batch.url,{method:'POST',body:{repeat:true,requestId,ids:batch.ids}});failed+=(result.results||[]).filter(item=>item.status!=='sent').length;}
   notify[failed?'warning':'success'](failed?`${failed} 条通知未确认发送成功，请查看结果`:'本次通知已发送');
  }catch(error){reportError(error,'通知结果需核对，请勿连续重复发送');}
  finally{busy=false;await onChanged();}
 }
 function loadDirectory(){
  if(directory)return Promise.resolve(directory);
  if(directoryPending)return directoryPending;
  directoryPending=request(`${root}/directory?event=${encodeURIComponent(current()._id)}`,{fresh:true}).then(payload=>{directory=payload;directoryError=Boolean(payload.profileWarning);return payload;}).finally(()=>{directoryPending=null;});
  return directoryPending;
 }

 function weekPicker(){return bloodWeekPicker({options:weekOptions,current:event._id,onChange:onWeekChange});}
 function servicePanel(kind){
  const row=current(),rows=sessions(),registrations=data.registrations.filter(registration=>rows.some(session=>session['活动ID']===registration['活动ID'])),ledger=data.ledger.filter(item=>rows.some(session=>session['活动ID']===item['活动ID']));
  const key=`${row._id}:${kind}:${parallel()?bloodView:'list'}`;if(!serviceStates.has(key))serviceStates.set(key,{expanded:true});
  const switcher=parallel()?button({label:bloodView==='board'?'切换为列表':'切换为排班看板',onClick:async()=>{if(service?.isSaving?.())return;if(service?.hasUnsaved?.()&&!await confirmAction({title:'放弃未保存的修改？',confirmLabel:'放弃修改'}))return;service?.dispose?.();bloodView=bloodView==='board'?'list':'board';patchQuery({rosterView:bloodView});render();}}):null;
  service=serviceWorkspace({event:row,events:rows,registrations,ledger,kind,actor,superAdmin,bloodBoard:parallel()?{view:bloodView,events:rows,picker:weekPicker,switcher}:null,state:serviceStates.get(key),onNavigate:task=>{if(parallel())void selectParallelTask(task);else void onChanged();},onSaved:onChanged});
  const parts=[];
  if(stage()!=='ended')parts.push(hoursSubmissionPanel({event:row,registrations,ledger,canReview:canReviewHours(row,actor,superAdmin),hasUnsaved:()=>service?.hasUnsaved?.()||service?.isSaving?.(),onSaved:onChanged}));
  parts.push(service);
  return h('div',{class:'stack-4'},...parts);
 }

 async function changeSourceRegistration(row,enabled,scope,control){
  if(busy||service?.isSaving?.())return;
  if(service?.hasUnsaved?.()){notify.warning('请先保存当前时长修改');return;}
  const project=scope==='project',label=enabled?'开放报名':'结束报名';
  if(!await confirmAction({title:`${project?'整周':'本场'}${label}？`,description:project?'将统一调整本周所有场次的报名开关，后续新增场次继承该选择。停点和已过期场次不会开放，已有报名与时长记录保留。':`${row['报名日期']} · ${row['地点']} · ${row['报名时段']}。仅调整本场，其他场次不受影响；结束报名后可以再次开放。`,confirmLabel:label}))return;
  busy=true;control.disabled=true;control.setAttribute('aria-busy','true');
  try{
   const c=config(row),decision=project?c.sourceProjectRegistration:c.sourceRegistration;
   await mutate(`/events/${encodeURIComponent(row._id)}/source-registration`,{enabled,scope,revision:decision?.revision||0});
   notify.success(`${project?'整周':'本场'}${enabled?'报名已开放':'报名已结束'}`);
  }catch(error){await onChanged().catch(()=>{});reportError(error,'报名开关未完成，已同步为最新状态，请重试');}
  finally{busy=false;if(!disposed){control.disabled=false;control.removeAttribute('aria-busy');}}
 }
 // A filtered month can hold hundreds of shifts, so the panel also applies one
 // decision to the sessions currently listed instead of only one or all of them.
 async function changeSelectionRegistration(rows,enabled,control){
  if(busy||service?.isSaving?.())return;
  if(service?.hasUnsaved?.()){notify.warning('请先保存当前时长修改');return;}
  if(!rows.length){notify.warning('当前筛选结果没有可调整的场次');return;}
  const label=enabled?'开放报名':'结束报名';
  if(!await confirmAction({title:`对当前筛选的 ${rows.length} 场${label}？`,description:`按当前日期与搜索条件统一${label}，未筛选到的场次不受影响；停点和已过期场次不会开放，结束报名后可以再次开放。`,confirmLabel:label}))return;
  busy=true;control.disabled=true;control.setAttribute('aria-busy','true');
  try{
   await mutate(`/events/${encodeURIComponent(current()._id)}/source-registration`,{enabled,scope:'selection',revision:0,ids:rows.map(row=>row._id)});
   notify.success(`已对 ${rows.length} 场${enabled?'开放报名':'结束报名'}`);
  }catch(error){await onChanged().catch(()=>{});reportError(error,'批量报名开关未完成，已同步为最新状态，请重试');}
  finally{busy=false;if(!disposed){control.disabled=false;control.removeAttribute('aria-busy');}}
 }

 function sourceRegistrationPanel(){
  const params=new URL(window.location.href).searchParams;
  const date=field({label:'场次日期',type:'date',value:params.get('scheduleDate')||''});
  const search=field({label:'搜索点位或时段',type:'search',placeholder:'例如：新街口、下午',value:params.get('scheduleSearch')||''});
  const list=h('div',{class:'source-registration-list'}),summary=h('p',{class:'t-caption','aria-live':'polite'});
  const rows=sessions().filter(row=>config(row).source?.kind==='generated_blood');
  const batch=h('div',{class:'activity-draft-toolbar row-wrap','aria-label':'按筛选结果批量调整报名'});
  // Buttons capture their disabled flag, so the batch controls are rebuilt with
  // the current filter result instead of being mutated in place.
  const renderBatch=selectable=>batch.replaceChildren(...[[true,'批量开放报名'],[false,'批量结束报名']].map(([enabled,label])=>
   button({label,variant:'secondary',disabled:busy||!selectable.length,onClick:event=>changeSelectionRegistration(selectable,enabled,event.currentTarget)})));
  const renderCards=()=>{
   const visible=rows.filter(row=>(!date.control.value||row['报名日期']===date.control.value)&&(!search.control.value.trim()||`${row['地点']} ${row['报名时段']}`.includes(search.control.value.trim())));
   const selectable=visible.filter(row=>['报名中','进行中'].includes(row['状态'])&&(superAdmin||row.approvalAccess?.canManageRegistration===true));
   summary.textContent=`本周 ${rows.length} 场 · 当前显示 ${visible.length} 场 · 可批量调整 ${selectable.length} 场`;
   renderBatch(selectable);
   list.replaceChildren(...visible.map(row=>{
    const c=config(row),available=['报名中','进行中'].includes(row['状态']),enabled=c.sourceRegistration?.enabled!==false;
    const status=available?enabled?'报名开放':'报名已结束':row['状态']==='停点'?'底表已停点':'场次已结束';
    const permitted=superAdmin||row.approvalAccess?.canManageRegistration===true;
    const toggle=button({label:enabled?'结束报名':'开放报名',variant:enabled?'secondary':'primary',disabled:busy||!available||!permitted,onClick:()=>changeSourceRegistration(row,!enabled,'event',toggle)});
    return h('article',{class:'source-registration-card',data:{session:row._id},'aria-label':`${row['报名日期']} ${row['地点']} ${row['报名时段']}`},
     h('div',{class:'source-registration-card__content'},h('h4',{text:row['地点']}),h('p',{class:'t-caption',text:`${row['报名日期']} · ${row['报名时段']}`}),h('p',{class:'t-caption',text:`底表名额 ${row['容量']} · ${status}`})),
     h('div',{class:'source-registration-card__action'},toggle,!available?h('span',{class:'t-caption',text:row['状态']==='停点'?'请先在底表恢复排班':row['状态']==='已归档'?'本周项目已结束':'场次已结束'}):null));
   }));
   if(!visible.length)list.append(notice('没有匹配的场次，请调整日期或搜索条件。',{tone:'info'}));
  };
  date.control.addEventListener('change',()=>{patchQuery({scheduleDate:date.control.value||null});renderCards();});
  search.control.addEventListener('input',()=>{patchQuery({scheduleSearch:search.control.value||null});renderCards();});
  renderCards();return h('section',{class:'stack-3','aria-label':'献血车场次报名管理'},h('div',{class:'source-registration-filters'},date,search),summary,batch,list);
 }

 function render(){
  if(disposed)return;
  nestedEditor?.dispose?.();nestedEditor=null;service=null;
  const row=current(),state=stage(),c=config(row),controls=[button({label:'活动信息查看',onClick:openInformation})];
  if(canManage()&&['draft','approval','ready'].includes(state)&&!c.positionPlan&&!c.parentActivityId&&!c.ordinary&&!c.blood)controls.push(button({label:'活动信息修改',disabled:!canEditMeta(row,{ledger:data.ledger})||Boolean(data.registrations.length),onClick:editInformation}));
  if(canManage()&&isActivityChangeSupported(row)&&!data.ledger.length&&!data.registrations.some(item=>item['报名状态']==='已签到'))controls.push(button({label:'活动信息修改',onClick:()=>openActivityChangeDrawer({event:row,registrations:data.registrations,onSaved:onChanged})}));
  if(state==='approval')controls.push(...approvalActions());
  if(parallel())controls.push(button({label:'排班来源与模板',onClick:async()=>{
   const {openScheduleSource}=await import('./activity-schedule-source.js');
   await openScheduleSource(async()=>{
    if(service?.isSaving?.()||busy)throw Error('请等待当前操作完成');
    if(service?.hasUnsaved?.()&&!await confirmAction({title:'放弃未保存的时长修改？',confirmLabel:'放弃修改'}))return;
    await onChanged();
   });
  }}));
  if(canManage()&&state==='registering'&&c.blood&&c.source?.kind!=='generated_blood')controls.push(button({label:'停点',onClick:stopBlood}));
  if(!parallel()&&state==='registering'&&(c.ordinary||c.blood)&&canManage())controls.push(button({label:'报名截止',variant:'primary',onClick:async()=>{
   if(!await confirmAction({title:'截止整个项目报名？',description:'已有报名和签到记录会保留。',confirmLabel:'报名截止'}))return;
   try{await mutate(`/events/${encodeURIComponent(row._id)}/close`,{scope:'project'});notify.success('报名已截止');}catch(error){reportError(error,'报名截止未完成');}
  }}));
  if(parallel()&&(superAdmin||row.approvalAccess?.canManageRegistration===true)&&sessions().some(item=>['报名中','进行中'].includes(item['状态']))){
   for(const [enabled,label] of [[true,'整周开放报名'],[false,'整周结束报名']]){
    const control=button({label,disabled:busy,onClick:()=>changeSourceRegistration(row,enabled,'project',control)});controls.push(control);
   }
  }
  if(c.bookingMode==='grouped'&&['draft','approval','ready'].includes(state)&&canManage()&&!c.positionPlan)controls.push(button({label:'配置报名岗位',onClick:()=>configureProjectPositions(row,onChanged)}));
  if(parallel()){
   const low=controls.splice(0);
   controls.push(button({label:'通知信息编辑',onClick:()=>editRegistrationContact(current()._id).catch(error=>reportError(error,'通知信息暂时无法加载'))}),h('details',{class:'blood-more-actions'},h('summary',{text:'更多操作'}),h('div',{class:'blood-more-menu'},...low)));
  }
  else if(actionsNode)controls.push(actionsNode);
  node.classList.toggle('activity-schedule-workspace',parallel());
  toolbar.hidden=parallel();toolbar.replaceChildren(...(parallel()?[]:controls));
  body.replaceChildren();
  if(parallel()){
   const archived=sessions().every(item=>item['状态']==='已归档');
   if(archived)body.append(notice('本周项目已结束，报名已关闭。',{tone:'info'}));
   const tasks=[['registration','报名审核与通知'],['checkins','签到审核'],['hours','时长审核与导出']];
   const taskbar=h('div',{class:'activity-draft-toolbar activity-schedule-tasks','aria-label':'排班并行工作'},...tasks.map(([task,label])=>{
    const control=button({label,variant:parallelTask===task?'primary':'secondary',onClick:()=>selectParallelTask(task)});
    control.setAttribute('aria-pressed',String(parallelTask===task));return control;
   }),h('span',{class:'spacer'}),...controls);body.append(taskbar);
   body.append(parallelTask==='sessions'?sourceRegistrationPanel():parallelTask==='registration'?registration():servicePanel(parallelTask));
   return;
  }
  if(state==='registering'){
   body.append(registration());
  }else if(state==='running'){
   body.append(servicePanel('checkins'));
  }else if(state==='hours'||state==='ended'){
   body.append(servicePanel('hours'));
  }else{
   const summary=panel({
    title:'活动概览',
    description:state==='ready'?'审批已通过，核对通知并发布。':state==='approval'?'等待指定审核人处理。':'活动尚未进入报名阶段。',
    body:h('div',{class:'stack-4'},
     definitionList([['当前状态',state==='ready'?'已审批 · 待发布':stageLabel(state)],['活动区域',row['活动地区']||'待补充'],['活动类别',row['组织类别']||c.center||'待补充'],['报名方式',c.bookingMode==='grouped'?'多岗位':c.bookingMode==='unified'?'单岗位':'统一报名'],['报名截止',(c.positionDraft||c.positionPlan)?.deadline||c.registrationDeadline||c.deadline||'未设置'],['负责人',row['负责人账号ID']||'未设置']]),
     sessionTable(sessions())),
   });
   body.append(summary);
   if(state==='draft'||state==='ready'){
    nestedEditor=publicationPanel(row,{config:c,editable:canManage()&&!data.registrations.length,mutate,onConfigure:canManage()&&!c.positionPlan?()=>configureProjectPositions(row,onChanged):null});
    if(!canManage()){
     nestedEditor.querySelector('.activity-publication__actions')?.remove();
     const schedule=nestedEditor.querySelector('.activity-publication__controls input');if(schedule)schedule.disabled=true;
    }
    body.append(nestedEditor);
   }else if(state==='approval'){
    body.append(panel({title:'审批预览',body:notice(row['通知草稿']||'尚未生成报名通知。',{tone:'neutral'})}));
   }
  }
 }

 render();
 return {
  node,
  hasUnsaved:()=>nestedEditor?.hasUnsaved?.()||service?.hasUnsaved?.()||false,
  isSaving:()=>busy||nestedEditor?.isSaving?.()||service?.isSaving?.()||false,
  dispose:()=>{disposed=true;nestedEditor?.dispose?.();service?.dispose?.();},
 };
}
