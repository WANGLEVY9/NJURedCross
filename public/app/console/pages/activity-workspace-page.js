import {isManagedDutyContent} from '../../shared/special-activity.js';
import {scheduledSession} from '../../shared/schedule-board-layout.js';
import {editRegistrationContact} from './activity-contact.js';
import {canonicalActivityCategory} from '../../shared/activity-taxonomy.js';
import {activityLiveInformation} from './activity-live-information.js';
import {activityRunningWorkspace} from './activity-running-workspace.js';
import {activityFinalHoursWorkspace} from './activity-final-hours-workspace.js';
import {openHoursSync} from './hours-sync.js';
import {activityInformationPreview} from './activity-information-preview.js';
import {registrationCapacity} from '../../shared/activity-registration.js';
import {activityApprovalWorkspace} from './activity-approval-workspace.js';
import {activityRegistrationWorkspace} from './activity-registration-workspace.js';
import {h,icon} from '../../core/dom.js';
import {request,getSessionState} from '../../core/api.js';
import {setLeaveGuard,patchQuery,navigate,buildPath} from '../../core/router.js';
import {pageHead,button,field,notice,emptyState,skeletonLine} from '../../ui/primitives.js';
import {openModal,confirmAction} from '../../ui/overlay.js';
import {notify,reportError} from '../../core/toast.js';
import {workspaceCategories,WORKSPACE_STAGES,workspaceStage} from '../../shared/activity-workspace.js';
import {activityDraftWorkspace} from './activity-draft-workspace.js';
import {activityStage,stageLabel} from '../../shared/activity-stage.js';
import {activityProjects} from '../../shared/activity-projects.js';
import {editAdminActivityInformation} from './activity-admin-information.js';
import {eventResponsibleIds} from '../../shared/activity-responsibility.js';
import {activityRegionTitle,activityRegionTag} from '../../shared/activity-region-tag.js';
const root='/api/volunteer/workflow/workspace-drafts';
const loadProjectPeopleOptions=async params=>(await request(`${root}/project-people-options?${new URLSearchParams(params)}`,{fresh:true})).options;
const config=row=>{try{return JSON.parse(row['报名页配置']||'{}');}catch{return {};}};
// Keep only directory UI preferences across in-app list/detail navigation.
const directoryStates=new Map();

/** Skeleton placeholder that mirrors the workspace layout while its data loads. */
function workspaceLoading(label){
  return h('div',{class:'activity-v2-loading',role:'status','aria-busy':'true'},
    h('div',{class:'activity-v2-loading__toolbar'},h('span',{class:'sk sk--line'}),h('span',{class:'sk sk--line activity-v2-loading__chip--short'}),h('span',{class:'activity-v2-loading__spacer'}),h('span',{class:'sk sk--line activity-v2-loading__chip--long'})),
    h('div',{class:'activity-v2-loading__body'},
      h('div',{class:'activity-v2-loading__intro'},h('span',{class:'sk sk--title sk-w-40'}),h('span',{class:'sk sk--line sk-w-85'}),h('span',{class:'sk sk--line sk-w-70'})),
      h('div',{class:'activity-v2-loading__grid'},...Array.from({length:6},()=>skeletonLine())),
    ),
    h('p',{class:'activity-v2-loading__hint',text:label}),
  );
}

// 历史活动工作区是首访才加载的大模块：页面打开后空闲时预热，避免点击时出现代码加载尖峰。
let legacyWorkspaceWarm=false;
function warmLegacyWorkspace(){
  if(legacyWorkspaceWarm)return;legacyWorkspaceWarm=true;
  const warm=()=>import('./legacy-activity-workspace.js').catch(()=>{});
  if('requestIdleCallback' in window)requestIdleCallback(warm,{timeout:5000});
  else setTimeout(warm,2000);
}

