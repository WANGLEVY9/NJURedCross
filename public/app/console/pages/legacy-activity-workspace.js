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
export function legacyActivityWorkspace({event,events,data,actionsNode,onChanged=()=>{}}){
 let disposed=false,busy=false,nestedEditor=null,service=null,directory=null,directoryError=false,directoryPending=null;
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
 let parallelTask=['registration','checkins','hours'].includes(requestedTask)?requestedTask:stage()==='registering'?'registration':'hours';
 async function selectParallelTask(task){
  if(!['registration','checkins','hours'].includes(task)||busy||service?.isSaving?.())return;
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
  const reason=field({label:'处理说明',required:true,multiline:true,maxlength:500});let saving=false,drawer,confirm;
  confirm=button({label:'确认处理',variant:'primary',onClick:async()=>{
   if(saving||!reason.control.reportValidity())return;saving=true;confirm.disabled=true;
   try{await request(root+path,{method:'POST',body:{reason:reason.control.value}});await drawer.close();notify.success('处理已完成');await onChanged();}
   catch(error){reportError(error,'处理未完成');}finally{saving=false;confirm.disabled=false;}
  }});
  drawer=openDrawer({title:label,body:reason,footer:[button({label:'取消',onClick:()=>drawer.close()}),confirm]});
  protectDrawerDraft(drawer,{isBusy:()=>saving});
 }
 function loadDirectory(){
  if(directory)return Promise.resolve(directory);
  if(directoryPending)return directoryPending;
  directoryPending=request(`${root}/directory?event=${encodeURIComponent(current()._id)}`,{fresh:true}).then(payload=>{directory=payload;directoryError=Boolean(payload.profileWarning);return payload;}).finally(()=>{directoryPending=null;});
  return directoryPending;
 }

 function servicePanel(kind){
  const row=current(),rows=sessions(),registrations=data.registrations.filter(registration=>rows.some(session=>session['活动ID']===registration['活动ID'])),ledger=data.ledger.filter(item=>rows.some(session=>session['活动ID']===item['活动ID']));
  const key=`${row._id}:${kind}`;if(!serviceStates.has(key))serviceStates.set(key,{expanded:true});
  service=serviceWorkspace({event:row,events:rows,registrations,ledger,kind,actor,superAdmin,state:serviceStates.get(key),onNavigate:task=>{if(parallel())void selectParallelTask(task);else void onChanged();},onSaved:onChanged});
  const parts=[];
  if(stage()!=='ended')parts.push(hoursSubmissionPanel({event:row,registrations,ledger,canReview:canReviewHours(row,actor,superAdmin),hasUnsaved:()=>service?.hasUnsaved?.()||service?.isSaving?.(),onSaved:onChanged}));
  parts.push(service);
  return h('div',{class:'stack-4'},...parts);
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
  if(state==='registering'&&(c.ordinary||c.blood)&&canManage())controls.push(button({label:'报名截止',variant:'primary',onClick:async()=>{
   if(!await confirmAction({title:'截止整个项目报名？',description:'已有报名和签到记录会保留。',confirmLabel:'报名截止'}))return;
   try{await mutate(`/events/${encodeURIComponent(row._id)}/close`,{scope:'project'});notify.success('报名已截止');}catch(error){reportError(error,'报名截止未完成');}
  }}));
  if(c.bookingMode==='grouped'&&['draft','approval','ready'].includes(state)&&canManage()&&!c.positionPlan)controls.push(button({label:'配置报名岗位',onClick:()=>configureProjectPositions(row,onChanged)}));
  if(actionsNode)controls.push(actionsNode);
  node.classList.toggle('activity-schedule-workspace',parallel());
  toolbar.replaceChildren(...controls);
  body.replaceChildren();
  if(parallel()){
   const tasks=[['registration','报名审核与通知'],['checkins','签到与分批录入'],['hours','时长审核与导出']];
   body.append(h('div',{class:'activity-draft-toolbar activity-schedule-tasks','aria-label':'排班并行工作'},...tasks.map(([task,label])=>{
    const control=button({label,variant:parallelTask===task?'primary':'secondary',onClick:()=>selectParallelTask(task)});
    control.setAttribute('aria-pressed',String(parallelTask===task));return control;
   })));
   body.append(parallelTask==='registration'?registration():servicePanel(parallelTask));
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
