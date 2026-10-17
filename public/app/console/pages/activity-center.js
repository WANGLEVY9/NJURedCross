import {ACTIVITY_CENTERS,HALF_HOURS,serviceDuration} from '../../shared/activity-management.js';
import {activityKind} from '../../shared/activity-taxonomy.js';
import {registrationParticipant} from '../../shared/registration-profile.js';
import {rosterPanel,publicationPanel,publicationReadiness} from './activity-management.js';
import {localizeActivityDate} from './activity-date.js';
import {searchField} from '../../ui/search-field.js';
import {peoplePicker} from '../../ui/people-picker.js';
import {enhanceDateTimeField} from '../../ui/date-time-picker.js';
import {activityWindow} from '../../shared/activity-window.js';
import {configureProjectPositions} from './activity-positions.js';
import {patchQuery,setLeaveGuard} from '../../core/router.js';
import {h,clear} from '../../core/dom.js';
import { protectDrawerDraft } from '../../ui/drawer-draft.js';
import {request,getSessionState,refreshSession,ApiError} from '../../core/api.js';
import {notify,reportError} from '../../core/toast.js';
import {openDrawer,confirmAction} from '../../ui/overlay.js';
import {asyncRegion} from '../lib.js';
import {serviceWorkspace} from './activity-service.js';
import { summarizeBatchResult } from '../batch-result.js';
import { agentApi } from '../agent-api.js';
import { agentActivityHandoff } from '../../shared/agent-activity-handoff.js';
import {pageHead,panel,field,button,badge,segmented,emptyState,notice,definitionList,runWithLoading,checkbox} from '../../ui/primitives.js';
const root='/api/volunteer/workflow';
import {explorerItems,explorerRow} from './activity-explorer.js';
import {activityProjects,projectEvents,activityProjectKey} from '../../shared/activity-projects.js';
import {canReviewActivity,configureActivityApprovers,returnActivityApproval} from './activity-approval.js';
import {activityStage,stageLabel,stageTone,stageActions,canEditMeta,nextStepHint,stageProgress,hasSubmittedHours} from '../../shared/activity-stage.js';
import {buildPositionMap,labelPosition} from '../../shared/position-labels.js';
const config=e=>{try{return JSON.parse(e['报名页配置']||'{}');}catch{return {};}};
const result=r=>r['报名状态']==='待筛选'?'待确认':r['报名状态']==='未入选'?'报名失败':['已确认','已签到'].includes(r['报名状态'])?'报名成功':r['报名状态'];
export default async function activityCenter(context,shell){
 let publicationEditor=null,publicationIdentity=null,leaving=false,serviceIdentity=null;
 const serviceEditor=()=>document.querySelector('.field-edit-dialog')||document.querySelector('.service-workspace');
 const hasUnsaved=()=>serviceEditor()?.hasUnsaved?.()||publicationEditor?.hasUnsaved()||document.querySelector('.notification-email')?.hasUnsaved();
 const confirmLeave=async()=>{if(serviceEditor()?.isSaving?.()||publicationEditor?.isSaving()||document.querySelector('.notification-email')?.isSaving()){notify.warning('正在保存，请等待结果后离开');return false;}if(!hasUnsaved())return true;const accepted=await confirmAction({title:serviceEditor()?.hasUnsaved?.()?'放弃未提交的服务信息？':'放弃未保存的通知修改？',description:'已保存的内容保持不变。',confirmLabel:'放弃修改'});if(accepted){document.querySelector('.notification-email')?.discard();serviceEditor()?.discard?.();}return accepted;};
 const releaseGuard=setLeaveGuard(confirmLeave);
 const beforeUnload=event=>{if(hasUnsaved()){event.preventDefault();event.returnValue='';}};
 window.addEventListener('beforeunload',beforeUnload);
 const serviceStates=new Map();
 let superAdmin=getSessionState().user?.role==='super_admin';
 let actor=getSessionState().user?.accountId||getSessionState().user?.username;
 const selectedRegistrations=new Set();

 let batchConfirming = false;
 let sourceTargetHandled = false;
 let agentTargetHandled = false;
 let activityDisposed = false;

 async function resolveAgentTaskTarget() {
  if (agentTargetHandled || !context.query.has('agentTask')) return;

  agentTargetHandled = true;
  const id = context.query.get('agentTask');
  patchQuery({agentTask:null});

  if (!id?.trim()) {
   notify.warning('无法带入活动配置', '任务编号为空。');
   return;
  }

  try {
   const payload = await agentApi.get(id);
   if (activityDisposed || location.pathname !== context.path) return;

   const draftSeed = agentActivityHandoff(payload.task);
   await createDrawer({draftSeed});
  } catch (error) {
   if (!activityDisposed && location.pathname === context.path) {
    notify.warning(
     '无法带入活动配置',
     error.message || '请回到工作助手检查任务权限和已保存的配置。',
    );
   }
  }
 }

 function resolveSourceTaskTarget() {
  if (sourceTargetHandled || !context.query.has('source')) return;

  const key = context.query.get('source');
  const valid = key?.startsWith('managed:') &&
    key.slice('managed:'.length).trim();

  if (!valid) {
   sourceTargetHandled = true;
   patchQuery({source:null});
   notify.warning('无法定位活动', '来源编号为空或格式不正确。');
   return;
  }

  const event = data.events.find(row =>
   !row.sourceSuperseded && config(row).source?.key === key);

  if (!event && (data.sourcesLoading || data.sourceError)) return;

  sourceTargetHandled = true;
  patchQuery({source:null});

  const source = data.sources.find(row => row.key === key);
  if (!event && !source) {
   notify.warning(
    '当前列表未找到对应活动',
    '来源可能已变化，或你暂时没有查看权限。',
   );
   return;
  }

  selected = event ? event._id : source.key;
  sessionDetail = Boolean(event);
  mode = event
   ? event['状态'] === '已归档' ? 'trash' : 'all'
   : 'sources';
  tab = event && event['状态'] !== '已归档' ? 'publish' : 'overview';
  area = 'all';
  category = '';
  search = '';

  modeControl.setValue(mode);
  areaControl.control.value = area;
  categoryControl.control.value = category;
  searchInput.setValue(search);
 }

 let sessionDetail=context.query.get('scope')==='session';
 const expandedProjects=new Set();
 let initialDirectory=true,detailKey='';
 const mobileViewport=window.matchMedia('(max-width:800px)');
 let mobileDetail=context.query.has('event')||context.query.has('source');
 let explorerCollapsed=context.query.get('explorer')==='hidden';
 const scopedRows=(rows,e)=>{const ids=new Set(projectEvents(data.events,e).map(row=>row['活动ID']));return rows.filter(row=>ids.has(row['活动ID']));};

 let data={events:[],registrations:[],ledger:[],sources:[]},selected=context.query.get('event')||'',mode=['all','review','mine','open','sources','trash'].includes(context.query.get('mode'))?context.query.get('mode'):'open',area=['all','nanjing','suzhou'].includes(context.query.get('area'))?context.query.get('area'):'all',tab=['overview','publish','roster','checkins','hours'].includes(context.query.get('tab'))?context.query.get('tab'):'overview',search=context.query.get('q')||'';
 let category=context.query.get('category')||'',directory={administrators:[],participants:[]},directoryError=false;
 let directoryPending=null,directoryLoaded=false;
 let directoryKey='',disposed=false,detailGeneration=0,directorySequence=0;
 const detailReads=new Map();
 function loadDirectory(ownersOnly=false){
  const key=!ownersOnly&&tab==='roster'?selected:'';
  if(directoryKey===key&&directoryLoaded)return Promise.resolve();
  if(directoryKey===key&&directoryPending)return directoryPending;
  const sequence=++directorySequence;
  directoryKey=key;directoryLoaded=false;
  directoryPending=(async()=>{
   try{
    const result=await request(root+'/directory'+(key?'?event='+encodeURIComponent(key):'?owners=true'));
    if(disposed||sequence!==directorySequence)return;
    directory=result;directoryError=Boolean(directory.profileWarning);
   }catch{if(sequence===directorySequence)directoryError=true;}
   finally{if(sequence===directorySequence){directoryLoaded=true;directoryPending=null;}}
   if(!disposed&&sequence===directorySequence&&key&&view?.dataset.ready==='true'&&tab==='roster')renderDetail();
  })();return directoryPending;
 }
 async function loadDetail(event,fresh=false){
  const key=activityProjectKey(event),existing=detailReads.get(key);
  if(existing)return existing;
  const generation=detailGeneration;
  const task=request(`${root}/events/${encodeURIComponent(event._id)}/detail`,{fresh:fresh||detailGeneration>0}).then(payload=>{
   if(disposed||generation!==detailGeneration)return;
   const replacements=new Map(payload.events.map(e=>[e._id,e]));
   data.events=data.events.map(e=>replacements.get(e._id)||e);
   const ids=new Set(payload.events.flatMap(e=>[e['活动ID'],...(config(e).sourceActivityIds||[])]));
   data.registrations=[...data.registrations.filter(r=>!ids.has(r['活动ID'])),...payload.registrations];
   data.ledger=[...data.ledger.filter(r=>!ids.has(r['活动ID'])),...payload.ledger];
  }).catch(error=>{if(detailReads.get(key)===task)detailReads.delete(key);throw error;});
  detailReads.set(key,task);return task;
 }
 let approvalSettings=null,approvalSettingsPending=null,approvalSettingsLoaded=false;
 const approvalConfigButton=button({label:'默认审核人配置',variant:'secondary',onClick:()=>configureActivityApprovers(async()=>{await loadApprovalSettings(true);})});
 approvalConfigButton.hidden=true;
 async function loadApprovalSettings(fresh=false){
  if(fresh)approvalSettingsLoaded=false;
  if(approvalSettingsPending)return approvalSettingsPending;
  if(approvalSettingsLoaded)return;
  approvalSettingsPending=(async()=>{try{approvalSettings=await request(root+'/approval-routing',{fresh});}catch{approvalSettings=null;}finally{approvalConfigButton.hidden=approvalSettings?.canConfigure!==true;approvalSettingsLoaded=true;approvalSettingsPending=null;}})();
  return approvalSettingsPending;
 }
 const countdownTimer=setInterval(()=>{for(const node of detail.querySelectorAll('[data-publish-countdown]')){const left=Math.ceil((Date.parse(node.dataset.publishCountdown)-Date.now())/1000);node.textContent=left>0?`距报名开始 ${Math.ceil(left/60)} 分钟`:'已到报名开始时间';}},1000);
 const workspace=h('div',{class:'activity-workspace'}),list=h('div',{class:'activity-list'}),detail=h('div',{class:'activity-detail'}),summary=h('div',{class:'activity-summary'});let view,refreshSequence=0,sourceSequence=0;
 const directoryCount=h('span',{class:'activity-directory-count','aria-live':'polite'});
 const collapse=button({label:'收起活动列表',size:'sm',onClick:()=>{explorerCollapsed=!explorerCollapsed;syncExplorer();}});
 function syncExplorer(){workspace.classList.toggle('is-service-focused',explorerCollapsed);workspace.classList.toggle('is-mobile-detail',mobileDetail);collapse.textContent=explorerCollapsed?'显示活动列表':'收起活动列表';collapse.setAttribute('aria-expanded',String(!explorerCollapsed));patchQuery({explorer:explorerCollapsed?'hidden':'visible'});}
 const mobileBack=button({label:'返回活动清单',variant:'secondary',onClick:async()=>{
  if(leaving)return;
  leaving=true;const accepted=await confirmLeave();leaving=false;
  if(!accepted)return;
  publicationEditor?.dispose?.();publicationEditor=null;
  mobileDetail=false;syncExplorer();patchQuery({event:null,scope:null});
  requestAnimationFrame(()=>list.querySelector('[aria-pressed="true"]')?.focus());
 }});mobileBack.classList.add('activity-mobile-back');
 const mobileRefresh=button({label:'刷新',variant:'ghost',onClick:async()=>{try{await reload(true);}catch(error){reportError(error,'刷新失败');}}});mobileRefresh.classList.add('activity-mobile-refresh');
 const detailColumn=h('section',{class:'activity-detail-column','aria-label':'活动工作区'},h('div',{class:'activity-workspace-toolbar'},mobileBack,mobileRefresh,collapse,h('span',{class:'t-caption',text:'配置 · 审批 · 参与管理'})),detail);
 function adaptMobileTasks(){
  detail.classList.toggle('is-participant-task',['roster','checkins','hours'].includes(tab));
  const labels={roster:'报名',checkins:'签到',hours:'时长'};
  for(const control of detail.querySelectorAll('[aria-label="活动管理环节"] [data-value]')){
   const original=control.dataset.desktopLabel||control.textContent;
   control.dataset.desktopLabel=original;control.setAttribute('aria-label',original);
   const short=control.dataset.value==='overview'?'信息':labels[control.dataset.value];
   control.textContent=mobileViewport.matches?(short||original):original;
  }
 }
 function viewportChanged(){if(mobileViewport.matches&&hasUnsaved())mobileDetail=true;if(!mobileViewport.matches){filters.open=true;more.open=true;}syncExplorer();adaptMobileTasks();if(!mobileViewport.matches)void renderDetail();}
 mobileViewport.addEventListener('change',viewportChanged);
 function updatePayload(payload){
  let scroller=view.parentElement;
  while(scroller&&!['auto','scroll'].includes(getComputedStyle(scroller).overflowY))scroller=scroller.parentElement;
  scroller ||= document.scrollingElement;
  const top=scroller.scrollTop,left=scroller.scrollLeft,previousMinHeight=view.style.minHeight,previousAnchor=view.style.overflowAnchor;
  const viewportBottom=scroller===document.scrollingElement?window.innerHeight:scroller.getBoundingClientRect().bottom;
  // Reserve space while replacing the connected activity region so scroll cannot clamp.
  view.style.minHeight=`${Math.max(view.getBoundingClientRect().height,viewportBottom-view.getBoundingClientRect().top)}px`;
  view.style.overflowAnchor='none';
  try{
   const output=renderPayload(payload);view.replaceChildren(...output.filter(Boolean));
   scroller.scrollTo({top,left,behavior:'instant'});
   const records=detail.querySelector('.activity-roster-records');
   if(records)records.style.minHeight=`${Math.max(0,viewportBottom-records.getBoundingClientRect().top)}px`;
  }finally{
   view.style.minHeight=previousMinHeight;
   scroller.scrollTo({top,left,behavior:'instant'});
   view.style.overflowAnchor=previousAnchor;
  }
 }
 async function reload(full=false){
  const sequence=++refreshSequence;
  view.setAttribute('aria-busy','true');
  try{
   const payload=await loadAll(true);
   if(sequence!==refreshSequence)return;
   detailGeneration++;detailReads.clear();directorySequence++;directoryPending=null;directoryLoaded=false;
   updatePayload(payload);
   await renderDetail();
   if(full)shell?.refreshTodos?.();
  }catch(error){if(error.status===401&&sequence===refreshSequence){clear(view);view.append(notice('登录已失效，请重新登录。',{tone:'warning'}));}throw error;}finally{if(sequence===refreshSequence)view.removeAttribute('aria-busy');}
 }
 async function refreshAfterWrite(){
  try{await reload();return true;}catch(error){notify.warning('操作已保存，记录刷新失败','请点击刷新重新获取记录，无需重复提交。');if(error.status===401)reportError(error,'登录已失效');return false;}
 }
 async function mutate(path,body={},method='POST',acknowledge){await request(root+path,{method,body});acknowledge?.();if(await refreshAfterWrite())notify.success(path.endsWith('/notice')?'通知已保存为草稿，请重新提交审批':'已完成');}
 function action(label,path,body={},primary=false){let b;b=button({label,variant:primary?'primary':'secondary',size:'sm',onClick:async()=>{try{await runWithLoading(b,()=>mutate(path,body));}catch(error){reportError(error,'操作未完成');}}});return b;}

 function reasonAction(label,path){
  const reason=field({
   label:'处理说明',
   required:true,
   multiline:true,
   rows:3,
   maxlength:500,
  });
  let submitting=false;
  let drawer,draftProtection,b;
  b=button({
   label:'确认处理',
   variant:'primary',
   onClick:async()=>{
    if(submitting||!reason.control.reportValidity())return;
    submitting=true;
    try{
     await runWithLoading(b,()=>mutate(path,{
      reason:reason.control.value,
     }));
     draftProtection.release();
     drawer.close();
    }catch(error){
     reportError(error,'处理未完成');
    }finally{
     submitting=false;
    }
   },
  });
  drawer=openDrawer({
   title:label,
   description:'处理说明将显示在参与者的报名记录中。',
   body:[reason],
   footer:[b],
  });
  draftProtection=protectDrawerDraft(drawer,{
   isBusy:()=>submitting,
  });
 }

 function editNoticeDrawer(e){
  const text=field({
   label:'报名通知',
   value:e['通知草稿'],
   multiline:true,
   rows:8,
   required:true,
   maxlength:5000,
  });
  let submitting=false;
  let drawer,draftProtection;
  const save=button({
   label:'保存通知',
   variant:'primary',
   onClick:async()=>{
    if(submitting||!text.control.reportValidity())return;
    submitting=true;
    try{
     await runWithLoading(save,()=>mutate(
      `/events/${e._id}/notice`,
      {text:text.control.value},
      'PATCH',
     ));
     draftProtection.release();
     drawer.close();
    }catch(error){
     reportError(error,'通知未保存');
    }finally{
     submitting=false;
    }
   },
  });
  drawer=openDrawer({
   title:'编辑报名通知',
   description:'保存后需重新提交审批，确保发布内容得到审核。',
   body:[text],
   footer:[save],
  });
  draftProtection=protectDrawerDraft(drawer,{
   isBusy:()=>submitting,
  });
 }
 async function createDrawer({event=null,source=null,copy=null,draftSeed=null}={}){
  if(draftSeed&&(activityDisposed||window.location.pathname!==context.path))return;
  const directoryReady=loadDirectory(true),approvalReady=loadApprovalSettings();
  const basis=event||copy,old=basis?config(basis):{},chosen=old.blood?'blood_vehicle':old.templateId||'general',fields=[];
  const coOwners=new Set(old.coOwners||[]),reviewerIds=new Set(old.reviewerIds||old.approval?.reviewerIds||[]);
  const seed=basis?{...old,center:basis['组织类别']&&basis['组织类别']!=='未分类'?basis['组织类别']:old.center,region:basis['活动地区']==='苏州地区'?'苏州活动':basis['活动地区']==='南京地区'?'南京活动':old.region,name:basis['活动名称'],category:basis['活动类别'],date:basis['报名日期'],slot:basis['报名时段'],position:basis['岗位'],capacity:basis['容量'],serviceHours:basis['服务时长'],trainingHours:basis['培训时长'],travelHours:basis['交通时长'],location:basis['地点'],work:basis['工作内容'],week:old.blood?.week}:source||draftSeed||{};
  const body=h('div',{class:'activity-create-form'});let drawer,busy=false,savedId=event?._id||'',persisted='',completed=false,hasPersisted=false,uncertain=false,resultMessage='';
  const snapshot=()=>JSON.stringify([fields.map(f=>f.control.value),[...coOwners].sort(),[...reviewerIds].sort()]);
  function f(name,label,type='text',extra={}){
   const node=field({name,label,type,required:true,value:seed[name]??(['trainingHours','travelHours'].includes(name)?1:''),...extra});
   node.control.required=extra.required!==false;fields.push(node);return node;
  }
  const region=f('region','地区','text',{value:seed.region||'南京活动',options:[{value:'南京活动',label:'南京地区'},{value:'苏州活动',label:'苏州地区'}]});
  const name=f('name','活动名称','text',{placeholder:'例如：5.31 探索人道法',hint:'建议格式：日期＋活动名称',maxlength:500});
  const bookingMode=f('bookingMode','报名方式','text',{value:old.bookingMode||'unified',options:[{value:'unified',label:'整体活动统一报名'},{value:'grouped',label:'按岗位细分报名'}],disabled:Boolean(old.blood||old.ordinary)});
  const categoryChoices=ACTIVITY_CENTERS.filter(category=>category!=='献血车专项'||Boolean(event&&old.blood));
  const seedCategory=activityKind({center:seed.center});
  const center=f('center','活动类别','text',{required:false,value:categoryChoices.includes(seedCategory)?seedCategory:'',options:[{value:'',label:'请选择活动类别'},...categoryChoices]});
  center.classList.add('activity-category-field');
  const reviewerName=h('strong');
  const reviewer=h('div',{class:'activity-primary-owner activity-approval-recipient','aria-live':'polite'},h('span',{class:'t-caption',text:'审核主席'}),reviewerName);
  const reviewerSection=h('section',{class:'stack-3'},h('h3',{class:'field__label',text:'审核人'}),reviewer);
  let reviewerTouched=Boolean(basis||draftSeed?.reviewerIds),defaultCategory=null;
  const reviewerPicker=peoplePicker({label:'审核人',selected:[...reviewerIds],onChange:ids=>{reviewerTouched=true;reviewerIds.clear();ids.forEach(id=>reviewerIds.add(id));updateSummary();}});
  function updateReviewer(){
   if(approvalSettings?.mode==='organization'){
    if(!reviewerTouched&&defaultCategory!==center.control.value){
     const defaults=approvalSettings.categories.find(item=>item.category===center.control.value)?.reviewerIds||[];
     reviewerIds.clear();defaults.forEach(id=>reviewerIds.add(id));reviewerPicker.setSelected(defaults);defaultCategory=center.control.value;
    }
    reviewerPicker.setPeople(approvalSettings.reviewers||[]);
    reviewerSection.replaceChildren(h('h3',{class:'field__label',text:'审核人'}),reviewerPicker.node);
    return;
   }
   const selected=approvalSettings?.categories.find(item=>item.category===center.control.value);reviewerName.textContent=!approvalSettings?(approvalSettingsPending?'正在加载审核人…':'暂时无法加载，请刷新'):selected?.available?selected.reviewerName:center.control.value?'尚未配置，可先保存草稿':'选择活动类别后自动确定';
  }
  center.control.addEventListener('change',updateReviewer);updateReviewer();void approvalReady.then(()=>{if(!completed)updateReviewer();});
  const primary=event?event['负责人账号ID']:actor;
  const ownerName=event?directory.administrators.find(a=>a.id===primary)?.name||primary:getSessionState().user?.label||actor;
  coOwners.delete(primary);
  const owners=h('section',{class:'activity-owner-fields stack-3'});
  const ownerPicker=peoplePicker({label:'负责人',locked:[primary],selected:[...coOwners],onChange:ids=>{coOwners.clear();ids.filter(id=>id!==primary).forEach(id=>coOwners.add(id));updateSummary();}});
  function showOwners(){
   owners.replaceChildren(h('h3',{class:'field__label',text:'负责人'}),ownerPicker.node);
   if(directoryError)owners.append(notice('负责人目录未完整加载，已选负责人会保留。',{tone:'warning'}),button({label:'重试负责人目录',onClick:async()=>{directoryLoaded=false;await loadDirectory();showOwners();}}));
   ownerPicker.setPeople([{id:primary,name:ownerName},...directory.administrators].filter((person,index,all)=>index===all.findLastIndex(item=>item.id===person.id)));
   updateSummary();
  }
  owners.append(notice('正在加载负责人目录，可先填写活动信息。',{tone:'neutral'}));
  void directoryReady.then(()=>{if(!completed)showOwners();});
  const information=panel({title:'活动信息',body:h('div',{class:'stack-4'},region,name,center,bookingMode,reviewerSection,owners)});
  const date=localizeActivityDate(f('date','活动日期','date'));
  const oldTimes=String(seed.slot||'').match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  const startTime=seed.startTime||old.blood?.start?.slice(11,16)||oldTimes?.[1]||'';
  const endTime=seed.endTime||old.blood?.end?.slice(11,16)||oldTimes?.[2]||'';
  const timeOptions=[{value:'',label:'请选择'},...HALF_HOURS];
  const start=f('startTime','开始时间','text',{value:startTime,options:timeOptions,disabled:Boolean(old.blood)});
  const end=f('endTime','结束时间','text',{value:endTime,options:timeOptions,disabled:Boolean(old.blood)});
  const durationHint=h('p',{class:'field__hint',text:'选择开始与结束时间，支持整点、半点。','aria-live':'polite'});
  const period=h('fieldset',{class:'activity-time-field'},h('legend',{class:'field__label',text:'时段'}),h('div',{class:'activity-time-range'},start,h('span',{class:'activity-time-divider',text:'至','aria-hidden':'true'}),end),durationHint);
  const location=f('location','活动地点','text',{placeholder:'请输入活动地点',hint:'填写示例：校内：仙林校区……；校外：南京市……',maxlength:500});
  location.classList.add('activity-location-field');
  const modernWindow=!old.blood&&!old.ordinary;
  const windowStart=f('windowStart','活动开始时间','datetime-local',{required:modernWindow,value:old.window?.start?.slice(0,19)||(seed.date&&startTime?`${seed.date}T${startTime}:00`:''),step:1});
  const windowEnd=f('windowEnd','活动结束时间','datetime-local',{required:modernWindow,value:old.window?.end?.slice(0,19)||(seed.date&&endTime?`${seed.date}T${endTime}:00`:''),step:1});
  if(modernWindow){enhanceDateTimeField(windowStart);enhanceDateTimeField(windowEnd);}
  for(const node of modernWindow?[date,start,end]:[windowStart,windowEnd]){node.control.required=false;node.control.disabled=true;}
  const rangeHint=h('p',{class:'field__hint','aria-live':'polite',text:'北京时间；支持跨日活动，精确到秒。'});
  const range=h('fieldset',{class:'activity-time-field'},h('legend',{class:'field__label',text:'活动时间范围'}),h('div',{class:'activity-formgrid'},windowStart,windowEnd),rangeHint);
  const capacity=f('capacity','推荐录取名额','number',{min:1,step:1,value:seed.capacity||20,hint:'用于名单录取参考，不代表自动录取。'});
  const limit=f('registrationLimit','上限名额','number',{min:1,step:1,value:seed.registrationLimit||seed.capacity||30,hint:'报名人数上限不得低于推荐录取名额；项目活动仍遵循原有容量规则。'});
  const content=f('content','活动内容','text',{value:seed.content||seed.work||'',multiline:true,rows:3,maxlength:500});
  const arrangements=panel({title:'活动安排',body:h('div',{class:'stack-4'},modernWindow?range:h('div',{class:'stack-3'},date,period),location,h('div',{class:'activity-formgrid'},capacity,limit),content)});
  const training=f('trainingHours','培训时长（小时）','number',{min:0,step:'any'});
  const travel=f('travelHours','交通时长（小时）','number',{min:0,step:'any'});
  const service=f('serviceHours','服务时长（小时）','number',{min:0.01,step:'any',hint:modernWindow?'填写每位志愿者的服务时长，不自动按活动跨度计时。':'根据活动时段自动计算。'});service.control.readOnly=!modernWindow;
  const work=f('work','工作内容','text',{multiline:true,rows:3,maxlength:500});
  const hours=panel({title:'时长分配',body:h('div',{class:'stack-4'},h('div',{class:'activity-hours-grid'},training,travel,service),work)});
  function updateDuration(){
   const duration=serviceDuration(start.control.value,end.control.value);
   end.control.setCustomValidity(start.control.value&&end.control.value&&!duration?'请选择整点或半点，且结束时间须晚于开始时间':'');
   service.control.value=duration??'';
   durationHint.textContent=duration?'共 '+duration+' 小时，已同步至服务时长。':'选择开始与结束时间，支持整点、半点。';
  }
  for(const node of [start,end])node.control.addEventListener('change',updateDuration);
  if(!modernWindow){if(startTime&&endTime)updateDuration();else service.control.value='';}
  function updateWindow(){const w=activityWindow(windowStart.control.value,windowEnd.control.value);windowEnd.control.setCustomValidity(windowStart.control.value&&windowEnd.control.value&&!w?'结束时间须晚于开始时间':'');rangeHint.textContent=w?`${w.start.slice(0,19).replace('T',' ')} — ${w.end.slice(0,19).replace('T',' ')}（北京时间）`:'北京时间；支持跨日活动，精确到秒。';}
  for(const node of [windowStart,windowEnd])node.control.addEventListener('input',updateWindow);
  const status=h('p',{class:'form-workspace-status',role:'status','aria-live':'polite'});
  const summary=h('aside',{class:'form-workspace-summary activity-preview','aria-label':'活动预览'});
  const sections=[information,arrangements,hours];
  const sectionNames=['活动信息','活动安排','时长分配'];
  const nav=h('nav',{class:'form-workspace-nav','aria-label':'活动表单分节'});
  function activateSection(index){[...nav.children].forEach((item,i)=>{if(i===index)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');});}
  sections.forEach((section,i)=>{
   section.id=`activity-form-section-${i}`;section.tabIndex=-1;
   section.classList.add('activity-form-section');
   section.querySelector('.panel__head').prepend(h('span',{class:'activity-section-index','aria-hidden':'true',text:`0${i+1}`}));
   nav.append(button({label:`${i+1}. ${sectionNames[i]}`,variant:'ghost',onClick:()=>{section.scrollIntoView({block:'start',behavior:'instant'});section.focus({preventScroll:true});activateSection(i);}}));
  });
  activateSection(0);
  body.append(nav,h('div',{class:'form-workspace-layout'},h('div',{class:'form-workspace-fields'},...sections),summary));
  function updateSummary(){
   const missing=fields.filter(f=>!f.control.disabled&&!f.control.validity.valid).map(f=>f.querySelector('label')?.textContent||f.control.name);
   status.textContent=busy?'正在保存，请稍候':resultMessage|| (snapshot()!==persisted?'有未保存的修改':hasPersisted?'当前配置已保存为草稿':'尚未保存');
   const schedule=modernWindow?[['开始',windowStart.control.value.replace('T',' ')||'选择开始时间'],['结束',windowEnd.control.value.replace('T',' ')||'选择结束时间']]:[['日期',date.control.value||'选择活动日期'],['时段',start.control.value&&end.control.value?`${start.control.value}–${end.control.value}`:'选择活动时段']];
   const previewPeople=[primary,...coOwners].map(id=>directory.administrators.find(person=>person.id===id)?.name||(id===primary?ownerName:'已选负责人'));
   summary.replaceChildren(
    h('div',{class:'activity-preview__heading'},h('h3',{text:'活动预览'}),h('span',{class:'t-caption',text:'实时更新'})),
    h('article',{class:'activity-preview__paper'},
     h('div',{class:'activity-preview__meta'},badge(center.control.value||'待选类别',{tone:'accent'}),h('span',{text:region.control.value==='苏州活动'?'苏州地区':'南京地区'})),
     h('h4',{class:'activity-preview__title',text:name.control.value||'填写活动名称'}),
     h('p',{class:'activity-preview__mode',text:bookingMode.control.value==='grouped'?'按岗位细分报名':'整体活动统一报名'}),
     h('dl',{class:'activity-preview__schedule'},...schedule.flatMap(([label,value])=>[h('dt',{text:label}),h('dd',{text:value})]),h('dt',{text:'地点'}),h('dd',{text:location.control.value||'填写活动地点'})),
     h('p',{class:'activity-preview__description',text:content.control.value||'活动介绍将显示在这里。'}),
     h('div',{class:'activity-preview__metrics'},...[[capacity.control.value||'—','推荐录取 / 人'],[limit.control.value||'—','报名上限 / 人'],[service.control.value||'—','服务时长 / 小时']].map(([value,label])=>h('div',{},h('strong',{text:value}),h('span',{text:label})))),
     h('p',{class:'activity-preview__hours',text:`培训 ${training.control.value||'—'} 小时 · 交通 ${travel.control.value||'—'} 小时`}),
     h('div',{class:'activity-preview__people'},h('span',{class:'field__label',text:'负责人'}),h('div',{},...previewPeople.map(text=>h('span',{text})))),
     work.control.value?h('div',{class:'activity-preview__work'},h('span',{class:'field__label',text:'工作内容'}),h('p',{text:work.control.value})):null),
    h('p',{class:'activity-preview__state',text:missing.length?`还有 ${missing.length} 项必填内容待完善`:'必填内容已完善'}),
    h('p',{class:'field__hint',text:event?'保存后需重新审批。':'预览尚未发布，提交后进入审批。'}));
  }
  persisted=snapshot();const changed=()=>{if(!uncertain)resultMessage='';updateSummary();};body.addEventListener('input',changed);body.addEventListener('change',changed);
  const leavePage=e=>{if(!completed&&(busy||snapshot()!==persisted)){e.preventDefault();e.returnValue='';}};
  window.addEventListener('beforeunload',leavePage);
  async function beforeClose(){
   if(busy){notify.warning('正在保存，请等待结果');return false;}
   return completed||snapshot()===persisted||await confirmAction({title:'放弃未保存的修改？',description:'当前输入尚未保存，退出后将丢失这些修改。',confirmLabel:'放弃修改'});
  }
  async function save(wantsSubmit,control,editNotice=false){
   if(busy||uncertain||fields.some(f=>!f.control.disabled&&!f.control.reportValidity()))return;
   const payload=Object.fromEntries(fields.map(f=>[f.control.name,f.control.value]));
   if(approvalSettings?.mode==='organization'){
    if(wantsSubmit&&!reviewerIds.size){notify.warning('请选择至少一位审核人');return;}
    payload.reviewerIds=[...reviewerIds];
   }
   payload.slot=chosen==='blood_vehicle'?seed.slot:payload.startTime+'-'+payload.endTime;
   payload.category=center.control.value||seed.category||'志愿服务';
   payload.position=old.blood||old.ordinary?seed.position||'':'';
   if(modernWindow){const w=activityWindow(payload.windowStart,payload.windowEnd);if(!w){notify.warning('请选择有效的活动起止时间');return;}payload.window={start:w.start,end:w.end};delete payload.startTime;delete payload.endTime;}
   else delete payload.bookingMode;
   delete payload.windowStart;delete payload.windowEnd;
   if(chosen==='blood_vehicle'){payload.week=seed.week;delete payload.startTime;delete payload.endTime;}
   Object.assign(payload,{team:old.team,templateId:chosen,submit:false,coOwners:[...coOwners],benefits:old.benefits,requirements:old.requirements,publishAt:old.publishAt});
   let savedRows=[];
   busy=true;draft.disabled=true;continueNotice.disabled=true;submit.disabled=true;body.inert=true;updateSummary();
   try{
    await runWithLoading(control,async()=>{
     if(!hasPersisted||snapshot()!==persisted){
      if(savedId)await request(`${root}/events/${savedId}`,{method:'PATCH',body:payload});
      else{const response=source?await request(`${root}/adopt`,{method:'POST',body:{key:source.key,config:payload}}):await request(`${root}/events`,{method:'POST',body:payload});savedId=response.result._id;savedRows=[response.result];}
      persisted=snapshot();hasPersisted=true;
     }
     selected=savedId;
     mobileDetail=true;
     if(wantsSubmit)await request(`${root}/events/${savedId}/submit`,{method:'POST',body:{}});
    });
    completed=true;busy=false;await drawer.close();tab=editNotice?'publish':'overview';sessionDetail=false;mode='all';search='';category='';searchInput.setValue('');categoryControl.control.value='';area='all';areaControl.control.value='all';modeControl.setValue(mode);
    if(savedRows.length&&!wantsSubmit){const byId=new Map(data.events.map(row=>[row._id,row]));for(const row of savedRows)byId.set(row._id,row);updatePayload({...data,events:[...byId.values()]});}
    notify.success(wantsSubmit?'已提交审批，等待审核':'草稿已保存，尚未发布');void refreshAfterWrite();
   }catch(error){
    if(!error.status||error.status>=500){uncertain=true;resultMessage='暂时无法确认保存结果，请退出后刷新活动列表核实，勿重复创建。';notify.warning('保存结果待核实',resultMessage);}
    else if(hasPersisted&&snapshot()===persisted){resultMessage='草稿已保存 · 审批提交未完成，可重试提交审批';}
    else reportError(error,'保存未完成，输入已保留');
   }finally{busy=false;body.inert=false;draft.disabled=uncertain;continueNotice.disabled=uncertain;submit.disabled=uncertain;updateSummary();}
  }
  let draft,submit,continueNotice;continueNotice=button({label:'保存并编辑通知',variant:'primary',onClick:()=>save(false,continueNotice,true)});draft=button({label:'保存草稿',variant:'secondary',onClick:()=>save(false,draft)});submit=button({label:'提交审批',variant:'secondary',onClick:()=>save(true,submit)});
  drawer=openDrawer({title:event?'编辑活动':source?'完善源表活动':copy?'复制为新活动':'新建活动',eyebrow:'活动管理 · 配置工作区',width:1120,workspace:true,body,beforeClose,onClose:()=>{window.removeEventListener('beforeunload',leavePage);windowStart.disposeDateTimePicker?.();windowEnd.disposeDateTimePicker?.();completed=true;},footer:[status,button({label:'退出编辑',variant:'ghost',onClick:()=>drawer.close()}),draft,continueNotice,submit]});
  body.closest('.drawer__body').addEventListener('scroll',()=>{
   const boundary=nav.getBoundingClientRect().bottom+80;
   let active=0;sections.forEach((section,i)=>{if(section.getBoundingClientRect().top<=boundary)active=i;});activateSection(active);
  },{passive:true});
  updateWindow();
  updateSummary();
 }
 async function editOwners(event){
  try{
   const [current]=await Promise.all([request(`${root}/events/${encodeURIComponent(event._id)}/owners`),loadDirectory(true)]);
   if(directoryError)throw new Error('负责人目录暂时无法加载，请稍后再试');
   let selected=[...current.coOwners],busy=false,saved=false,drawer;
   const primary=field({label:'第一负责人',value:current.primary,options:[...(!directory.administrators.some(a=>a.id===current.primary)?[{value:current.primary,label:'原负责人（请核对目录）'}]:[]),...directory.administrators.map(a=>({value:a.id,label:`${a.name} — ${a.studentId||''}`}))]});
   const unchanged=()=>primary.control.value===current.primary&&JSON.stringify([...selected].sort())===JSON.stringify([...current.coOwners].sort());
   const picker=peoplePicker({label:'负责人',selected,people:directory.administrators.filter(a=>a.id!==current.primary),onChange:ids=>{selected=ids;}});
   picker.setPeople(directory.administrators.filter(a=>a.id!==current.primary));
   const save=button({label:'保存负责人',variant:'primary',onClick:async()=>{
    if(busy)return;busy=true;
    try{await runWithLoading(save,()=>request(`${root}/events/${encodeURIComponent(event._id)}/owners`,{method:'PATCH',body:{primary:primary.control.value,coOwners:selected.filter(id=>id!==primary.control.value),token:current.token}}));saved=true;busy=false;await drawer.close();notify.success('负责人已更新');void refreshAfterWrite();}
    catch(error){reportError(error,error.status===409?'活动已更新，请关闭后重新打开':'负责人保存失败，选择已保留');}
    finally{busy=false;}
   }});
   drawer=openDrawer({title:'活动负责人',description:event['活动名称'],width:560,body:h('div',{class:'stack-4'},primary,picker.node),beforeClose:async()=>!busy&&(saved||unchanged()||await confirmAction({title:'放弃负责人修改？',confirmLabel:'放弃修改'})),footer:[button({label:'取消',onClick:()=>drawer.close()}),save]});
  }catch(error){reportError(error,'无法打开负责人设置');}
 }
 async function archive(e){const yes=await confirmAction({title:'将活动移到回收站？',description:'可从回收站恢复。已有参与记录的活动不能删除，请使用结束活动。',confirmLabel:'移到回收站'});if(yes)try{await mutate(`/events/${e._id}/archive`);}catch(error){reportError(error,'删除未完成');}}
 async function refreshRecords(event){
  if(!data.lazyDetails)return refreshAfterWrite();
  try{
   detailReads.delete(activityProjectKey(event));
   await loadDetail(event,true);
   if(selected===event._id||selected===event['活动ID'])await renderDetail();
   return true;
  }catch(error){notify.warning('操作已保存，当前记录刷新失败','请刷新核对，无需重复提交。');if(error.status===401)reportError(error,'登录已失效');return false;}
 }
 function legacyRosterState(e){
  const key=`legacy-roster:${activityProjectKey(e)}`;
  if(!serviceStates.has(key))serviceStates.set(key,{search:'',date:'',position:'',session:'',status:'',selected:new Set()});
  return serviceStates.get(key);
 }
 function legacyRosterContext(r){
  const session=data.events.find(event=>event['活动ID']===r['活动ID']);
  return {date:r['报名日期']||session?.['报名日期']||'',position:r['岗位']||session?.['岗位']||'',session:r['活动ID']||'',slot:r['报名时段']||session?.['报名时段']||'',location:r['地点']||session?.['地点']||''};
 }
 function matchesLegacyRoster(r,state){
  const context=legacyRosterContext(r),query=state.search.trim().toLowerCase();
  return (!query||`${r['姓名']||''} ${r['学号']||''}`.toLowerCase().includes(query))&&(!state.date||state.date===context.date)&&(!state.position||state.position===context.position)&&(!state.session||state.session===context.session)&&(!state.status||(state.status==='leave'?r['请假状态']==='待审批':state.status===r['报名状态']));
 }
 function canApproveLegacy(r){return r['报名状态']==='待筛选'&&r['请假状态']!=='待审批';}
 function showRecords(e,kind,viewState){if(kind==='roster'&&!config(e).ordinary&&!config(e).blood)return rosterPanel(e,scopedRows(data.registrations,e),{refresh:()=>refreshRecords(e),directory:directory.participants,directoryError,viewState});const regs=scopedRows(data.registrations,e);const hours=scopedRows(data.ledger,e);
  if(['checkins','hours'].includes(kind)){
   const key=`${e._id}:${kind}`;if(!serviceStates.has(key))serviceStates.set(key,{expanded:true});
   syncExplorer();
   serviceIdentity={selected,tab,sessionDetail};
   return serviceWorkspace({event:e,events:projectEvents(data.events,e),registrations:regs,ledger:hours,kind,actor,superAdmin,state:serviceStates.get(key),onNavigate:value=>{tab=value;renderDetail();focusService();},onSaved:()=>{if(kind==='hours'){detailReads.delete(activityProjectKey(e));return true;}return refreshRecords(e);}});
  }
  const state=legacyRosterState(e),cards=h('div',{class:'activity-records'}),countNode=h('span',{role:'status','aria-live':'polite'});
  const visibleRows=()=>regs.filter(r=>matchesLegacyRoster(r,state));
  const selectVisible=button({label:'全选当前可处理报名',size:'sm',onClick:()=>{state.selected.clear();for(const r of visibleRows().filter(canApproveLegacy))state.selected.add(r._id);renderRows();}});
  const deselect=button({label:'取消选择',size:'sm',variant:'ghost',onClick:()=>{state.selected.clear();renderRows();}});
  const approve=button({label:'批量批准并通知',variant:'primary',size:'sm',onClick:()=>batchRecords(e)});
  function renderRows(){
   const rows=visibleRows(),eligible=rows.filter(canApproveLegacy),ids=new Set(eligible.map(r=>r._id));
   for(const id of state.selected)if(!ids.has(id))state.selected.delete(id);
   countNode.textContent=`显示 ${rows.length} / ${regs.length} 条 · 可处理 ${eligible.length} 条 · 已选 ${state.selected.size} 条`;
   selectVisible.disabled=batchConfirming||!eligible.length;approve.disabled=deselect.disabled=batchConfirming||!state.selected.size;
   cards.replaceChildren(...rows.map(r=>{
    const context=legacyRosterContext(r);
    return h('article',{class:'activity-person',data:{registrationId:r._id}},canApproveLegacy(r)?h('input',{type:'checkbox',checked:state.selected.has(r._id),disabled:batchConfirming,'aria-label':`选择${r['姓名']}`,on:{change:ev=>{if(ev.target.checked)state.selected.add(r._id);else state.selected.delete(r._id);countNode.textContent=`显示 ${rows.length} / ${regs.length} 条 · 可处理 ${eligible.length} 条 · 已选 ${state.selected.size} 条`;approve.disabled=deselect.disabled=!state.selected.size;}}}):null,
     h('div',{class:'row-between row-wrap'},h('strong',{text:r['姓名']}),badge(r['报名状态']==='待筛选'?'待审批':result(r),{tone:['已确认','已签到'].includes(r['报名状态'])?'success':'warning'})),
     h('p',{class:'t-caption',text:r['学号']||''}),h('p',{class:'t-caption',text:`${context.date} ${context.slot} · ${context.location} · ${context.position||'不限岗位'}`}),
     r['处理说明']?h('p',{class:'t-caption',text:r['处理说明']}):null,
     h('div',{class:'row-2 row-wrap'},button({label:'更多资料',size:'sm',onClick:()=>{const p=registrationParticipant(r,directory.participants.find(p=>p.accountId===r['账号ID'])||{});openDrawer({title:`志愿者资料 · ${r['姓名']}`,body:[definitionList([['姓名',r['姓名']],['学号',r['学号']],['邮箱',r['邮箱']||p.email||'未提供'],['校区',p.campus||'未提供'],['院系',p.department||'未提供'],['年级',p.grade||'未提供'],['性别',p.gender||'未提供'],['电话',p.phone||'未提供'],['QQ',p.qq||'未提供'],['急救证',p.certificate||'未知'],['活动类别',r['活动类型']?r['活动类别']||'未分类':'未分类'],['地区',r['地区']||'未提供'],['备注',r['备注']||'无'],['备注2',r['备注2']||'无'],['注意事项',r['注意事项']||'无'],['资料来源',r['资料来源']||'历史报名资料'],['关联状态',r['关联状态']||'待完善']])]});}}),
      canApproveLegacy(r)?action('批准录取并通知',`/registrations/${r._id}/confirm`,{},true):null,
      canApproveLegacy(r)?button({label:'拒绝录取并通知',size:'sm',onClick:()=>reasonAction('拒绝录取并通知',`/registrations/${r._id}/reject`)}):null,
      r['请假状态']==='待审批'?h('div',{class:'stack-3'},notice(`请假：${r['请假原因']}`,{tone:'warning'}),h('div',{class:'row-2 row-wrap'},button({label:'批准请假',size:'sm',onClick:()=>reasonAction('批准请假',`/registrations/${r._id}/leave-approve`)}),button({label:'驳回请假',size:'sm',onClick:()=>reasonAction('驳回请假',`/registrations/${r._id}/leave-reject`)}))):r['请假状态']?badge(`请假${r['请假状态']}`):null));
   }));
   if(!rows.length)cards.append(emptyState({title:regs.length?'没有符合筛选条件的报名':'暂无报名记录',description:regs.length?'请调整或清除筛选条件。':'审批并发布活动后，报名记录会显示在这里。'}));
  }
  const contexts=regs.map(legacyRosterContext);
  const values=key=>[...new Set(contexts.map(c=>c[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN')).map(value=>({value,label:value}));
  const makeFilter=(key,label,options)=>field({label,value:state[key],options:[{value:'',label:`全部${label}`},...options],onInput:event=>{state[key]=event.target.value;renderRows();}});
  const search=field({label:'查找志愿者',type:'search',value:state.search,placeholder:'姓名或学号',onInput:event=>{state.search=event.target.value;renderRows();}});
  const date=makeFilter('date','报名日期',values('date')),position=makeFilter('position','报名岗位',values('position'));
  const session=makeFilter('session','报名班次',[...new Map(contexts.map(c=>[c.session,{value:c.session,label:`${c.date} ${c.slot} ${c.location} ${c.position}`}])).values()]);
  const status=makeFilter('status','报名状态',[...new Set(regs.map(r=>r['报名状态']).filter(Boolean))].map(value=>({value,label:value==='待筛选'?'待审批':value})).concat({value:'leave',label:'请假待审批'}));
  const reset=button({label:'清除报名筛选',variant:'ghost',onClick:()=>{for(const key of ['search','date','position','session','status'])state[key]='';for(const control of [search,date,position,session,status])control.control.value='';renderRows();search.control.focus();}});
  const resultPanel=panel({title:'报名与请假',description:'报名提交后待审批；批准或拒绝录取后立即发送结果通知，无需再次最终确认。邮件是否送达以发送结果为准。请假批准后释放名额。',body:h('div',{class:'stack-4 activity-legacy-roster'},h('div',{class:'activity-roster-filters'},search,date,position,session,status,reset),h('div',{class:'row-2 row-wrap'},countNode,selectVisible,deselect,approve),cards)});
  renderRows();return resultPanel;
 }

 async function batchRecords(e) {
  if (batchConfirming) {
   notify.info('批量确认正在进行，请等待结果');
   return;
  }

  const state=legacyRosterState(e);
  const selectedRows = scopedRows(data.registrations,e).filter(r =>
   canApproveLegacy(r) && matchesLegacyRoster(r,state) && state.selected.has(r._id)
  );

  if (!selectedRows.length) {
   notify.warning('请先选择待确认的报名记录');
   return;
  }

  const selected = selectedRows.map(r => ({
   id: r._id,
   name: r['姓名'] || r._id,
  }));

  batchConfirming = true;
  try {
   let response = null;

   try {
    response = await request(root + '/registrations/batch', {
     method: 'POST',
     body: {
      ids: selected.map(item => item.id),
      action: 'confirm',
     },
    });
   } catch {
    // A lost response cannot establish which writes completed.
   }

   const summary = summarizeBatchResult(selected, response);

   for (const item of summary.items) {
    if (item.status === 'succeeded') {
     state.selected.delete(item.id);
    }
   }

   const refreshed = await refreshAfterWrite();
   let resultDrawer;

   resultDrawer = openDrawer({
    title: '批量确认结果',
    description: e['活动名称'] || '活动报名确认',
    width: 640,
    body: [
     notice('批准成功后立即触发结果邮件，无需再次确认名单。处理成功不等于邮件已送达。',{tone:'neutral'}),
     definitionList([
      ['本次提交', `${summary.items.length} 条`],
      ['已成功', `${summary.succeeded} 条`],
      ['未完成', `${summary.failed} 条`],
      ['待核对', `${summary.unknown} 条`],
     ]),
     !refreshed
      ? notice('名单刷新失败，请重新刷新核对，无需重复提交已成功记录。', {
         tone: 'warning',
        })
      : null,
     summary.unknown
      ? notice('部分结果不明确，请先核对最新报名状态，再决定是否重试。', {
         tone: 'warning',
        })
      : null,
     h('div', { class: 'stack-4' },
      ...summary.items.map(item =>
       panel({
        title: item.name,
        body: h('div', { class: 'stack-3' },
         badge(
          item.status === 'succeeded'
           ? '已成功'
           : item.status === 'failed' ? '未完成' : '待核对',
          {
           tone: item.status === 'succeeded' ? 'success' : 'warning',
          },
         ),
         h('p', { class: 't-secondary', text: item.message }),
        ),
       }),
      ),
     ),
    ].filter(Boolean),
    footer: [
     button({
      label: '完成',
      variant: 'primary',
      onClick: () => resultDrawer.close(),
     }),
    ],
   });
  } catch (error) {
   reportError(error, '批量结果展示未完成，请刷新名单核对');
  } finally {
   batchConfirming = false;
   await renderDetail();
  }

 }
 function focusService(){requestAnimationFrame(()=>detail.querySelector('.service-workspace')?.focusWorkspace());}
 /** 环节导航只显示当前阶段真正存在的页面，避免「已结束」还能点进签到录入。 */
 function stageTabItems(e,ledger){
  const stage=activityStage(e,{ledger});
  const items=[{value:'overview',label:stage==='approval'||stage==='ready'?'审批与通知':'活动信息'}];
  if(['ready','registering'].includes(stage))items.push({value:'publish',label:'报名通知'});
  if(['registering','running','hours','ended'].includes(stage))items.push({value:'roster',label:'志愿者报名'});
  if(['running','hours'].includes(stage))items.push({value:'checkins',label:'志愿者签到'});
  if(['hours','ended'].includes(stage))items.push({value:'hours',label:'时长审核'});
  return items;
 }
 function workflowTabs(e,ledger){
  const items=stageTabItems(e,ledger);
  const value=items.some(item=>item.value===tab)?tab:'overview';
  return segmented({items,value,ariaLabel:'活动管理环节',onChange:next=>{tab=next;renderDetail();}});
 }
 function closeControl(e,project=false){
  const rows=project?projectEvents(data.events,e):[e];
  if(config(e).source?.kind==='generated_blood'||!rows.some(row=>['报名中','停点'].includes(row['状态'])))return null;
  const label=project?'截止整个活动报名':'报名截止';
  const control=button({label,variant:'primary',onClick:()=>runWithLoading(control,async()=>{
   if(!await confirmAction({title:label+'？',description:project?`截止后本活动全部 ${rows.filter(row=>!config(row).positionPlan).length} 个班次不再接受新报名；现场签到与时长录入继续进行。`:'截止后不再接受新报名；现场签到与时长录入继续进行，完成后再结束活动。',confirmLabel:'报名截止'}))return;
   try{await mutate(`/events/${encodeURIComponent(e._id)}/close`,{scope:project?'project':'event'});}catch(error){reportError(error,'报名截止未完成，请刷新核对状态');}
  })});control.classList.add('activity-close-action');return control;
 }
 function finishControl(e,project=false){
  const rows=project?projectEvents(data.events,e):[e];
  if(config(e).source?.kind==='generated_blood'||!rows.some(row=>['进行中','停点'].includes(row['状态'])))return null;
  const label=project?'结束整个活动':'结束活动';
  const control=button({label,variant:'secondary',onClick:()=>runWithLoading(control,async()=>{
   if(!await confirmAction({title:label+'？',description:'结束后活动转为只读：保留报名、签到与时长记录，可继续查看与导出，不再接受新的签到录入。',confirmLabel:'结束活动'}))return;
   try{await mutate(`/events/${encodeURIComponent(e._id)}/finish`);}catch(error){reportError(error,'结束未完成，请刷新核对状态');}
  })});control.classList.add('activity-finish-action');return control;
 }
 function renderProject(e,viewState,cutoffState){
  const projectRows=projectEvents(data.events,e),parent=projectRows.find(row=>config(row).bookingMode==='grouped');
  const sessions=projectRows.filter(row=>config(row).bookingMode!=='grouped'),regs=scopedRows(data.registrations,e);
  if(parent)detail.append(button({label:'查看项目审批与发布',onClick:()=>{selected=parent._id;sessionDetail=true;tab='overview';renderDetail();}}));
  const dates=[...new Set(sessions.map(row=>row['报名日期']))].sort();
  const pending=sessions.some(row=>config(row).ordinary?.hoursPending);
  detail.append(h('header',{class:'activity-detail-head stack-4'},
   h('div',{class:'row-between row-wrap'},badge('活动项目',{tone:'accent'}),badge(publicationReadiness(e,config(e)).label,{tone:publicationReadiness(e,config(e)).scheduled?'warning':e['状态']==='报名中'?'success':'neutral'})),
   h('h2',{class:'t-h2',text:activityProjects(sessions)[0].projectName}),
   h('p',{class:'t-caption',text:`${dates[0]} — ${dates.at(-1)} · ${sessions.length} 个班次 · ${sessions.reduce((sum,row)=>sum+Number(row['容量']||0),0)} 个名额 · ${regs.length} 条报名`}),
   h('p',{class:'activity-project-location',text:[...new Set(sessions.map(row=>row['地点']).filter(Boolean))].join(' / ')}),
   h('div',{class:'activity-project-actions'},parent&&tab!=='publish'?button({label:'发布与通知',variant:'primary',onClick:()=>{tab='publish';renderDetail();}}):null,closeControl(parent||e,true),finishControl(parent||e,true)),workflowTabs(e,scopedRows(data.ledger,e))));
  if(tab==='publish'){publicationIdentity={selected,sessionDetail,eventId:parent?._id};if(parent){publicationEditor=publicationPanel(parent,{config:config(parent),mutate,editable:['草稿','待审核','可发布'].includes(parent['状态'])&&!regs.length});detail.append(publicationEditor);}else detail.append(notice('此项目由源表维护，请在名单确认中管理统一报名设置。',{tone:'neutral'}));return;}
  if(tab==='roster'&&config(e).ordinary){
   const cutoffKey=activityProjectKey(e);
   const cutoff=field({label:'统一报名截止（北京时间）',type:'datetime-local',value:cutoffState?.id===cutoffKey?cutoffState.value:(e.registrationControl?.deadline||'').slice(0,16),required:true});
   cutoff.control.dataset.projectCutoff=cutoffKey;
   const save=enabled=>async()=>{if(!cutoff.control.reportValidity())return;if(!enabled&&!await confirmAction({title:'停止整个项目报名？',description:'全部班次停止接受新报名，已有报名与签到记录保留。',confirmLabel:'停止报名'}))return;try{await mutate(`/events/${encodeURIComponent(e._id)}/registration-settings`,{deadline:`${cutoff.control.value}:00+08:00`,enabled},'PATCH');}catch(error){reportError(error,'报名设置未保存');}};
   detail.append(panel({title:'整个项目的报名设置',description:`影响本项目全部 ${sessions.length} 个班次；不取消已有报名。`,body:h('div',{class:'stack-4'},definitionList([['项目编号',config(e).ordinary.groupId],['报名开关',e.registrationControl?.enabled?'开放':'关闭']]),cutoff,h('div',{class:'row-2 row-wrap'},button({label:'保存截止并开放报名',onClick:save(true)}),button({label:'还原设置',variant:'ghost',onClick:()=>{cutoff.control.value=(e.registrationControl?.deadline||'').slice(0,16);}}),button({label:'立即停止报名',onClick:save(false)})))}));
  }
  if(tab==='hours'&&pending){detail.append(notice('时长规则待确定，暂不录入或导出时长。请先完成活动时长规则核对。',{tone:'neutral'}));return;}
  if(tab==='checkins'&&pending){
   const eligible=regs.filter(r=>r['报名状态']==='已确认'&&r['请假状态']!=='待审批');
   detail.append(h('div',{class:'row-2 row-wrap'},button({label:'选择当前可核验报名（最多100条）',onClick:()=>{selectedRegistrations.clear();for(const r of eligible.filter(matchesPending).slice(0,100))selectedRegistrations.add(r._id);renderDetail();}}),button({label:'批量核验选中签到',variant:'primary',onClick:async()=>{
    const ids=eligible.filter(r=>matchesPending(r)&&selectedRegistrations.has(r._id)).map(r=>r._id);
    if(!ids.length||ids.length>100){notify.warning('请选择1～100条待核验报名');return;}
    if(!await confirmAction({title:`核验 ${ids.length} 条现场签到？`,description:'请确认所选志愿者已实际到场；只记录签到，不录入时长。',confirmLabel:'确认现场签到'}))return;
    try{const out=await request(root+'/registrations/batch',{method:'POST',body:{ids,action:'checkin'}});for(const r of out.results)if(r.ok)selectedRegistrations.delete(r.id);await refreshAfterWrite();const failed=out.results.filter(r=>!r.ok);if(failed.length)notify.warning(`${failed.length} 条未完成`,failed.map(r=>r.message).join('；'));else notify.success(`已核验 ${out.results.length} 条签到`);}catch(error){reportError(error,'批量核验未完成');}
   }})));
   const cards=h('div',{class:'activity-records'});
   const searchKey=`pending-attendance:${activityProjectKey(e)}`;
   if(!serviceStates.has(searchKey))serviceStates.set(searchKey,{});
   const searchState=serviceStates.get(searchKey);
   function matchesPending(r){return `${r['姓名']} ${r['学号']} ${r['报名日期']} ${r['报名时段']}`.toLowerCase().includes((searchState.search||'').trim().toLowerCase());}
   function renderPendingAttendance(){
    const rows=regs.filter(matchesPending);
    cards.replaceChildren(...rows.map(r=>h('article',{class:'activity-person stack-3'},eligible.includes(r)?checkbox({label:'选择'+r['姓名'],checked:selectedRegistrations.has(r._id),onChange:checked=>{if(checked)selectedRegistrations.add(r._id);else selectedRegistrations.delete(r._id);}}):null,h('div',{class:'row-between row-wrap'},h('strong',{text:r['姓名']}),badge(result(r))),h('p',{class:'t-caption',text:r['学号']||''}),h('p',{class:'t-caption',text:`${r['报名日期']} · ${r['报名时段']} · ${sessions.find(s=>s['活动ID']===r['活动ID'])?.['地点']||''}`}),eligible.includes(r)?action('仅核验现场签到',`/registrations/${r._id}/checkin`,{note:'管理员核验现场到场'},true):null)));
    if(!rows.length)cards.append(emptyState({title:regs.length?'未找到这位志愿者':'暂无报名记录'}));
   }
   const find=field({label:'查找签到名单',type:'search',value:searchState.search||'',placeholder:'姓名、学号或时段',onInput:event=>{searchState.search=event.target.value;selectedRegistrations.clear();renderPendingAttendance();}});
   renderPendingAttendance();
   detail.append(panel({title:'项目签到核验',description:'时长规则待确定，暂不录入或导出时长。',body:h('div',{class:'stack-3'},find,cards)}));return;
  }
  if(tab!=='overview'){detail.append(showRecords(e,tab,viewState));return;}
  detail.append(panel({title:'活动基础信息',body:h('div',{class:'stack-4'},definitionList([['活动类别',e['组织类别']||config(e).center||e['活动类别']||'待补充'],['工作内容',e['工作内容']||'未填写'],['报名方式','按岗位或班次报名'],['时长规则',pending?'待确定':'按班次配置核对']]),config(e).blood?notice('班次由 NJUTable 排班表自动更新。已过结束时间的班次自动归入已结束。',{tone:'neutral'}):h('div',{class:'row-2 row-wrap'},button({label:'管理负责人',onClick:()=>editOwners(parent||e)}),parent?button({label:'编辑通知与查看审批',onClick:()=>{selected=parent._id;sessionDetail=true;tab='publish';renderDetail();}}):null))}));
  detail.append(panel({title:'班次安排',description:'项目统一管理报名与时长；选择班次查看具体岗位配置。',body:h('div',{class:'activity-project-sessions'},...sessions.map(s=>{
   const own=regs.filter(r=>r['活动ID']===s['活动ID']);
   return h('article',{class:'activity-person stack-3'},h('div',{class:'row-between row-wrap'},h('strong',{text:`${s['报名日期']} · ${s['报名时段']}`}),badge(s['状态'])),h('p',{text:s['地点']}),h('p',{class:'t-caption',text:`${s['岗位']} · ${own.length} 条报名 / ${s['容量']} 个名额`}),button({label:'查看班次配置',size:'sm',onClick:()=>{selected=s._id;sessionDetail=true;renderList({preserveDetail:true});renderDetail();}}));
  }))}));
 }
 async function renderDetail(){
  if(mobileViewport.matches&&!mobileDetail){syncExplorer();return;}
  if(serviceIdentity&&(serviceIdentity.selected!==selected||serviceIdentity.tab!==tab)&&(serviceEditor()?.hasUnsaved?.()||serviceEditor()?.isSaving?.())){
   if(leaving)return;leaving=true;const accepted=await confirmLeave();leaving=false;
   if(!accepted){({selected,tab,sessionDetail}=serviceIdentity);renderList({preserveDetail:true});return;}
  }

  if(publicationEditor?.hasUnsaved()){
   if(selected===publicationIdentity.selected&&tab==='publish'){publicationEditor.reconcile(data.events.find(e=>e._id===(publicationIdentity.eventId||selected))||{});return;}
   if(leaving)return;leaving=true;
   const accepted=await confirmLeave();leaving=false;
   if(!accepted){selected=publicationIdentity.selected;tab='publish';sessionDetail=publicationIdentity.sessionDetail;renderList({preserveDetail:true});return;}
  }
  publicationEditor?.dispose?.();publicationEditor=null;

  const event=data.events.find(e=>e._id===selected||e['活动ID']===selected);
  if(data.lazyDetails&&event){
   const identity=selected,generation=detailGeneration;
   if(!detailReads.has(activityProjectKey(event))){clear(detail);detail.append(notice('正在加载此活动详情…',{tone:'neutral'}));}
   try{await loadDetail(event);}catch(error){if(!disposed&&identity===selected&&generation===detailGeneration){clear(detail);detail.append(notice(error.message||'活动详情加载失败',{tone:'warning'}),button({label:'重试活动详情',onClick:()=>renderDetail()}));}return;}
   if(disposed||identity!==selected||generation!==detailGeneration)return;
  }

  if(mobileViewport.matches&&!mobileDetail)return;
  if(tab==='roster'&&(!directoryLoaded||directoryKey!==selected))void loadDirectory();
  // Configuration is session scoped; roster, publication and service tasks keep
  // the existing project scope and its pending-hours gate, including deep links.
  if(tab!=='overview')sessionDetail=false;
  const key=`${selected}:${sessionDetail}:${tab}`,top=detailKey===key?detail.scrollTop:0;
  const restoreTabFocus=detail.contains(document.activeElement)&&document.activeElement?.getAttribute('role')==='tab';
  detailKey=key;
  try{renderDetailContent();}finally{adaptMobileTasks();requestAnimationFrame(()=>{if(detailKey!==key)return;detail.scrollTop=top;if(restoreTabFocus)detail.querySelector(`[aria-label="活动管理环节"] [data-value="${tab}"]`)?.focus({preventScroll:true});});}
 }
 function renderDetailContent(){const viewState=detail.querySelector('.activity-roster')?.getViewState?.();const cutoff=detail.querySelector('input[data-project-cutoff]'),cutoffState=cutoff?{id:cutoff.dataset.projectCutoff,value:cutoff.value}:null;patchQuery({event:selected,mode,area,tab,q:search,category,scope:sessionDetail?'session':null});clear(detail);syncExplorer();detail.classList.toggle('is-service-stage',['checkins','hours'].includes(tab));const e=data.events.find(e=>e._id===selected||e['活动ID']===selected),source=data.sources.find(s=>s.key===selected);
  if(!e){detail.append(source?panel({title:source.name,description:'请补全活动信息。',body:h('div',{class:'stack-4'},badge('待配置',{tone:'warning'}),definitionList([['来源表',source.table],['日期',source.date||'待填写'],['时段 / 岗位',[source.slot,source.position].filter(Boolean).join(' · ')||'待填写']]),notice('补全活动信息后提交审批。',{tone:'neutral'}),button({label:'完善配置并纳入流程',variant:'primary',onClick:()=>createDrawer({source})}))}):emptyState({title:'选择活动开始管理',description:'新建活动或选择待配置的源表活动。'}));return;}
  if(config(e).positionPlan&&['roster','checkins','hours'].includes(tab)){const child=projectEvents(data.events,e).find(row=>config(row).ordinary);if(child){renderProject(child,viewState,cutoffState);return;}}
  if((config(e).ordinary||config(e).blood)&&!sessionDetail){renderProject(e,viewState,cutoffState);return;}
  if(config(e).ordinary||config(e).blood){detail.append(h('div',{class:'activity-parent-context'},button({label:'返回活动项目',size:'sm',onClick:()=>{sessionDetail=false;renderList({preserveDetail:true});renderDetail();}}),h('span',{class:'t-caption',text:activityProjects(projectEvents(data.events,e))[0].projectName})));}
  const regs=scopedRows(data.registrations,e),hours=data.ledger.filter(l=>l['活动ID']===e['活动ID']);
  const stage=activityStage(e,{ledger:hours});
  const editableMeta=canEditMeta(e,{ledger:hours});
  const mayReview=canReviewActivity(e,actor,superAdmin);
  const isOwner=String(e['负责人账号ID']||'')===String(actor)||(config(e).coOwners||[]).map(String).includes(String(actor));
  const projectScope=Boolean(config(e).positionPlan||config(e).ordinary||config(e).blood);
  const slot=String(e['报名时段']||'').trim(),date=String(e['报名日期']||'').trim();
  const detailSchedule=[/\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日/.test(slot)?'':date,slot,e['地点']].filter(Boolean).join(' · ');
  const rawPosition=String(e['岗位']??'').trim();
  const detailPosition=!rawPosition||rawPosition.toLowerCase()==='null'?(config(e).bookingMode==='grouped'?'按岗位配置':'未设置岗位'):rawPosition;
  const plan=config(e).positionDraft||config(e).positionPlan;
  const positionMap=buildPositionMap(plan?.positions||[]);

  // 固定操作槽：① 活动信息查看 ② 活动信息修改 ③ 各环节操作（随状态替换）
  const actionSlot=h('div',{class:'activity-stage-actions'});
  const metaSlot=button({label:'活动信息修改',size:'sm',onClick:()=>createDrawer({event:e})});
  metaSlot.disabled=!editableMeta;
  if(!editableMeta)metaSlot.title='已发布、已有参与记录或按岗位生成的活动需先结束流程，不能直接改写配置';
  for(const item of stageActions(stage,{canReview:mayReview,isOwner,superAdmin,project:projectScope,ledger:hours})){
    const control=button({label:item.label,variant:item.variant,size:'sm',onClick:()=>runStageAction(item.intent,control)});
    control.dataset.stageIntent=item.intent;
    actionSlot.append(control);
  }
  const moreActions=h('details',{class:'activity-risk-actions'},h('summary',{text:'更多'}),h('div',{},
    config(e).source?.kind==='generated_blood'?null:button({label:'复制为新活动',size:'sm',onClick:()=>createDrawer({copy:e})}),
    config(e).source?.kind!=='generated_blood'&&stage!=='archived'?button({label:'管理负责人',size:'sm',onClick:()=>editOwners(e)}):null,
    config(e).blood&&config(e).source?.kind!=='generated_blood'&&stage==='registering'?button({label:'停点',variant:'ghost',size:'sm',onClick:()=>reasonAction('停点并显示原因',`/events/${e._id}/stop`)}):null,
    !regs.length&&config(e).source?.kind!=='generated_blood'&&!['archived'].includes(stage)?button({label:'删除活动',variant:'ghost',size:'sm',onClick:()=>archive(e)}):null));

  detail.append(h('header',{class:'activity-detail-head stack-4'},
    h('div',{class:'row-between row-wrap'},h('div',{class:'row-2 row-wrap'},badge(stageLabel(stage),{tone:stageTone(stage)}),badge(e['活动类别'],{tone:'accent'})),h('span',{class:'activity-stage-next t-caption',text:nextStepHint(stage)})),
    h('h2',{class:'t-h2',text:e['活动名称']}),
    h('p',{class:'t-caption',text:detailSchedule}),
    h('div',{class:'activity-fixed-slots'},button({label:'活动信息查看',size:'sm',onClick:()=>showActivityInfo(e,hours)}),metaSlot,actionSlot,moreActions),
    h('ol',{class:'activity-stage-track','aria-label':'活动流程'},...stageProgress(stage).map(step=>h('li',{class:step.current?'is-current':step.done?'is-done':'',text:step.label}))),
    ...(e['报名日期']<new Date(Date.now()+8*3600000).toISOString().slice(0,10)?[notice('活动日期已过去。开展新一期活动时，请复制并修改日期。',{tone:'warning'})]:[]),
    workflowTabs(e,hours)));

  const approval=config(e).approval,returned=config(e).approvalReturn;
  if(config(e).bookingMode==='grouped'&&['draft','approval','ready'].includes(stage)){
   const positions=plan;
   detail.append(panel({title:'岗位配置与发布',description:'创建后即可准备岗位；审批通过后统一发布，保存安排不会自动开放报名。',body:h('div',{class:'stack-4'},h('p',{text:positions?`已保存 ${positions.positions?.length||0} 个岗位${config(e).positionDraft?' · 尚未发布':''}`:'尚未配置报名岗位'}),['草稿','待审核','可发布'].includes(e['状态'])?button({label:'配置报名岗位',variant:'primary',onClick:()=>configureProjectPositions(e,refreshAfterWrite)}):null,...(positions?.positions||[]).map(p=>h('p',{class:'t-secondary',text:`${labelPosition(positionMap,p.name)} · ${p.campus}校区 · ${p.location} · ${p.capacity} 人 · ${p.start.slice(0,19).replace('T',' ')} — ${p.end.slice(0,19).replace('T',' ')}`})),...projectEvents(data.events,e).filter(row=>config(row).ordinary).map(row=>button({label:`${row['报名日期']} ${row['岗位']} · ${row['地点']}`,onClick:()=>{selected=row._id;sessionDetail=false;tab='overview';renderDetail();}})))}));
  }
  if(stage==='approval')detail.append(h('div',{class:'activity-approval-status row-between row-wrap'},h('p',{class:'t-secondary',text:approval?`待 ${approval.reviewerName} 审核`:'此申请尚未分配审核主席，请编辑后重新提交。'}),mayReview?button({label:'退回修改',size:'sm',onClick:()=>returnActivityApproval(e,mutate)}):null));
  if(stage==='draft'&&returned)detail.append(notice(`已退回修改：${returned.reason}（审核人：${returned.reviewerName}）`,{tone:'warning'}));
  if(tab==='publish'){
    publicationIdentity={selected,sessionDetail};
    detail.append(config(e).ordinary?notice('多班次项目使用统一截止与报名开关，不修改单个班次通知。',{tone:'neutral'}):config(e).source?.kind==='generated_blood'?notice('献血车班次由 NJUTable 排班表维护。',{tone:'neutral'}):(publicationEditor=publicationPanel(e,{config:config(e),mutate,editable:['draft','approval','ready'].includes(stage)&&!regs.length})));
    return;
  }
  if(config(e).source?.kind==='generated_blood'&&['overview','roster'].includes(tab))detail.append(h('details',{class:'activity-position-details'},h('summary',{text:'查看各名额报名情况'}),asyncRegion({load:()=>request(`${root}/events/${encodeURIComponent(e._id)}/positions`),render:payload=>h('div',{class:'activity-position-list'},...payload.positions.map(p=>h('article',{class:'activity-person'},h('div',{class:'row-between'},h('b',{text:`名额 ${p.position}`}),badge(p.status)),definitionList(Object.entries(p.profile).filter(([,v])=>v)))))})));
  if(tab!=='overview'){detail.append(showRecords(e,tab,viewState));return;}
  // 「活动信息」页按环节呈现：待审核三份预览、待发布只留通知、其余为只读摘要。
  if(stage==='approval'){
    detail.append(activityPreviewPanel(e),positionPreviewPanel(positionMap,plan),noticePreviewPanel(e,{readonly:true}));
    return;
  }
  if(stage==='ready'){
    detail.append(notice(`发布后即开放报名。修改通知请点击「活动信息修改」或下方编辑入口，保存后原审批失效，需重新审批。`,{tone:'neutral'}),noticePreviewPanel(e,{readonly:true,onEdit:()=>{tab='publish';renderDetail();}}));
    return;
  }
  detail.append(panel({title:'活动配置',variant:'activity-config',body:definitionList([['岗位 / 名额',`${detailPosition} · ${e['容量']} 人`],['服务时长',config(e).ordinary?.hoursPending?'规则待确定':`${e['服务时长']} 小时`],['培训 / 交通',`${e['培训时长']} / ${e['交通时长']} 小时`],['工作内容',e['工作内容']],['参与情况',`${regs.filter(r=>['已确认','已签到'].includes(r['报名状态'])).length} 人已确认 · ${regs.filter(r=>r['报名状态']==='已签到').length} 人已核验 · ${hours.filter(l=>l['状态']==='已入账').length} 笔已入账`],[config(e).source?.kind==='generated_blood'?'班次来源':'审批记录',config(e).source?.kind==='generated_blood'?'NJUTable 排班表':e['审批人']?`版本 ${e['批准版本']} · ${e['审批时间']}`:'尚未通过审批']])}));
  if(stage==='ended'){
    detail.append(notice('活动已结束，仅保留查看与导出。需要继续录入时长请使用「查看时长表」。',{tone:'neutral'}));
    return;
  }
  detail.append(noticePreviewPanel(e,{readonly:['draft','archived'].includes(stage),onEdit:()=>{tab='publish';renderDetail();}}));

  async function runStageAction(intent,control){
    try{
      if(intent==='approve')return await runWithLoading(control,()=>mutate(`/events/${e._id}/approve`));
      if(intent==='return-approval')return returnActivityApproval(e,mutate);
      if(intent==='submit')return await runWithLoading(control,()=>mutate(`/events/${e._id}/submit`));
      if(intent==='restore')return await runWithLoading(control,()=>mutate(`/events/${e._id}/restore`));
      if(intent==='publish-now'){tab='publish';return renderDetail();}
      if(intent==='publish-schedule'){tab='publish';return renderDetail();}
      if(intent==='copy-notice'){
        try{await navigator.clipboard.writeText(e['通知草稿']||'');notify.success('已复制报名通知');}catch(error){reportError(error,'复制未完成');}
        return;
      }
      if(intent==='close-event'||intent==='close-project'){
        const project=intent==='close-project';
        if(!await confirmAction({title:project?'截止整个活动报名？':'截止报名？',description:'截止后不再接受新报名；现场签到与时长录入继续进行，完成后可结束活动。',confirmLabel:'报名截止'}))return;
        return await runWithLoading(control,()=>mutate(`/events/${e._id}/close`,project?{scope:'project'}:{}));
      }
      if(intent==='submit-hours'){
        if(!hasSubmittedHours(hours)){notify.warning('还没有可提交的时长记录','请先在「志愿者签到」中核对到场并录入时长。');tab='checkins';return renderDetail();}
        if(!await confirmAction({title:'提交时长表？',description:`已录入 ${hours.length} 条时长记录。提交后进入时长审核，由分管主席核对并导出。`,confirmLabel:'提交时长表'}))return;
        tab='hours';return renderDetail();
      }
      if(intent==='preview-hours'||intent==='view-hours'){tab='hours';return renderDetail();}
      if(intent==='export-hours'){
        const month=hours[0]?.['正式工作日期']?.slice(0,7)||'';
        const url=`${root}/events/${encodeURIComponent(e._id)}/hours-export${month?`?month=${month}`:''}`;
        const link=h('a',{class:'btn btn--primary',text:'下载 Excel',href:url,data:{native:true}});
        const drawer=openDrawer({title:'导出并发送时长表',description:'Excel 由服务端按当前已批准记录生成；请下载后发送给第一负责人与分管主席。',body:h('div',{class:'stack-4'},definitionList([['活动',e['活动名称']],['记录数',`${hours.filter(row=>['已批准','已入账'].includes(row['状态'])).length} 条`]]),link,notice('自动邮件附件通道尚未开放，导出的文件需要人工发送。',{tone:'warning'})),footer:[button({label:'完成',variant:'primary',onClick:()=>drawer.close()})]});
        return;
      }
    }catch(error){reportError(error,'操作未完成');}
  }
}

/** 只读活动信息抽屉：固定槽第一位，任何状态都可打开。 */
function showActivityInfo(e,hours=[]){
  const cfg=config(e);
  const drawer=openDrawer({title:`活动信息 · ${e['活动名称']}`,width:720,body:h('div',{class:'stack-4'},
    definitionList([
      ['活动类别',e['活动类别']||cfg.center||'待补充'],
      ['地区',cfg.region==='苏州活动'?'苏州地区':'南京地区'],
      ['时间',[e['报名日期'],e['报名时段']].filter(Boolean).join(' ')||cfg.window?.start||'待补充'],
      ['地点',e['地点']||'待补充'],
      ['名额',`${e['容量']||'—'} 人`],
      ['时长',`服务 ${e['服务时长']||'—'} · 培训 ${e['培训时长']||'—'} · 交通 ${e['交通时长']||'—'} 小时`],
      ['工作内容',e['工作内容']||'未填写'],
      ['负责人',e['负责人账号ID']||'未设置'],
      ['审批',e['审批人']?`版本 ${e['批准版本']} · ${e['审批时间']}`:'尚未通过审批'],
      ['时长记录',hours.length?`${hours.length} 条（待批准 ${hours.filter(r=>r['状态']==='待批准').length}）`:'暂无'],
    ])),footer:[button({label:'关闭',onClick:()=>drawer.close()})]});
  return drawer;
}

function activityPreviewPanel(e){
  const cfg=config(e);
  return panel({title:'活动预览',description:'参与者将在活动广场看到的内容。',body:h('article',{class:'activity-preview__paper activity-preview__paper--flat'},
    h('div',{class:'activity-preview__meta'},badge(e['活动类别']||cfg.center||'待选类别',{tone:'accent'}),h('span',{text:cfg.region==='苏州活动'?'苏州地区':'南京地区'})),
    h('h4',{class:'activity-preview__title',text:e['活动名称']}),
    h('dl',{class:'activity-preview__schedule'},h('dt',{text:'开始'}),h('dd',{text:cfg.window?.start?.slice(0,16).replace('T',' ')||e['报名日期']||'待定'}),h('dt',{text:'结束'}),h('dd',{text:cfg.window?.end?.slice(0,16).replace('T',' ')||e['报名时段']||'待定'}),h('dt',{text:'地点'}),h('dd',{text:e['地点']||'待定'})),
    h('p',{class:'activity-preview__description',text:e['工作内容']||cfg.content||'活动介绍待补充。'}),
    h('div',{class:'activity-preview__metrics'},...[[e['容量']||'—','推荐录取 / 人'],[cfg.registrationLimit||e['容量']||'—','报名上限 / 人'],[e['服务时长']||'—','服务时长 / 小时']].map(([value,label])=>h('div',{},h('strong',{text:String(value)}),h('span',{text:label})))))});
}

function positionPreviewPanel(positionMap,plan){
  const positions=plan?.positions||[];
  if(!positions.length)return notice('本活动未配置岗位，使用整体统一报名。',{tone:'neutral'});
  const items=positions.map(p=>h('article',{class:'activity-position-preview__item'},
    h('strong',{text:labelPosition(positionMap,p.name)}),
    h('span',{class:'t-caption',text:`${p.campus}校区 · ${p.location} · ${p.capacity} 人`}),
    h('span',{class:'t-caption',text:`${p.start.slice(0,16).replace('T',' ')} — ${p.end.slice(11,16)}`}),
    p.work?h('p',{class:'t-secondary',text:p.work}):null));
  return panel({title:'岗位预览',description:`共 ${positions.length} 个岗位；编号按岗位配置顺序。`,body:h('div',{class:'activity-position-preview'},...items)});
}

function noticePreviewPanel(e,{readonly=false,onEdit=null}={}){
  return panel({title:'报名通知预览',description:readonly?'修改通知请点击「活动信息修改」，保存后需重新审批。':'发布前可再次核对。',body:h('div',{class:'stack-4'},
    h('pre',{class:'activity-notice',text:e['通知草稿']||'尚未生成报名通知。'}),
    h('div',{class:'row-2 row-wrap'},onEdit?button({label:'编辑报名通知',size:'sm',onClick:onEdit}):null,
      button({label:'复制通知',size:'sm',onClick:async()=>{try{await navigator.clipboard.writeText(e['通知草稿']||'');notify.success('已复制');}catch(error){reportError(error,'复制未完成');}}})))});
}
 function renderList({preserveDetail=false}={}){
  const top=list.scrollTop,previous=selected;
  const focused=list.contains(document.activeElement)?document.activeElement?.dataset.objectId||document.activeElement?.dataset.toggleId:null;
  const items=explorerItems(data.events,data.sources,{mode,area,category,search},{canReview:row=>canReviewActivity(row,actor,superAdmin)});
  const canonical=data.events.find(row=>row['活动ID']===selected);if(canonical)selected=canonical._id;
  const project=items.find(p=>p.id===selected||p.sessions.some(s=>s.id===selected));
  if(project&&!sessionDetail)selected=project.id;
  // Preserve a source deep link until its deferred catalogue has arrived.
  const pendingSource=data.sourcesLoading&&selected&&!data.events.some(e=>e._id===selected||e['活动ID']===selected);
  if(!project&&!pendingSource){selected=items[0]?.id||'';sessionDetail=false;}
  const firstRender=initialDirectory;
  if(initialDirectory&&sessionDetail&&project)expandedProjects.add(project.id);
  initialDirectory=false;
  clear(list);
  directoryCount.textContent=`${items.length} 项结果`;
  if(!items.length)list.append(mode==='sources'&&data.sourcesLoading?notice('正在加载待配置活动…',{tone:'neutral'}):emptyState({title:'没有符合条件的活动',description:'调整筛选条件，或新建活动。'}));
  for(const item of items){const displayStatus=id=>{const row=data.events.find(e=>e._id===id);if(!row)return '待配置';return stageLabel(activityStage(row,{ledger:data.ledger.filter(l=>l['活动ID']===row['活动ID'])}));};item.status=displayStatus(item.id);for(const child of item.sessions)child.status=displayStatus(child.id);list.append(explorerRow(item,{
   selected,sessionDetail,expanded:expandedProjects.has(item.id),
   onExpand:()=>{if(expandedProjects.has(item.id))expandedProjects.delete(item.id);else expandedProjects.add(item.id);renderList({preserveDetail:true});},
   onSelect:(id,child)=>{const changed=selected!==id||sessionDetail!==child,opening=mobileViewport.matches&&!mobileDetail;selected=id;sessionDetail=child;mobileDetail=true;syncExplorer();if(changed)tab='overview';renderList({preserveDetail:true});if(changed||opening)void renderDetail().then(()=>{if(opening)mobileBack.focus();});}
  }));}
  list.scrollTop=top;
  if(firstRender)requestAnimationFrame(()=>{const current=list.querySelector('[aria-pressed="true"]');if(current&&list.isConnected){const row=current.getBoundingClientRect(),box=list.getBoundingClientRect();if(row.top<box.top||row.bottom>box.bottom)list.scrollTop+=row.top-box.top;}});
  if(focused)Array.from(list.querySelectorAll('[data-object-id],[data-toggle-id]')).find(node=>node.dataset.objectId===focused&&node.classList.contains('activity-explorer-session')===sessionDetail||node.dataset.toggleId===focused)?.focus({preventScroll:true});
  patchQuery({event:mobileViewport.matches&&!mobileDetail?null:selected,mode,area,tab,q:search,category,scope:sessionDetail?'session':null});
  if(!preserveDetail||selected!==previous)renderDetail();
 }
 const categoryControl=field({label:'活动类别',value:category,options:[{value:'',label:'全部类别'},...ACTIVITY_CENTERS],onInput:()=>{category=categoryControl.control.value;renderList({preserveDetail:true});}});categoryControl.classList.add('activity-category-field');

 const modeControl=segmented({items:[{value:'all',label:'全部'},{value:'review',label:'待审批'},{value:'mine',label:'待我审核'},{value:'open',label:'进行中'},{value:'sources',label:'待配置'},{value:'trash',label:'回收站'}],value:mode,ariaLabel:'活动状态筛选',onChange:value=>{mode=value;modeControl.setValue(value);if(value==='sources'&&!data.sourcesLoaded&&!data.sourcesLoading)void loadSources();renderList({preserveDetail:true});}});
 const areaControl=field({label:'活动地区',value:area,options:[{value:'all',label:'全部'},{value:'nanjing',label:'南京地区'},{value:'suzhou',label:'苏州地区'}],onInput:()=>{area=areaControl.control.value;renderList({preserveDetail:true});}});
 const searchInput=searchField({value:search,label:'搜索活动',placeholder:'搜索活动名称、类型或日期',onSearch:value=>{search=value;renderList({preserveDetail:true});}});
 async function loadSources(fresh=false){
  const sequence=++sourceSequence;data={...data,sourcesLoading:true};
  try{
   const payload=await request(root+'/sources',{fresh});
   if(sequence!==sourceSequence)return;
   data={...data,sources:payload.sources,sourceWarnings:payload.warnings||[],sourceError:false,sourcesLoading:false,sourcesLoaded:true};
  }catch{if(sequence!==sourceSequence)return;data={...data,sourceError:true,sourcesLoading:false};}
  if(view?.dataset.ready==='true'){
   if(
    (!sourceTargetHandled && context.query.has('source')) ||
    mode==='sources' ||
    data.sources.some(s=>s.key===selected)
   ){
    updatePayload(data);
   }else{
    renderList({preserveDetail:true});
    const count=summary.lastElementChild?.querySelector('strong');
    if(count)count.textContent=String(
     data.sources.filter(s=>
      !data.events.some(e=>config(e).source?.key===s.key)
     ).length
    );
   }
  }
 }
 async function loadAll(fresh=false){
  if(!getSessionState().authenticated)await refreshSession();
  const current=getSessionState();if(!current.authenticated)throw new ApiError('登录已失效，请重新登录。',{status:401});
  superAdmin=current.user.role==='super_admin';actor=current.user.accountId||current.user.username;
  // Existing managed activities do not wait for the much larger source catalogue.
  if(fresh){directoryLoaded=false;approvalSettingsLoaded=false;}
  const payload=await request(root+'/catalog',{fresh});
  void loadApprovalSettings(fresh);
  if(mode==='sources'||selected&&!payload.events.some(e=>e._id===selected||e['活动ID']===selected))void loadSources(fresh);
  return {registrations:[],ledger:[],...payload,sources:data.sources,sourceWarnings:data.sourceWarnings||[],sourceError:data.sourceError,sourcesLoading:Boolean(data.sourcesLoading),sourcesLoaded:data.sourcesLoaded};
 }

 function renderPayload(payload){view.dataset.ready='true';data=payload;resolveSourceTaskTarget();void resolveAgentTaskTarget();clear(summary);const active=activityProjects(data.events).filter(e=>e['状态']!=='已归档'),adopted=new Set(data.events.map(e=>config(e).source?.key));summary.append(...[['活动项目',active.length],['待审批',active.filter(e=>e.sessions.some(row=>['草稿','待审核'].includes(row['状态']))).length],['报名中',active.filter(e=>e.sessions.some(row=>row['状态']==='报名中')).length],['源表待配置',!data.sourcesLoaded?'按需加载':data.sources.filter(s=>!adopted.has(s.key)).length]].map(([label,value])=>h('div',{},h('strong',{text:value}),h('span',{text:label}))));if(!selected)selected=active.find(e=>['报名中','停点'].includes(e['状态']))?._id||active[0]?._id||data.sources[0]?.key||'';renderList();return [payload.sourceError?notice('源表活动暂未加载成功，现有网站活动仍可管理。请刷新重试。',{tone:'warning'}):null,...(payload.sourceWarnings||[]).map(text=>notice(text,{tone:'warning'})),summary,workspace];}
 view=asyncRegion({errorTitle:'活动数据加载失败',load:loadAll,render:renderPayload});
 view.classList.add('activity-region');
 const filters=h('details',{class:'activity-mobile-filters'},h('summary',{text:'地区与类别筛选'}),h('div',{class:'activity-explorer-filters'},areaControl,categoryControl),button({label:'清除筛选',variant:'ghost',size:'sm',onClick:()=>{mode='all';area='all';category='';search='';modeControl.setValue(mode);areaControl.control.value='all';categoryControl.control.value='';searchInput.setValue('');renderList({preserveDetail:true});}}));
 // Desktop filters stay expanded; mobile keeps search and task status in view.
 filters.open=!mobileViewport.matches||Boolean(category)||area!=='all';
 workspace.append(h('aside',{class:'activity-master','aria-label':'活动目录'},h('div',{class:'activity-list-heading'},h('h2',{text:'活动目录'}),directoryCount),h('div',{class:'activity-list-tools'},searchInput,modeControl,filters),list),detailColumn);
 const more=h('details',{class:'activity-page-tools'},h('summary',{text:'管理工具'}),h('div',{},approvalConfigButton,button({label:'服务记录核对',href:'/console/volunteers',variant:'ghost'}),button({label:'新建活动',variant:'primary',iconName:'plus',onClick:()=>createDrawer()})));
 more.open=!mobileViewport.matches;
 return {title:'活动管理',crumb:'活动管理',dispose:()=>{publicationEditor?.dispose?.();activityDisposed=true;mobileViewport.removeEventListener('change',viewportChanged);releaseGuard();window.removeEventListener('beforeunload',beforeUnload);disposed=true;detailGeneration++;sourceSequence++;refreshSequence++;clearInterval(countdownTimer);searchInput.dispose();},node:h('div',{class:'view wspad wspad--wide stack-5 activity-center'},pageHead({title:'活动管理',description:'选择活动，处理录用、现场签到与时长。',actions:[more,button({label:'刷新',variant:'secondary',onClick:async()=>{try{await reload(true);}catch(error){reportError(error,'刷新失败');}}})]}),view)};
}