/** Rebuilt activity management. Every phase operates inside the selected project pane. */
export default async function activityWorkspacePage(context){
  let drafts=[],events=[],selected=context.query.get('draft')||context.query.get('event')||'',editor=null,disposed=false,loadSequence=0,detailSequence=0,canSubmit=false,canCreate=true,creationScopes=null;
  const occupancy=new Map();
  const list=h('div',{class:'activity-v2-list'}),pane=h('section',{class:'activity-v2-detail','aria-label':'活动操作工作区'}),message=h('div',{class:'activity-v2-message'}),count=h('span',{class:'t-caption'});
  let directoryCollapsed=false;
  const mobile=window.matchMedia('(max-width:960px)');
  const directoryKey=`${getSessionState().user?.username||''}:${context.path}:${context.query.get('history')||'active'}`;
  let directoryState=directoryStates.get(directoryKey);
  function rememberDirectory(){
    if(!mobile.matches||selected)return;
    directoryState={search:search.control.value,stage:stage.control.value,region:region.control.value,category:category.control.value,scrollTop:node.scrollTop,focusId:directoryState?.focusId};
    directoryStates.set(directoryKey,directoryState);
  }
  function syncLayout(){node.dataset.mobileView=selected?'detail':'list';}
  function resizeLayout(){
    if(!mobile.matches&&!selected){selected=records().filter(row=>context.query.get('history')==='1'?row.stage==='已结束':row.stage!=='已结束')[0]?.id||'';renderList();renderDetail();}
    syncLayout();
  }
  async function openActivity(row){
    if(mobile.matches){
      rememberDirectory();directoryState ||= {};directoryState.focusId=row.id;
      await navigate(buildPath(context.path,{...Object.fromEntries(context.query),draft:row.draft?row.id:null,event:row.event?row.id:null}),{state:{activityDirectory:true}});
      return;
    }
    if(row.id===selected||!await leave())return;
    selected=row.id;renderList();renderDetail();
  }
  function returnToDirectory(){
    if(context.state?.activityDirectory){history.back();return;}
    return navigate(buildPath(context.path,{...Object.fromEntries(context.query),draft:null,event:null,tab:null}),{replace:true});
  }
  function toggleDirectory(){directoryCollapsed=!directoryCollapsed;workspace.classList.toggle('is-directory-collapsed',directoryCollapsed);for(const control of pane.querySelectorAll('.activity-v2-collapse')){control.textContent=directoryCollapsed?'›':'‹';control.setAttribute('aria-label',directoryCollapsed?'展开活动列表':'收起活动列表');control.setAttribute('aria-expanded',String(!directoryCollapsed));}}
  const currentActor=getSessionState().user?.accountId||getSessionState().user?.username;
  let searchDebounce=0;
  const search=field({label:'搜索活动',type:'search',placeholder:'搜索活动名称',onInput:()=>{clearTimeout(searchDebounce);searchDebounce=setTimeout(renderList,150);}});
  const stage=field({label:'阶段',options:[{value:'',label:'全部'},...WORKSPACE_STAGES],onInput:renderList});
  const region=field({label:'地区',options:[{value:'',label:'全部'},{value:'nanjing',label:'南京地区'},{value:'suzhou',label:'苏州地区'}],onInput:()=>{syncCategories();renderList();}});
  const category=field({label:'类别',options:[{value:'',label:'全部类别'},...workspaceCategories('')],onInput:renderList});
  const leave=async()=>{
    if(editor?.isSaving()){notify.warning('正在保存，请等待结果');return false;}
    return !editor?.hasUnsaved()||await confirmAction({title:'放弃未保存的修改？',description:'已保存的草稿会保留。',confirmLabel:'放弃修改'});
  };
  const release=setLeaveGuard(leave);
  const beforeUnload=event=>{if(editor?.hasUnsaved()){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',beforeUnload);
  function syncCategories(){const old=category.control.value,values=workspaceCategories(region.control.value);category.control.replaceChildren(...[{value:'',label:'全部类别'},...values.map(value=>({value,label:value}))].map(o=>h('option',{value:o.value,text:o.label})));category.control.value=values.includes(old)?old:'';}
  function records(){
    const projectRows=activityProjects(events.filter(event=>(event['状态']!=='已归档'||config(event).workspaceRemoval?.action==='end')&&!(config(event).special?.dates&&config(event).positionPlan&&['报名中','进行中','已结束'].includes(event['状态']))).map(event=>event['状态']==='已归档'?{...event,状态:'已结束'}:event)).map(project=>{
      const c=config(project),legacy=activityStage(project);
      const stage=config(project).workspaceSubmission?workspaceStage(project):['approval','ready'].includes(legacy)?'待审批':stageLabel(legacy);
      const sessions=project.sessions||[project];
      return {
        id:project._id,
        name:project.projectName||project['活动名称'],
        stage,
        statusLabel:config(project).workspaceSubmission?stage:legacy==='approval'?'待审核':legacy==='ready'?'待发布':stageLabel(legacy),
        region:project['活动地区']==='苏州地区'||c.region==='苏州活动'?'suzhou':'nanjing',
        category:canonicalActivityCategory(project['组织类别']||c.center),
        date:project['报名日期'],
        event:project,
        // Keep all identities for deep links, but do not count the parent or retired positions.
        sessions,
        sessionCount:Array.isArray(c.positionPlan?.positions)?c.positionPlan.positions.length:sessions.filter(session=>!config(session).positionPlan).length,
      };
    });
    return [...drafts.filter(d=>!(d.stage==='草稿'&&!d.activityId&&!d.submissionStatus&&isManagedDutyContent(d.content))&&!events.some(e=>e['活动ID']===d.activityId)).map(d=>({id:d.id,name:d.content.name,stage:d.stage,statusLabel:d.stage,region:d.content.region,category:canonicalActivityCategory(d.content.category),date:d.content.date,endDate:d.content.endDate,draft:d})),...projectRows];
  }
  function renderList(){
    const rows=records().filter(r=>(context.query.get('history')==='1'?r.stage==='已结束':r.stage!=='已结束'||stage.control.value==='已结束')&&(!search.control.value||r.name?.includes(search.control.value))&&(!stage.control.value||r.stage===stage.control.value)&&(!region.control.value||r.region===region.control.value)&&(!category.control.value||r.category===category.control.value));
    count.textContent=`${rows.length} 项`;
    const cards=rows.map(row=>{
      const sessionCount=row.sessionCount??1;
      const status=h('span',{class:'activity-v2-status'},h('span',{class:'activity-v2-badge',text:row.stage==='报名中'&&occupancy.get(row.id)?'报名中 · 报名已满':row.statusLabel||row.stage||'未分类'}),activityRegionTag(row));
      return h('button',{type:'button',class:'activity-v2-card',data:{record:row.id,region:row.region||'',category:row.category||'',sessions:String(sessionCount)},aria:{pressed:String(row.id===selected)},on:{click:()=>openActivity(row)}},h('strong',{title:row.name,text:row.name}),h('span',{class:'activity-v2-card__meta',text:[row.region==='suzhou'?'苏州地区':'南京地区',row.category,row.date].filter(Boolean).join(' · ')}),h('span',{class:'row-between'},status,sessionCount>1?h('small',{class:'t-caption',text:`${sessionCount} 个场次`}):null,h('span',{class:'activity-v2-card__entry','aria-hidden':'true'},'进入活动',icon('chevronRight','ico ico--sm'))));
    });
    const blood=rows.filter(row=>config(row.event||{}).source?.kind==='generated_blood');count.textContent=`${rows.length-blood.length+(blood.length?1:0)} 项`;
    const schedules=new Map();for(const row of rows.filter(r=>scheduledSession(r.event))){const key=config(row.event).special.rootId;schedules.set(key,[...(schedules.get(key)||[]),row]);}
    list.replaceChildren(...cards.filter((_card,index)=>!blood.includes(rows[index])&&!scheduledSession(rows[index].event)));
    for(const group of schedules.values()){const active=group.find(row=>row.id===selected)||group[0];list.append(h('button',{type:'button',class:'activity-v2-card','aria-pressed':String(group.some(row=>row.id===selected)),on:{click:()=>openActivity(active)}},h('strong',{title:active.name,text:active.name}),h('span',{class:'activity-v2-status'},h('span',{class:'activity-v2-badge',text:context.query.get('history')==='1'?'已结束':active.statusLabel}),activityRegionTag(active)),h('small',{class:'t-caption',text:`${group.length} 周排班 · 进入后选择周次`})))}
    count.textContent=`${rows.length-blood.length+(blood.length?1:0)-[...schedules.values()].reduce((n,group)=>n+group.length-1,0)} 项`;
    if(blood.length){const active=blood.find(row=>row.id===selected)||blood[0];list.append(h('button',{type:'button',class:'activity-v2-card activity-blood-directory',data:{category:'献血车专项',region:'nanjing'},'aria-pressed':String(blood.some(row=>row.id===selected)),on:{click:()=>openActivity(active)}},h('strong',{text:'市血液献血车'}),h('span',{class:'t-caption',text:`${blood.length} 周排班 · 进入后选择周次`})))}
    if(!rows.length)list.append(emptyState({title:'没有符合条件的活动',description:'调整筛选或新建活动。'}));
  }
  function renderDetail(){
    const sequence=++detailSequence;editor?.dispose();editor=null;pane.replaceChildren();const row=records().find(r=>r.id===selected);
    syncLayout();
    patchQuery({draft:row?.draft?row.id:null,event:row?.event?row.id:null});
    if(!row){pane.append(emptyState({title:'选择活动开始管理'}));return;}
    const back=button({label:'返回活动列表',variant:'ghost',iconName:'chevronLeft',onClick:returnToDirectory});back.classList.add('activity-v2-back');
    const heading=h('header',{class:'activity-v2-heading'},button({label:directoryCollapsed?'›':'‹',variant:'ghost',onClick:toggleDirectory}),back,h('h2',{},activityRegionTitle(row.name,row)),h('ol',{'aria-label':'活动阶段'},...WORKSPACE_STAGES.map(text=>h('li',{text,class:text===row.stage?'is-current':'','aria-current':text===row.stage?'step':null}))));pane.append(heading);const collapse=heading.querySelector('button');collapse.classList.add('activity-v2-collapse');collapse.setAttribute('aria-label',directoryCollapsed?'展开活动列表':'收起活动列表');collapse.setAttribute('aria-expanded',String(!directoryCollapsed));
    if(row.event?.configurationError){
      pane.append(notice('活动配置不完整，暂不能编辑。请管理员从完整备份恢复主活动配置；已有报名记录未删除。',{tone:'warning'}));
      return;
    }
    if(row.event?.relationshipError){
      pane.append(notice(`活动项目关系不完整或重复，暂不能编辑或发布。请管理员核对活动组 ID 与父活动 ID；问题代码：${(row.event.relationshipIssueCodes||[]).join('、')||'unknown'}。已有报名记录未删除。`,{tone:'warning'}));
      return;
    }
    if(context.query.get('history')==='1'&&config(row.event).workspaceRemoval?.action==='end'&&!row.event?.readOnly){
      let restoring=false;
      const endpoint=`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}/workspace-restoration`;
      void request(endpoint,{fresh:true}).then(({result})=>{
        if(disposed||sequence!==detailSequence||!result.canRestore)return;
        heading.append(button({label:'恢复活动',onClick:async()=>{
          if(restoring||!await leave())return;
          let modal,saving=false,pending=null;
          const cancel=button({label:'取消',onClick:()=>modal.close()});
          const confirm=button({label:'确认恢复',variant:'primary',onClick:async()=>{
            if(saving)return;saving=true;restoring=true;confirm.disabled=true;cancel.disabled=true;
            pending||={token:result.token,requestId:crypto.randomUUID()};
            try{
              await request(endpoint,{method:'POST',body:pending});pending=null;saving=false;restoring=false;await modal.close();
              notify.success('活动已恢复到提前结束前的阶段');
              await navigate(buildPath(context.path,{event:row.id}),{replace:true});
            }catch(error){
              if(!error.status||error.status>=500){confirm.textContent='核对恢复结果';notify.warning('恢复结果待核对','请点击核对恢复结果，勿重复创建恢复请求。');}
              else{pending=null;reportError(error,'恢复未完成，请刷新历史活动后重试');confirm.hidden=true;}
            }finally{saving=false;restoring=false;confirm.disabled=false;cancel.disabled=Boolean(pending);}
          }});
          modal=openModal({title:'恢复提前结束的活动？',body:h('p',{text:'将恢复到提前结束前的阶段，保留已有报名、签到、审核及入账记录。报名截止时间等原有规则继续生效。'}),footer:[cancel,confirm]});
          modal.setCloseGuard(()=>!saving&&!pending);
        }}));
      }).catch(()=>{/* Unavailable authority never exposes a restore control. */});
    }
    if(row.event?.readOnly){
      pane.append(h('div',{class:'activity-draft-toolbar'},button({label:'活动信息修改',disabled:true}),button({label:'更多操作',disabled:true})),notice('当前账号无此活动的操作权限，仅可查看活动信息。',{tone:'neutral'}));
      const info=h('div',{class:'activity-registration-content'});info.append(workspaceLoading('正在加载活动信息…'));pane.append(info);
      void request(`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}/information`).then(data=>{
        if(disposed||sequence!==detailSequence)return;
        const rows=data.events||[],parent=rows.find(event=>config(event).positionPlan)||rows[0],sessions=rows.filter(event=>!config(event).positionPlan);
        const tableRows=(sessions.length?sessions:rows).map(event=>{
          const values=[event['岗位']||event['活动名称'],`${event['报名日期']||''} ${event['报名时段']||''}`,event['地点']||'未填写',String(event['容量']??'未填写'),`服务 ${event['服务时长']??0} / 培训 ${event['培训时长']??0} / 交通 ${event['交通时长']??0}`,event['工作内容']||'未填写'];
          return h('tr',{},...values.map(text=>h('td',{text})));
        });
        const table=h('table',{class:'table'},h('thead',{},h('tr',{},...['岗位','日期 / 时间','地点','人数','时长（小时）','工作内容'].map(text=>h('th',{text})))),h('tbody',{},...tableRows));
        info.replaceChildren(h('p',{text:config(parent||{}).description||''}),h('div',{class:'activity-registration-table'},table),h('h3',{text:'报名通知'}),h('p',{class:'activity-approval-notice',text:parent?.['通知草稿']||'未填写'}));
      }).catch(error=>{if(!disposed&&sequence===detailSequence)info.replaceChildren(notice(error.message||'活动信息加载失败',{tone:'warning'}));});
      return;
    }
    if(['province-service','component-donation'].includes(config(row.event||{}).special?.type)){
      const loading=workspaceLoading('正在加载登记总表…');pane.append(loading);
      void Promise.all([request(`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}/detail`),import('./special-registry-workspace.js')]).then(([data,{specialRegistryWorkspace}])=>{if(disposed||sequence!==detailSequence)return;loading.remove();editor=specialRegistryWorkspace({event:data.events.find(e=>e._id===row.id)||row.event,data,onChanged:()=>load({fresh:true})});pane.append(editor.node);}).catch(error=>{if(!disposed&&sequence===detailSequence)loading.replaceWith(notice(error.message||'登记总表加载失败',{tone:'warning'}));});
    }else if(row.draft){
      editor=activityDraftWorkspace({loadProjectPeopleOptions,initial:row.draft,creationScopes,editable:(row.draft.access?.canEdit??row.draft.ownerId===currentActor)&&row.draft.stage==='草稿'&&!row.draft.submissionStatus,allowSubmit:canSubmit,
        actionsNode:moreActions(row),
        loadResponsibleOptions:async params=>(await request(`${root}/responsible-options?${new URLSearchParams(params)}`,{fresh:true})).options,
        loadResponsibleProfile:async params=>(await request(`${root}/responsible-profile?${new URLSearchParams(params)}`,{fresh:true})).profile,
        save:async({id,expectedVersion,content})=>{const result=(await request(`${root}/${id}`,{method:'PATCH',body:{expectedVersion,content}})).result;drafts=drafts.map(d=>d.id===result.id?result:d);renderList();heading.querySelector('h2').replaceChildren(activityRegionTitle(result.content.name,result));return result;},
        preview:async(id,body)=>(await request(`${root}/${id}/preview`,{method:'POST',body})).result,
        confirmPreview:async(id,body)=>(await request(`${root}/${id}/confirm-preview`,{method:'POST',body})).result,
        submit:async(id,body)=>(await request(`${root}/${id}/submit`,{method:'POST',body})).result,
        // load() 已经把选中的草稿映射成正式活动并渲染，这里不再重复重建面板。
        onSubmitted:async()=>{stage.control.value='待审批';await load();notify.success('已提交审批');},
      });pane.append(editor.node);
      if(row.draft.submissionStatus==='pending'&&(row.draft.access?.canReconcile??canSubmit)){
        const reconcile=button({label:'核对提交结果',onClick:async()=>{if(reconcile.disabled)return;reconcile.disabled=true;try{await request(`${root}/${row.id}/reconcile`,{method:'POST',body:{}});await load();}catch(error){reportError(error,'提交结果仍待核对');}finally{reconcile.disabled=false;}}});
        editor.node.querySelector('.activity-draft-toolbar').append(reconcile);
        if(row.draft.access?.canRestore){
          const restore=button({label:'恢复为可编辑草稿',onClick:async()=>{
            if(restore.disabled||!await confirmAction({title:'恢复为可编辑草稿？',description:'系统将再次核对提交结果。未生成正式活动时，保留填写内容和原提交记录，恢复编辑、删除及重新提交；已生成时打开对应活动。',confirmLabel:'确认恢复'}))return;
            restore.disabled=true;reconcile.disabled=true;
            try{const {result}=await request(`${root}/${row.id}/restore`,{method:'POST',body:{expectedVersion:row.draft.version}});if(!result.restored)stage.control.value='待审批';await load();notify.success(result.restored?'已恢复为可编辑草稿':'已找到原活动，提交状态已核对');}
            catch(error){reportError(error,'恢复未完成，原记录已保留');}finally{restore.disabled=false;reconcile.disabled=false;}
          }});editor.node.querySelector('.activity-draft-toolbar').append(restore);
        }

        pane.append(notice('该草稿上次提交的结果尚待核对，编辑和删除暂时锁定。请点击“核对提交结果”；核对成功后将打开对应正式活动。',{tone:'warning'}));
      }

    }else if(['待审批','草稿'].includes(row.stage)&&config(row.event).workspaceSubmission){
      const loading=workspaceLoading('正在加载活动信息…');pane.append(loading);
      const base=`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}`;
      const loadContent=async()=>(await request(`${base}/workspace-content`)).result;
      void Promise.all([request(`${base}/detail`),loadContent()]).then(([data,content])=>{
        if(disposed||sequence!==detailSequence)return;loading.remove();
        editor=activityApprovalWorkspace({adminEditInformation:getSessionState().user?.role==='super_admin'?()=>editAdminActivityInformation(row.event,load):undefined,loadProjectPeopleOptions,event:data.events.find(e=>e._id===row.id),content,actionsNode:moreActions(row),loadContent,
          save:body=>request(`${base}/workspace-content`,{method:'PATCH',body}),
          mutate:(action,body)=>request(`${base}/${action}`,{method:'POST',body}),
          loadResponsibleOptions:async params=>(await request(`${root}/responsible-options?${new URLSearchParams(params)}`,{fresh:true})).options,
          loadResponsibleProfile:async params=>(await request(`${root}/responsible-profile?${new URLSearchParams(params)}`,{fresh:true})).profile,
          onChanged:async()=>{stage.control.value='';await load();},
        });pane.append(editor.node);
      }).catch(error=>{if(!disposed&&sequence===detailSequence)loading.replaceWith(notice(error.message||'活动信息加载失败',{tone:'warning'}));});
    }else if(row.stage==='报名中'&&config(row.event).approval?.mode==='workspace-regional'&&!scheduledSession(row.event)){
      const loading=workspaceLoading('正在加载报名名单…');pane.append(loading);
      const detailUrl=`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}/detail`;
      const reload=()=>request(detailUrl);
      void reload().then(data=>{
        if(disposed||sequence!==detailSequence)return;loading.remove();
        function changed(data){
          const jobs=data.events.filter(e=>config(e).bookingMode!=='grouped');occupancy.set(row.id,jobs.length>0&&jobs.every(e=>registrationCapacity(e,data.registrations).full));
          events=events.map(event=>data.events.find(next=>next._id===event._id)||event);renderList();
          const current=data.events.find(event=>event._id===row.id);if(current)heading.querySelector('h2').replaceChildren(activityRegionTitle(current['活动名称'],current));
          if(current?.['状态']!=='报名中')renderDetail();
        }
        const base=`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}`;
        const loadInformation=config(row.event).workspaceSubmission?async()=>(await request(`${base}/workspace-content`)).result:undefined;
        changed(data);
        editor=activityRegistrationWorkspace({adminEditInformation:getSessionState().user?.role==='super_admin'?()=>editAdminActivityInformation(row.event,load):undefined,event:row.event,data,actionsNode:moreActions(row),reload,loadInformation,
          decideLeave:(id,approved,reason)=>request(`/api/volunteer/workflow/registrations/${encodeURIComponent(id)}/${approved?'leave-approve':'leave-reject'}`,{method:'POST',body:{reason}}),
          editInformation:loadInformation?onSaved=>activityLiveInformation({loadProjectPeopleOptions,load:loadInformation,save:body=>request(`${base}/workspace-content`,{method:'PATCH',body}),loadResponsibleOptions:async params=>(await request(`${root}/responsible-options?${new URLSearchParams(params)}`,{fresh:true})).options,loadResponsibleProfile:async params=>(await request(`${root}/responsible-profile?${new URLSearchParams(params)}`,{fresh:true})).profile,onSaved}):undefined,
          // 一次取回整个项目全部场次的邮件状态，取代逐场次请求。
          loadMailStatuses:async events=>{
            const ids=[...new Set(events.map(event=>event._id).filter(Boolean))];
            if(!ids.length)return [];
            return (await request(`/api/volunteer/workflow/mail-status?ids=${encodeURIComponent(ids.join(','))}`)).items||[];
          },
          decide:(event,ids,decision,reason)=>request(`/api/volunteer/workflow/events/${encodeURIComponent(event._id)}/batch-decide`,{method:'POST',body:{ids,decision,reason,token:event.rosterToken,immediate:true}}),
          close:()=>request(`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}/close`,{method:'POST',body:{scope:'project'}}),
          onChanged:changed,
        });pane.append(editor.node);
      }).catch(error=>{if(!disposed&&sequence===detailSequence){loading.replaceWith(notice(error.message||'报名名单加载失败',{tone:'warning'}));}});
    }else if(row.stage==='进行中'&&config(row.event).workspaceSubmission&&!scheduledSession(row.event)){
      const loading=workspaceLoading('正在加载参与名单…');pane.append(loading);
      const base=`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}`;
      const reload=()=>request(`${base}/detail`);
      const loadReview=async()=>(await request(`${base}/running-review`)).result;
      // The roster must not wait on the review snapshot: a slow or failed
      // auxiliary read only degrades the review pane, never the whole detail.
      void reload().then(data=>{
        if(disposed||sequence!==detailSequence)return;loading.remove();
        editor=activityRunningWorkspace({adminEditInformation:getSessionState().user?.role==='super_admin'?()=>editAdminActivityInformation(row.event,load):undefined,event:data.events.find(event=>event._id===row.id)||row.event,data,actionsNode:moreActions(row),reload,loadReview,
          decideLeave:(id,approved,reason)=>request(`/api/volunteer/workflow/registrations/${encodeURIComponent(id)}/${approved?'leave-approve':'leave-reject'}`,{method:'POST',body:{reason}}),
          saveReview:body=>request(`${base}/running-review`,{method:'PATCH',body}),
          importFile:async body=>(await request(`${base}/running-import`,{method:'POST',body})).result,
          previewReview:async body=>(await request(`${base}/running-preview`,{method:'POST',body})).result,
          submitReview:body=>request(`${base}/running-submit`,{method:'POST',body}),
          reopenReview:reason=>request(`${base}/running-reopen`,{method:'PATCH',body:{reason}}),
          templateUrl:`${base}/running-template`,
          reopen:reason=>request(`${base}/reopen-registration`,{method:'POST',body:{reason}}),
          loadInformation:async()=>(await request(`${base}/workspace-content`)).result,
          editInformation:onSaved=>activityLiveInformation({loadProjectPeopleOptions,load:async()=>(await request(`${base}/workspace-content`)).result,save:body=>request(`${base}/workspace-content`,{method:'PATCH',body}),loadResponsibleOptions:async params=>(await request(`${root}/responsible-options?${new URLSearchParams(params)}`,{fresh:true})).options,loadResponsibleProfile:async params=>(await request(`${root}/responsible-profile?${new URLSearchParams(params)}`,{fresh:true})).profile,onSaved}),
          loadAttendance:id=>request(`/api/volunteer/workflow/registrations/${encodeURIComponent(id)}/attendance-detail`),
          onChanged:next=>{events=events.map(event=>next.events.find(item=>item._id===event._id)||event);renderList();if(workspaceStage(next.events.find(item=>item._id===row.id)||row.event)!=='进行中')renderDetail();},
        });pane.append(editor.node);
        void loadReview().then(reviewState=>{if(!disposed&&sequence===detailSequence)editor.applyReview(reviewState);}).catch(error=>{/* 静默会让「点不动」无从排查：把原因交给工作区自己显示。 */if(!disposed&&sequence===detailSequence)editor.applyReview({entries:[],canRecord:false,canRecordReason:error?.message||'初审状态加载失败，请刷新重试'});});
      }).catch(error=>{if(!disposed&&sequence===detailSequence)loading.replaceWith(notice(error.message||'参与名单加载失败',{tone:'warning'}));});
    }else if(['时长审核','已结束'].includes(row.stage)&&config(row.event).workspaceSubmission&&!scheduledSession(row.event)){
      const loading=workspaceLoading('正在加载分工时长表…');pane.append(loading);
      const base=`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}`,loadSheet=async options=>(await request(`${base}/final-hours`,options?.fresh?{fresh:true}:{})).result;
      void loadSheet().then(initial=>{
        if(disposed||sequence!==detailSequence)return;loading.remove();
        editor=activityFinalHoursWorkspace({adminEditInformation:getSessionState().user?.role==='super_admin'?()=>editAdminActivityInformation(row.event,load):undefined,initial,load:loadSheet,actionsNode:moreActions(row),
          openPosting:getSessionState().user?.role==='super_admin'?()=>openHoursSync():null,
          postingAction:getSessionState().user?.role==='super_admin'?body=>request(`${base}/hours-posting`,{method:'POST',body}):null,
          save:body=>request(`${base}/final-hours`,{method:'PATCH',body}),exportFile:body=>request(`${base}/final-hours-export`,{method:'POST',body}),
          addParticipant:body=>request(`${base}/final-hours-participants`,{method:'POST',body}),
          retryMail:()=>request(`${base}/final-hours-mail`,{method:'POST',body:{}}),downloadUrl:`${base}/final-hours-download`,
          loadInformation:async()=>(await request(`${base}/workspace-content`)).result,
          onChanged:state=>{if(row.stage!=='已结束'&&state.status==='exported')void load();},
        });pane.append(editor.node);
      }).catch(error=>{if(!disposed&&sequence===detailSequence){
        loading.remove();const view=button({label:'活动信息查看',onClick:async()=>{try{const result=(await request(`${base}/workspace-content`)).result;if(!disposed&&sequence===detailSequence)openModal({title:'活动信息',width:1100,body:activityInformationPreview(result),footer:[]});}catch(error){reportError(error,'活动信息加载失败');}}});
        pane.append(h('div',{class:'activity-registration-workspace'},h('div',{class:'activity-draft-toolbar'},view,button({label:'活动信息修改',disabled:getSessionState().user?.role!=='super_admin',onClick:()=>editAdminActivityInformation(row.event,load)}),button({label:row.stage==='已结束'?'下载时长表':'预览并导出',disabled:true}),moreActions(row)),h('div',{class:'activity-registration-content'},notice(error.message||'时长表加载失败',{tone:'warning'}))));
      }});
    }else{
      const loading=workspaceLoading('正在加载历史活动工作区…');pane.append(loading);
      const base=`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}/detail`;
      void Promise.all([request(base),import('./legacy-activity-workspace.js')]).then(([data,{legacyActivityWorkspace}])=>{
        if(disposed||sequence!==detailSequence)return;loading.remove();
        const current=data.events.find(event=>event._id===row.id)||data.events[0]||row.event;
        // 保存后名称可能已变更：标题直接用详情结果更新，不等目录回源。
        if(current?.['活动名称'])heading.querySelector('h2').replaceChildren(config(current).source?.kind==='generated_blood'?'市血液献血车':activityRegionTitle(current['活动名称'],current));
        if(config(current).source?.kind==='generated_blood'){const label=stageLabel(activityStage(current,{ledger:data.ledger}));for(const item of heading.querySelectorAll('ol li')){const active=item.textContent===label;item.classList.toggle('is-current',active);if(active)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');}}
        editor=legacyActivityWorkspace({weekOptions:records().filter(item=>(scheduledSession(current)?scheduledSession(item.event)&&config(item.event).special.rootId===config(current).special.rootId:config(item.event||{}).source?.kind==='generated_blood')&&(context.query.get('history')==='1'?item.stage==='已结束':item.stage!=='已结束')).map(item=>({id:item.id,date:item.date,dates:item.sessions.map(e=>e['报名日期']).filter(Boolean)})),onWeekChange:id=>{const item=records().find(item=>item.id===id);if(item)void openActivity(item);},event:current,events:data.events,data,actionsNode:moreActions(row),onChanged:async()=>{await syncDirectory();const selectedRow=records().find(item=>item.id===selected);if(context.query.get('history')!=='1'&&selectedRow?.stage==='已结束'){selected='';resolveSelection();}renderDetail();}});
        pane.append(editor.node);
      }).catch(error=>{if(!disposed&&sequence===detailSequence)loading.replaceWith(notice(error.message||'历史活动加载失败',{tone:'warning'}));});
    }
  }
  function moreActions(row){
    let busy=false,pending=null;
    const generated=config(row.event||{}).source?.kind==='generated_blood';
    const copyButton=button({label:'复制为新活动',onClick:async()=>{
      if(busy||!await leave())return;busy=true;copyButton.disabled=true;
      pending||={requestId:crypto.randomUUID(),expectedVersion:row.draft?drafts.find(d=>d.id===row.id).version:String(events.find(e=>e._id===row.id)?.['申请版本']||row.event['申请版本']||'')};
      try{const result=(await request(row.draft?`${root}/${row.id}/copy`:`${root}/from-event/${encodeURIComponent(row.id)}/copy`,{method:'POST',body:pending})).result;if(disposed)return;
        drafts=[result,...drafts.filter(d=>d.id!==result.id)];selected=result.id;stage.control.value='草稿';search.control.value='';region.control.value='';syncCategories();category.control.value='';directoryCollapsed=false;workspace.classList.remove('is-directory-collapsed');renderList();renderDetail();list.scrollTop=0;notify.success('已复制为新草稿');
      }catch(error){if(!error.status||error.status>=500)notify.warning('复制结果待核对','再次操作将核对原复制请求。');else{pending=null;reportError(error,'复制未完成');}}
      finally{busy=false;copyButton.disabled=false;}
    }});
    const menu=h('div',{class:'activity-v2-more__menu'},copyButton);
    // 来源不一致时最终表可能无法加载，恢复入口仍须能从更多操作进入。
    if(row.event&&row.stage==='时长审核'&&config(row.event).workspaceSubmission&&(getSessionState().user?.role==='super_admin'||[row.event,...(row.sessions||[])].some(event=>eventResponsibleIds(event).includes(currentActor)))){
      const reopenReview=button({label:'重新打开初审',onClick:async()=>{
        if(busy||!await leave())return;
        const reason=field({label:'退回原因',required:true,multiline:true,maxlength:500});let modal,saving=false;
        const confirm=button({label:'确认退回',variant:'primary',onClick:async()=>{
          if(saving||!reason.control.reportValidity()||!reason.control.value.trim())return;
          saving=true;busy=true;confirm.disabled=true;
          try{
            await request(`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}/running-reopen`,{method:'PATCH',body:{reason:reason.control.value.trim()}});
            saving=false;await modal.close();stage.control.value='进行中';await load();notify.success('已重新打开初审，请核对发生变化的人员后重新预览提交');
          }catch(error){reportError(error,'退回初审未完成，请刷新核对');}
          finally{saving=false;busy=false;confirm.disabled=false;}
        }});
        modal=openModal({title:'重新打开时长初审',body:h('div',{class:'stack-3'},notice('已保存的审核明细保留；请重新核对来源发生变化的人员，完成后再次提交终审。已归档的活动不能退回。',{tone:'info'}),reason),footer:[button({label:'取消',onClick:()=>modal.close()}),confirm]});modal.setCloseGuard(()=>!saving);
      }});menu.append(reopenReview);
    }
    if(row.draft){
      const removeButton=button({label:'删除活动',disabled:!(row.draft.access?.canEdit??row.draft.ownerId===currentActor)||row.draft.stage!=='草稿'||Boolean(row.draft.submissionStatus),onClick:async()=>{
        if(busy||!await leave())return;
        busy=true;let modal,removing=false,removal=null;
        const cancel=button({label:'取消',onClick:()=>{if(!removing&&!removal)void modal.close();}});
        const confirm=button({label:'删除活动',variant:'primary',onClick:async()=>{
          if(removing)return;removing=true;busy=true;confirm.disabled=true;cancel.disabled=true;
          removal||={requestId:crypto.randomUUID(),expectedVersion:drafts.find(d=>d.id===row.id)?.version};
          try{await request(`${root}/${row.id}/remove`,{method:'POST',body:removal});removing=false;removal=null;await modal.close();if(disposed)return;
            drafts=drafts.filter(d=>d.id!==row.id);selected='';renderList();renderDetail();notify.success('活动草稿已删除');
          }catch(error){if(!error.status||error.status>=500){confirm.textContent='核对删除结果';notify.warning('删除结果待核对','请点击核对删除结果。');}else{removal=null;reportError(error,'删除未完成');}}
          finally{removing=false;busy=false;confirm.disabled=false;cancel.disabled=Boolean(removal);}
        }});
        modal=openModal({title:'删除活动草稿？',body:h('p',{text:`“${row.name}”将从活动目录移除，已保存的内容会保留备份。`}),dismissible:false,onClose:()=>{busy=false;},footer:[cancel,confirm]});modal.setCloseGuard(()=>!removing&&!removal);
      }});menu.append(removeButton);if(row.draft.submissionStatus)menu.append(h('p',{class:'t-caption',text:'提交结果待核对，请先核对提交结果。未生成正式活动时，可由负责人或超管恢复为可编辑草稿。'}));
    }
    const details=h('details',{class:'activity-v2-more'},h('summary',{},h('span',{text:'更多操作'}),h('span',{class:'activity-v2-more__chevron','aria-hidden':'true'})),menu);
    if(row.event&&row.stage!=='已结束'&&!generated){
      let state=null,loading=false;
      const removalStatus=h('p',{class:'t-caption',role:'status',hidden:true});
      const removeButton=button({label:'取消活动',onClick:async()=>{
        if(busy||!state?.canRemove||!await leave())return;busy=true;
        const reason=field({label:'原因（选填）',type:'textarea',maxlength:500});let modal,removing=false,pendingRemoval=null;
        const cancel=button({label:'取消',onClick:()=>{if(!removing&&!pendingRemoval)void modal.close();}});
        // mode: delete＝取消活动并清除该活动全部参与记录；end＝只提前结束，记录保留且可恢复。
        const run=mode=>async()=>{
          if(removing)return;removing=true;confirm.disabled=true;endOnly.disabled=true;cancel.disabled=true;reason.control.disabled=true;
          pendingRemoval||={token:state.token,requestId:crypto.randomUUID(),reason:reason.control.value,mode};
          try{            await request(`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}/workspace-removal`,{method:'POST',body:pendingRemoval});removing=false;pendingRemoval=null;await modal.close();if(disposed)return;
            // Reload the complete project so sibling sessions cannot leave a stale activity card.
            selected='';await load();notify.success(mode==='delete'?'活动已取消':'活动已提前结束');
          }catch(error){if(!error.status||error.status>=500){confirm.textContent='核对操作结果';endOnly.hidden=true;notify.warning('操作结果待核对','请点击核对操作结果。');}else{pendingRemoval=null;state=null;removeButton.disabled=true;confirm.disabled=true;endOnly.disabled=true;reportError(error,'操作未完成，请关闭后重新打开更多操作');}}
          finally{removing=false;confirm.disabled=!state;endOnly.disabled=!state;cancel.disabled=Boolean(pendingRemoval);reason.control.disabled=Boolean(pendingRemoval);}
        };
        const confirm=button({label:state.sourceManaged?'结束项目':'取消活动并删除记录',variant:'primary',onClick:run(state.sourceManaged?'end':'delete')});
        const endOnly=button({label:'仅结束，保留记录',onClick:run('end')});
        // 取消活动会连报名、签到、时长明细一起删掉，确认前必须把数量说清楚。
        const counts=state.purgeCounts;
        const purgeNote=counts&&(counts.registrations||counts.checkins||counts.ledger)
          ?h('p',{class:'t-caption',text:`该活动的 ${counts.registrations} 条报名、${counts.checkins} 条签到、${counts.ledger} 条时长明细会一并删除，且无法恢复。`})
          :null;
        modal=openModal({title:state.sourceManaged?'结束项目？':'取消活动？',body:h('div',{},h('p',{text:state.sourceManaged?`结束“${row.name}”整个排班项目？当前项目的全部场次将关闭，后续源表刷新不会重新开放。报名、签到和时长记录保留。`:`“${row.name}”将被取消并从活动目录移除。`}),...(purgeNote?[purgeNote]:[]),reason),dismissible:false,onClose:()=>{busy=false;},footer:state.sourceManaged?[cancel,confirm]:[cancel,endOnly,confirm]});modal.setCloseGuard(()=>!removing&&!pendingRemoval);
      }});removeButton.disabled=true;menu.append(removeButton,removalStatus);
      details.addEventListener('toggle',async()=>{
        if(!details.open||loading||busy)return;loading=true;removeButton.disabled=true;removalStatus.hidden=false;removalStatus.textContent='正在核验结束权限…';
        try{state=(await request(`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}/workspace-removal`,{fresh:true})).result;if(disposed||!details.isConnected)return;removeButton.textContent='取消活动';removeButton.disabled=!state.canRemove;removeButton.title=state.reason||'';removalStatus.textContent=state.reason||'';removalStatus.hidden=Boolean(state.canRemove);}
        catch(error){state=null;if(!disposed&&details.isConnected){removalStatus.hidden=false;removalStatus.textContent=error.message||'操作权限加载失败，请关闭菜单后重试';reportError(error,'操作权限加载失败');}}finally{loading=false;}
      });
    }
    if(generated)copyButton.hidden=true;
    if(row.event&&['草稿','待审批','报名中'].includes(row.stage)){const contact=button({label:'通知信息编辑',onClick:()=>editRegistrationContact(row.id).catch(error=>reportError(error,'联系信息加载失败'))});return h('div',{class:'activity-contact-actions'},contact,details);}
    return details;
  }
  // 模块间往返走 30 秒读缓存（写入会自动失效）；"刷新"按钮传 fresh:true 强制回源。
  async function runLoad({fresh=false}={}){
    const sequence=++loadSequence;
    const [catalogResult,draftResult,capabilityResult]=await Promise.allSettled([
      request('/api/volunteer/workflow/catalog',{fresh}),
      request(root,{fresh}),
      request(`${root}/capabilities`,{fresh}),
    ]);
    if(disposed||sequence!==loadSequence)return;
    if(catalogResult.status==='rejected'){
      message.replaceChildren(notice(catalogResult.reason?.message||'活动目录加载失败，请稍后重试',{tone:'warning'}));
      if(!events.length&&!drafts.length){node.dataset.mobileView='list';list.replaceChildren(emptyState({title:'活动列表暂时无法加载',description:'请点击刷新重试。'}));}
      return;
    }
    events=catalogResult.value.events||[];
    const draftPayload=draftResult.status==='fulfilled'?draftResult.value:null;
    const capabilities=capabilityResult.status==='fulfilled'?capabilityResult.value.capabilities:null;
    drafts=draftPayload?.drafts||[];
    canSubmit=draftPayload?.capabilities?.canSubmit===true||capabilities?.canSubmit===true;
    creationScopes=Array.isArray(capabilities?.creationScopes)?capabilities.creationScopes:null;
    canCreate=Boolean(draftPayload)&&capabilities?.enabled!==false&&(capabilities?.canCreate??catalogResult.value.canManageActivities!==false);
    const notices=[];
    if(!draftPayload&&catalogResult.value.canManageActivities!==false)notices.push(notice('新版草稿服务暂不可用；全部历史活动仍可在当前工作区管理。',{tone:'warning'}));
    else if(capabilities?.rosterAvailable===false)notices.push(notice('新版地区负责人名单尚未配置：可以新建并保存草稿，暂不能提交审批；现有活动仍可正常管理。',{tone:'warning'}));
    message.replaceChildren(...notices);
    for(const control of tools.querySelectorAll('button,a'))if(catalogResult.value.canManageActivities===false){if(control.tagName==='BUTTON')control.disabled=true;else{control.removeAttribute('href');control.setAttribute('aria-disabled','true');}}
    createButton.disabled=!canCreate;
    createButton.title=canCreate?'':capabilities?.canCreate===false?'当前账号未配置可创建的中心权限':'新版草稿服务暂不可用';
    resolveSelection();
    renderList();renderDetail();
    warmLegacyWorkspace();
    if(mobile.matches&&!selected&&directoryState){node.scrollTop=directoryState.scrollTop||0;[...list.querySelectorAll('button')].find(card=>card.dataset.record===directoryState.focusId)?.focus({preventScroll:true});}
  }
  /**
   * 目录刷新后项目的代表记录可能变化（多场次项目按排班重新聚合），
   * 因此每次拿到新的目录都要重新解析当前选中项，否则面板会找不到活动。
   */
  function resolveSelection(){
    const all=records();
    const available=all.filter(row=>context.query.get('history')==='1'?row.stage==='已结束':row.stage!=='已结束'||stage.control.value==='已结束');
    if(!selected&&!mobile.matches)selected=available[0]?.id||'';
    const linkedDraft=drafts.find(d=>d.id===selected),linkedEvent=events.find(e=>e['活动ID']===linkedDraft?.activityId);
    if(linkedEvent)selected=linkedEvent._id;
    // Hiding ended directory cards must not discard an open detail or a direct link.
    const requested=all.find(row=>row.id===selected||row.sessions?.some(session=>session._id===selected));
    if(requested)selected=requested.id;
    if(!all.some(row=>row.id===selected))selected=mobile.matches?'':available[0]?.id||'';
    return available;
  }
  // 连续操作会同时触发多次刷新：合并成一轮请求，避免重复回源与重复渲染。
  let pendingLoad=null;
  function load({fresh=false}={}){
    if(pendingLoad&&!fresh)return pendingLoad;
    pendingLoad=runLoad({fresh}).finally(()=>{pendingLoad=null;});
    return pendingLoad;
  }
  /** 只同步左侧目录：面板内操作后更新列表行，不重建当前工作区。 */
  async function syncDirectory(){
    try{
      const result=await request('/api/volunteer/workflow/catalog');
      if(disposed)return;
      events=result.events||[];resolveSelection();renderList();
    }catch{/* 目录同步失败不打断当前操作，列表会在下次进入时刷新。 */}
  }
  function create(){
    rememberDirectory();
    const name=field({label:'活动名称',required:true,maxlength:500}),area=field({label:'活动地区',required:true,options:[{value:'',label:'请选择'},{value:'nanjing',label:'南京地区'},{value:'suzhou',label:'苏州地区'}]}),kind=field({label:'活动类别',required:true,options:[{value:'',label:'请先选择地区'}]}),requestId=crypto.randomUUID();let modal,busy=false;
    if(creationScopes)for(const option of [...area.control.options])if(option.value)option.disabled=!creationScopes.some(scope=>scope.region===option.value);
    kind.control.disabled=true;area.control.addEventListener('change',()=>{kind.control.disabled=!area.control.value;kind.control.replaceChildren(h('option',{value:'',text:'请选择'}),...workspaceCategories(area.control.value).filter(value=>!creationScopes||creationScopes.some(scope=>scope.region===area.control.value&&scope.category===value)).map(value=>h('option',{value,text:value})));kind.control.value='';});
    const createButton=button({label:'开始填写',variant:'primary',onClick:async()=>{
      if(busy||!name.control.reportValidity()||!area.control.reportValidity()||!kind.control.reportValidity()||!await leave())return;if(isManagedDutyContent({name:name.control.value,category:kind.control.value})){notify.warning('请在管理员中心开启省红会组宣部值班，无需新建草稿');return;}busy=true;createButton.disabled=true;
      try{const result=(await request(root,{method:'POST',body:{requestId,content:{name:name.control.value,region:area.control.value,category:kind.control.value,...(kind.control.value==='排班专项'?{bookingMode:'grouped',special:{v:1,type:'schedule',dates:[],places:[],cutoffMinutes:1440}}:{})}}})).result;busy=false;await modal.close();if(disposed)return;drafts.unshift(result);selected=result.id;stage.control.value='草稿';search.control.value='';region.control.value='';syncCategories();category.control.value='';directoryCollapsed=false;workspace.classList.remove('is-directory-collapsed');renderList();renderDetail();list.scrollTop=0;}
      catch(error){if(!error.status||error.status>=500){name.control.disabled=area.control.disabled=kind.control.disabled=true;createButton.textContent='核对创建结果';notify.warning('创建结果待核对','再次操作会使用原请求标识核对，不会另建草稿。');}else reportError(error,'创建未完成');}
      finally{busy=false;createButton.disabled=false;sourceButton.disabled=name.control.disabled;}
    }});
    const syncCreate=()=>{createButton.disabled=busy||!name.control.value.trim()||!area.control.value||!kind.control.value;};name.control.addEventListener('input',syncCreate);area.control.addEventListener('change',syncCreate);kind.control.addEventListener('change',syncCreate);syncCreate();
    const sourceButton=button({label:'来源活动纳入',variant:'secondary',onClick:async()=>{
      if(busy||name.control.disabled||!await leave())return;
      busy=true;sourceButton.disabled=true;
      try{const {openSourceIntake}=await import('./activity-source-intake.js');busy=false;await modal.close();await openSourceIntake({events,onAdopted:async result=>{selected=result._id;stage.control.value='';await load();}});}
      catch(error){reportError(error,'来源活动暂时无法打开');}
      finally{busy=false;sourceButton.disabled=name.control.disabled;}
    }});
    const names=h('datalist',{id:'new-schedule-names-'+crypto.randomUUID()},h('option',{value:'校医院体检'}),h('option',{value:'校医院疫苗接种'}));kind.control.addEventListener('change',()=>{if(kind.control.value==='排班专项')name.control.setAttribute('list',names.id);else name.control.removeAttribute('list');});
    modal=openModal({title:'新建活动',body:h('div',{class:'stack-3'},name,names,area,kind),dismissible:false,footer:[sourceButton,button({label:'取消',onClick:()=>{if(!busy)void modal.close();}}),createButton]});
    modal.setCloseGuard(()=>!busy);
  }
  const workspace=h('div',{class:'activity-v2-workspace'},h('aside',{class:'activity-v2-directory'},h('div',{class:'row-between'},h('h2',{text:'活动列表'}),count),search,h('div',{class:'activity-v2-filters'},stage,region,category),list),pane);
  const createButton=button({label:'新建活动',variant:'primary',onClick:create});
  const tools=h('details',{class:'activity-page-tools'},h('summary',{text:'管理工具'}),h('div',{},
   button({label:'服务记录核对',href:'/console/volunteers',variant:'ghost'})));
  tools.open=!mobile.matches;
  const node=h('div',{class:'view wspad activity-v2'},pageHead({title:'活动管理',actions:[tools,createButton,button({label:'刷新',onClick:async()=>{if(await leave())await load({fresh:true});}})]}),message,workspace);
  if(mobile.matches&&directoryState){search.control.value=directoryState.search;stage.control.value=directoryState.stage;region.control.value=directoryState.region;syncCategories();category.control.value=directoryState.category;}
  syncLayout();mobile.addEventListener('change',resizeLayout);
  list.append(...Array.from({length:3},()=>h('div',{class:'activity-v2-card activity-v2-card--skeleton','aria-hidden':'true'},h('strong',{class:'sk sk--line sk-w-70'}),h('span',{class:'sk sk--line sk-w-40'}))));
  void load();return {title:'活动管理',crumb:'活动管理',node,dispose:()=>{rememberDirectory();disposed=true;loadSequence++;clearTimeout(searchDebounce);editor?.dispose();release();mobile.removeEventListener('change',resizeLayout);window.removeEventListener('beforeunload',beforeUnload);}};
}
