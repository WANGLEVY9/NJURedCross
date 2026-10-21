import {canonicalActivityCategory} from '../../shared/activity-taxonomy.js';
import {activityLiveInformation} from './activity-live-information.js';
import {activityRunningWorkspace} from './activity-running-workspace.js';
import {activityFinalHoursWorkspace} from './activity-final-hours-workspace.js';
import {activityInformationPreview} from './activity-information-preview.js';
import {registrationCapacity} from '../../shared/activity-registration.js';
import {activityApprovalWorkspace} from './activity-approval-workspace.js';
import {activityRegistrationWorkspace} from './activity-registration-workspace.js';
import {h} from '../../core/dom.js';
import {request,getSessionState} from '../../core/api.js';
import {setLeaveGuard,patchQuery} from '../../core/router.js';
import {pageHead,button,field,notice,emptyState} from '../../ui/primitives.js';
import {openModal,confirmAction} from '../../ui/overlay.js';
import {notify,reportError} from '../../core/toast.js';
import {workspaceCategories,WORKSPACE_STAGES,workspaceStage} from '../../shared/activity-workspace.js';
import {activityDraftWorkspace} from './activity-draft-workspace.js';
import {activityStage,stageLabel} from '../../shared/activity-stage.js';
import {activityProjects} from '../../shared/activity-projects.js';
import {configureActivityApprovers} from './activity-approval.js';
import {configureWorkspaceRoles} from './activity-role-settings.js';
const root='/api/volunteer/workflow/workspace-drafts';
const config=row=>{try{return JSON.parse(row['报名页配置']||'{}');}catch{return {};}};

/** Rebuilt activity management. Every phase operates inside the selected project pane. */
export default async function activityWorkspacePage(context){
  let drafts=[],events=[],selected=context.query.get('draft')||context.query.get('event')||'',editor=null,disposed=false,loadSequence=0,detailSequence=0,canSubmit=false,canCreate=true;
  const occupancy=new Map();
  const list=h('div',{class:'activity-v2-list'}),pane=h('section',{class:'activity-v2-detail','aria-label':'活动操作工作区'}),message=h('div',{class:'activity-v2-message'}),count=h('span',{class:'t-caption'});
  let directoryCollapsed=false;
  function toggleDirectory(){directoryCollapsed=!directoryCollapsed;workspace.classList.toggle('is-directory-collapsed',directoryCollapsed);for(const control of pane.querySelectorAll('.activity-v2-collapse')){control.textContent=directoryCollapsed?'›':'‹';control.setAttribute('aria-label',directoryCollapsed?'展开活动列表':'收起活动列表');control.setAttribute('aria-expanded',String(!directoryCollapsed));}}
  const currentActor=getSessionState().user?.accountId||getSessionState().user?.username;
  const search=field({label:'搜索活动',type:'search',placeholder:'搜索活动名称',onInput:renderList});
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
    const projectRows=activityProjects(events.filter(event=>event['状态']!=='已归档')).map(project=>{
      const c=config(project),legacy=activityStage(project);
      const stage=config(project).workspaceSubmission?workspaceStage(project):['approval','ready'].includes(legacy)?'待审批':stageLabel(legacy);
      return {
        id:project._id,
        name:project.projectName||project['活动名称'],
        stage,
        statusLabel:config(project).workspaceSubmission?stage:legacy==='approval'?'待审核':legacy==='ready'?'待发布':stageLabel(legacy),
        region:project['活动地区']==='苏州地区'||c.region==='苏州活动'?'suzhou':'nanjing',
        category:canonicalActivityCategory(project['组织类别']||c.center),
        date:project['报名日期'],
        event:project,
        sessions:project.sessions||[project],
      };
    });
    return [...drafts.filter(d=>!events.some(e=>e['活动ID']===d.activityId)).map(d=>({id:d.id,name:d.content.name,stage:d.stage,statusLabel:d.stage,region:d.content.region,category:canonicalActivityCategory(d.content.category),date:d.content.date,endDate:d.content.endDate,draft:d})),...projectRows];
  }
  function renderList(){
    const rows=records().filter(r=>(!search.control.value||r.name?.includes(search.control.value))&&(!stage.control.value||r.stage===stage.control.value)&&(!region.control.value||r.region===region.control.value)&&(!category.control.value||r.category===category.control.value));
    count.textContent=`${rows.length} 项`;list.replaceChildren(...rows.map(row=>h('button',{type:'button',class:'activity-v2-card',data:{region:row.region||'',category:row.category||'',sessions:String(row.sessions?.length||1)},aria:{pressed:String(row.id===selected)},on:{click:async()=>{if(row.id===selected)return;if(!await leave())return;selected=row.id;renderList();renderDetail();}}},h('strong',{text:row.name}),h('span',{class:'row-between'},h('span',{class:'activity-v2-badge',text:row.stage==='报名中'&&occupancy.get(row.id)?'报名中 · 报名已满':row.statusLabel||row.stage||'未分类'}),row.sessions?.length>1?h('small',{class:'t-caption',text:`${row.sessions.length} 个场次`}):null))));
    if(!rows.length)list.append(emptyState({title:'没有符合条件的活动',description:'调整筛选或新建活动。'}));
  }
  function renderDetail(){
    const sequence=++detailSequence;editor?.dispose();editor=null;pane.replaceChildren();const row=records().find(r=>r.id===selected);
    patchQuery({draft:row?.draft?row.id:null,event:row?.event?row.id:null});
    if(!row){pane.append(emptyState({title:'选择活动开始管理'}));return;}
    const heading=h('header',{class:'activity-v2-heading'},button({label:directoryCollapsed?'›':'‹',variant:'ghost',onClick:toggleDirectory}),h('h2',{text:row.name}),h('ol',{'aria-label':'活动阶段'},...WORKSPACE_STAGES.map(text=>h('li',{text,class:text===row.stage?'is-current':'','aria-current':text===row.stage?'step':null}))));pane.append(heading);const collapse=heading.querySelector('button');collapse.classList.add('activity-v2-collapse');collapse.setAttribute('aria-label',directoryCollapsed?'展开活动列表':'收起活动列表');collapse.setAttribute('aria-expanded',String(!directoryCollapsed));
    if(row.draft){
      editor=activityDraftWorkspace({initial:row.draft,editable:(row.draft.access?.canEdit??row.draft.ownerId===currentActor)&&row.draft.stage==='草稿'&&!row.draft.submissionStatus,allowSubmit:canSubmit,
        actionsNode:moreActions(row),
        loadResponsibleOptions:async params=>(await request(`${root}/responsible-options?${new URLSearchParams(params)}`,{fresh:true})).options,
        loadResponsibleProfile:async params=>(await request(`${root}/responsible-profile?${new URLSearchParams(params)}`,{fresh:true})).profile,
        save:async({id,expectedVersion,content})=>{const result=(await request(`${root}/${id}`,{method:'PATCH',body:{expectedVersion,content}})).result;drafts=drafts.map(d=>d.id===result.id?result:d);renderList();heading.querySelector('h2').textContent=result.content.name;return result;},
        preview:async(id,body)=>(await request(`${root}/${id}/preview`,{method:'POST',body})).result,
        confirmPreview:async(id,body)=>(await request(`${root}/${id}/confirm-preview`,{method:'POST',body})).result,
        submit:async(id,body)=>(await request(`${root}/${id}/submit`,{method:'POST',body})).result,
        onSubmitted:async()=>{stage.control.value='待审批';const savedId=row.id;await load();const draft=drafts.find(d=>d.id===savedId),formal=events.find(e=>e['活动ID']===draft?.activityId);if(formal){selected=formal._id;renderList();renderDetail();}notify.success('已提交审批');},
      });pane.append(editor.node);
      if(row.draft.submissionStatus==='pending'&&row.draft.submissionRequest&&canSubmit){
        const reconcile=button({label:'核对提交结果',onClick:async()=>{if(reconcile.disabled)return;reconcile.disabled=true;try{await request(`${root}/${row.id}/submit`,{method:'POST',body:row.draft.submissionRequest});await load();}catch(error){reportError(error,'提交结果仍待核对');}finally{reconcile.disabled=false;}}});
        editor.node.querySelector('.activity-draft-toolbar').append(reconcile);
      }

    }else if(['待审批','草稿'].includes(row.stage)&&config(row.event).workspaceSubmission){
      const loading=h('p',{class:'t-caption',text:'正在加载活动信息…'});pane.append(loading);
      const base=`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}`;
      const loadContent=async()=>(await request(`${base}/workspace-content`,{fresh:true})).result;
      void Promise.all([request(`${base}/detail`,{fresh:true}),loadContent()]).then(([data,content])=>{
        if(disposed||sequence!==detailSequence)return;loading.remove();
        editor=activityApprovalWorkspace({event:data.events.find(e=>e._id===row.id),content,actionsNode:moreActions(row),loadContent,
          save:body=>request(`${base}/workspace-content`,{method:'PATCH',body}),
          mutate:(action,body)=>request(`${base}/${action}`,{method:'POST',body}),
          loadResponsibleOptions:async params=>(await request(`${root}/responsible-options?${new URLSearchParams(params)}`,{fresh:true})).options,
          loadResponsibleProfile:async params=>(await request(`${root}/responsible-profile?${new URLSearchParams(params)}`,{fresh:true})).profile,
          onChanged:async()=>{stage.control.value='';await load();},
        });pane.append(editor.node);
      }).catch(error=>{if(!disposed&&sequence===detailSequence)loading.replaceWith(notice(error.message||'活动信息加载失败',{tone:'warning'}));});
    }else if(row.stage==='报名中'&&config(row.event).approval?.mode==='workspace-regional'){
      const loading=h('p',{class:'t-caption',text:'正在加载报名名单…'});pane.append(loading);
      const detailUrl=`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}/detail`;
      const reload=()=>request(detailUrl,{fresh:true});
      void reload().then(data=>{
        if(disposed||sequence!==detailSequence)return;loading.remove();
        function changed(data){
          const jobs=data.events.filter(e=>config(e).bookingMode!=='grouped');occupancy.set(row.id,jobs.length>0&&jobs.every(e=>registrationCapacity(e,data.registrations).full));
          events=events.map(event=>data.events.find(next=>next._id===event._id)||event);renderList();
          const current=data.events.find(event=>event._id===row.id);if(current)heading.querySelector('h2').textContent=current['活动名称'];
          if(current?.['状态']!=='报名中')renderDetail();
        }
        const base=`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}`;
        const loadInformation=config(row.event).workspaceSubmission?async()=>(await request(`${base}/workspace-content`,{fresh:true})).result:undefined;
        changed(data);
        editor=activityRegistrationWorkspace({event:row.event,data,actionsNode:moreActions(row),reload,loadInformation,
          editInformation:loadInformation?onSaved=>activityLiveInformation({load:loadInformation,save:body=>request(`${base}/workspace-content`,{method:'PATCH',body}),loadResponsibleOptions:async params=>(await request(`${root}/responsible-options?${new URLSearchParams(params)}`,{fresh:true})).options,loadResponsibleProfile:async params=>(await request(`${root}/responsible-profile?${new URLSearchParams(params)}`,{fresh:true})).profile,onSaved}):undefined,
          loadMailStatuses:async events=>(await Promise.all(events.map(async event=>(await request(`/api/volunteer/workflow/events/${encodeURIComponent(event._id)}/mail-status`,{fresh:true})).items))).flat(),
          decide:(event,ids,decision,reason)=>request(`/api/volunteer/workflow/events/${encodeURIComponent(event._id)}/batch-decide`,{method:'POST',body:{ids,decision,reason,token:event.rosterToken,immediate:true}}),
          close:()=>request(`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}/close`,{method:'POST',body:{scope:'project'}}),
          onChanged:changed,
        });pane.append(editor.node);
      }).catch(error=>{if(!disposed&&sequence===detailSequence){loading.replaceWith(notice(error.message||'报名名单加载失败',{tone:'warning'}));}});
    }else if(row.stage==='进行中'&&config(row.event).workspaceSubmission){
      const loading=h('p',{class:'t-caption',text:'正在加载参与名单…'});pane.append(loading);
      const base=`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}`;
      const reload=()=>request(`${base}/detail`,{fresh:true});
      const loadReview=async()=>(await request(`${base}/running-review`,{fresh:true})).result;
      void Promise.all([reload(),loadReview()]).then(([data,reviewState])=>{
        if(disposed||sequence!==detailSequence)return;loading.remove();
        editor=activityRunningWorkspace({event:data.events.find(event=>event._id===row.id)||row.event,data,reviewState,actionsNode:moreActions(row),reload,loadReview,
          saveReview:body=>request(`${base}/running-review`,{method:'PATCH',body}),
          importFile:async body=>(await request(`${base}/running-import`,{method:'POST',body})).result,
          previewReview:async body=>(await request(`${base}/running-preview`,{method:'POST',body})).result,
          submitReview:body=>request(`${base}/running-submit`,{method:'POST',body}),
          reopen:reason=>request(`${base}/reopen-registration`,{method:'POST',body:{reason}}),
          loadInformation:async()=>(await request(`${base}/workspace-content`,{fresh:true})).result,
          editInformation:onSaved=>activityLiveInformation({load:async()=>(await request(`${base}/workspace-content`,{fresh:true})).result,save:body=>request(`${base}/workspace-content`,{method:'PATCH',body}),loadResponsibleOptions:async params=>(await request(`${root}/responsible-options?${new URLSearchParams(params)}`,{fresh:true})).options,loadResponsibleProfile:async params=>(await request(`${root}/responsible-profile?${new URLSearchParams(params)}`,{fresh:true})).profile,onSaved}),
          loadAttendance:id=>request(`/api/volunteer/workflow/registrations/${encodeURIComponent(id)}/attendance-detail`,{fresh:true}),
          onChanged:next=>{events=events.map(event=>next.events.find(item=>item._id===event._id)||event);renderList();if(workspaceStage(next.events.find(item=>item._id===row.id)||row.event)!=='进行中')renderDetail();},
        });pane.append(editor.node);
      }).catch(error=>{if(!disposed&&sequence===detailSequence)loading.replaceWith(notice(error.message||'参与名单加载失败',{tone:'warning'}));});
    }else if(['时长审核','已结束'].includes(row.stage)&&config(row.event).workspaceSubmission){
      const loading=h('p',{class:'t-caption',text:'正在加载分工时长表…'});pane.append(loading);
      const base=`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}`,loadSheet=async()=>(await request(`${base}/final-hours`,{fresh:true})).result;
      void loadSheet().then(initial=>{
        if(disposed||sequence!==detailSequence)return;loading.remove();
        editor=activityFinalHoursWorkspace({initial,load:loadSheet,actionsNode:moreActions(row),
          save:body=>request(`${base}/final-hours`,{method:'PATCH',body}),exportFile:body=>request(`${base}/final-hours-export`,{method:'POST',body}),
          retryMail:()=>request(`${base}/final-hours-mail`,{method:'POST',body:{}}),downloadUrl:`${base}/final-hours-download`,
          loadInformation:async()=>(await request(`${base}/workspace-content`,{fresh:true})).result,
          onChanged:state=>{if(row.stage!=='已结束'&&state.status==='exported')void load();},
        });pane.append(editor.node);
      }).catch(error=>{if(!disposed&&sequence===detailSequence){
        loading.remove();const view=button({label:'活动信息查看',onClick:async()=>{try{const result=(await request(`${base}/workspace-content`,{fresh:true})).result;if(!disposed&&sequence===detailSequence)openModal({title:'活动信息',width:1100,body:activityInformationPreview(result),footer:[]});}catch(error){reportError(error,'活动信息加载失败');}}});
        pane.append(h('div',{class:'activity-registration-workspace'},h('div',{class:'activity-draft-toolbar'},view,button({label:'活动信息修改',disabled:true}),button({label:row.stage==='已结束'?'下载时长表':'预览并导出',disabled:true}),moreActions(row)),h('div',{class:'activity-registration-content'},notice(error.message||'时长表加载失败',{tone:'warning'}))));
      }});
    }else{
      const loading=h('p',{class:'t-caption',text:'正在加载历史活动工作区…'});pane.append(loading);
      const base=`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}/detail`;
      void Promise.all([request(base,{fresh:true}),import('./legacy-activity-workspace.js')]).then(([data,{legacyActivityWorkspace}])=>{
        if(disposed||sequence!==detailSequence)return;loading.remove();
        const current=data.events.find(event=>event._id===row.id)||data.events[0]||row.event;
        editor=legacyActivityWorkspace({event:current,events:data.events,data,actionsNode:moreActions(row),onChanged:async()=>{await load();}});
        pane.append(editor.node);
      }).catch(error=>{if(!disposed&&sequence===detailSequence)loading.replaceWith(notice(error.message||'历史活动加载失败',{tone:'warning'}));});
    }
  }
  function moreActions(row){
    let busy=false,pending=null;
    const copyButton=button({label:'复制为新活动',onClick:async()=>{
      if(busy||!await leave())return;busy=true;copyButton.disabled=true;
      pending||={requestId:crypto.randomUUID(),expectedVersion:row.draft?drafts.find(d=>d.id===row.id).version:String(events.find(e=>e._id===row.id)?.['申请版本']||row.event['申请版本']||'')};
      try{const result=(await request(row.draft?`${root}/${row.id}/copy`:`${root}/from-event/${encodeURIComponent(row.id)}/copy`,{method:'POST',body:pending})).result;if(disposed)return;
        drafts=[result,...drafts.filter(d=>d.id!==result.id)];selected=result.id;stage.control.value='草稿';search.control.value='';region.control.value='';syncCategories();category.control.value='';directoryCollapsed=false;workspace.classList.remove('is-directory-collapsed');renderList();renderDetail();list.scrollTop=0;notify.success('已复制为新草稿');
      }catch(error){if(!error.status||error.status>=500)notify.warning('复制结果待核对','再次操作将核对原复制请求。');else{pending=null;reportError(error,'复制未完成');}}
      finally{busy=false;copyButton.disabled=false;}
    }});
    const menu=h('div',{class:'activity-v2-more__menu'},copyButton);
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
      }});menu.append(removeButton);
    }
    const details=h('details',{class:'activity-v2-more'},h('summary',{},h('span',{text:'更多操作'}),h('span',{class:'activity-v2-more__chevron','aria-hidden':'true'})),menu);
    if(row.event&&row.stage!=='已结束'){
      let state=null,loading=false;
      const removeButton=button({label:['草稿','待审批'].includes(row.stage)?'删除活动':'结束活动',onClick:async()=>{
        if(busy||!state?.canRemove||!await leave())return;busy=true;
        const action=state.action==='delete'?'删除活动':'结束活动',reason=field({label:'原因（选填）',type:'textarea',maxlength:500});let modal,removing=false,pendingRemoval=null;
        const cancel=button({label:'取消',onClick:()=>{if(!removing&&!pendingRemoval)void modal.close();}});
        const confirm=button({label:action,variant:'primary',onClick:async()=>{
          if(removing)return;removing=true;confirm.disabled=true;cancel.disabled=true;reason.control.disabled=true;
          pendingRemoval||={token:state.token,requestId:crypto.randomUUID(),reason:reason.control.value};
          try{await request(`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}/workspace-removal`,{method:'POST',body:pendingRemoval});removing=false;pendingRemoval=null;await modal.close();if(disposed)return;
            // Reload the complete project so sibling sessions cannot leave a stale activity card.
            await load();selected='';renderList();renderDetail();notify.success(state.action==='delete'?'活动已删除':'活动已提前结束');
          }catch(error){if(!error.status||error.status>=500){confirm.textContent='核对操作结果';notify.warning('操作结果待核对','请点击核对操作结果。');}else{pendingRemoval=null;state=null;removeButton.disabled=true;confirm.disabled=true;reportError(error,'操作未完成，请关闭后重新打开更多操作');}}
          finally{removing=false;confirm.disabled=!state;cancel.disabled=Boolean(pendingRemoval);reason.control.disabled=Boolean(pendingRemoval);}
        }});
        modal=openModal({title:`${action}？`,body:h('div',{},h('p',{text:state.sourceManaged?`结束“${row.name}”整个排班项目？当前项目的全部场次将关闭，后续源表刷新不会重新开放。报名、签到和时长记录保留。`:`“${row.name}”将从活动目录移除，岗位与参与记录保留备份。`}),reason),dismissible:false,onClose:()=>{busy=false;},footer:[cancel,confirm]});modal.setCloseGuard(()=>!removing&&!pendingRemoval);
      }});removeButton.disabled=true;menu.append(removeButton);
      details.addEventListener('toggle',async()=>{
        if(!details.open||loading||busy)return;loading=true;removeButton.disabled=true;
        try{state=(await request(`/api/volunteer/workflow/events/${encodeURIComponent(row.id)}/workspace-removal`,{fresh:true})).result;if(disposed||!details.isConnected)return;removeButton.textContent=state.action==='delete'?'删除活动':'结束活动';removeButton.disabled=!state.canRemove;removeButton.title=state.reason||'';}
        catch(error){state=null;if(!disposed&&details.isConnected)reportError(error,'操作权限加载失败');}finally{loading=false;}
      });
    }
    return details;
  }
  async function load(){
    const sequence=++loadSequence;
    const [catalogResult,draftResult,capabilityResult]=await Promise.allSettled([
      request('/api/volunteer/workflow/catalog',{fresh:true}),
      request(root,{fresh:true}),
      request(`${root}/capabilities`,{fresh:true}),
    ]);
    if(disposed||sequence!==loadSequence)return;
    if(catalogResult.status==='rejected'){
      message.replaceChildren(notice(catalogResult.reason?.message||'活动目录加载失败，请稍后重试',{tone:'warning'}));
      return;
    }
    events=catalogResult.value.events||[];
    const draftPayload=draftResult.status==='fulfilled'?draftResult.value:null;
    const capabilities=capabilityResult.status==='fulfilled'?capabilityResult.value.capabilities:null;
    drafts=draftPayload?.drafts||[];
    canSubmit=draftPayload?.capabilities?.canSubmit===true||capabilities?.canSubmit===true;
    canCreate=Boolean(draftPayload)&&capabilities?.enabled!==false;
    const notices=[];
    if(!draftPayload)notices.push(notice('新版草稿服务暂不可用；全部历史活动仍可在当前工作区管理。',{tone:'warning'}));
    else if(capabilities?.rosterAvailable===false)notices.push(notice('新版地区负责人名单尚未配置：可以新建并保存草稿，暂不能提交审批；现有活动仍可正常管理。',{tone:'warning'}));
    message.replaceChildren(...notices);
    createButton.disabled=!canCreate;
    createButton.title=canCreate?'':'新版草稿服务暂不可用';
    const available=records();
    if(!selected)selected=drafts[0]?.id||available[0]?.id||'';
    const linkedDraft=drafts.find(d=>d.id===selected),linkedEvent=events.find(e=>e['活动ID']===linkedDraft?.activityId);
    if(linkedEvent)selected=linkedEvent._id;
    const requested=available.find(row=>row.id===selected||row.sessions?.some(session=>session._id===selected));
    if(requested)selected=requested.id;
    if(!available.some(row=>row.id===selected))selected=available[0]?.id||'';
    renderList();renderDetail();
  }
  function create(){
    const name=field({label:'活动名称',required:true,maxlength:500}),area=field({label:'活动地区',required:true,options:[{value:'',label:'请选择'},{value:'nanjing',label:'南京地区'},{value:'suzhou',label:'苏州地区'}]}),kind=field({label:'活动类别',required:true,options:[{value:'',label:'请先选择地区'}]}),requestId=crypto.randomUUID();let modal,busy=false;
    kind.control.disabled=true;area.control.addEventListener('change',()=>{kind.control.disabled=!area.control.value;kind.control.replaceChildren(h('option',{value:'',text:'请选择'}),...workspaceCategories(area.control.value).map(value=>h('option',{value,text:value})));kind.control.value='';});
    const createButton=button({label:'开始填写',variant:'primary',onClick:async()=>{
      if(busy||!name.control.reportValidity()||!area.control.reportValidity()||!kind.control.reportValidity()||!await leave())return;busy=true;createButton.disabled=true;
      try{const result=(await request(root,{method:'POST',body:{requestId,content:{name:name.control.value,region:area.control.value,category:kind.control.value}}})).result;busy=false;await modal.close();if(disposed)return;drafts.unshift(result);selected=result.id;stage.control.value='草稿';search.control.value='';region.control.value='';syncCategories();category.control.value='';directoryCollapsed=false;workspace.classList.remove('is-directory-collapsed');renderList();renderDetail();list.scrollTop=0;}
      catch(error){if(!error.status||error.status>=500){name.control.disabled=area.control.disabled=kind.control.disabled=true;createButton.textContent='核对创建结果';notify.warning('创建结果待核对','再次操作会使用原请求标识核对，不会另建草稿。');}else reportError(error,'创建未完成');}
      finally{busy=false;createButton.disabled=false;}
    }});
    const syncCreate=()=>{createButton.disabled=busy||!name.control.value.trim()||!area.control.value||!kind.control.value;};name.control.addEventListener('input',syncCreate);area.control.addEventListener('change',syncCreate);kind.control.addEventListener('change',syncCreate);syncCreate();
    modal=openModal({title:'新建活动',body:h('div',{class:'stack-3'},name,area,kind),dismissible:false,footer:[button({label:'取消',onClick:()=>{if(!busy)void modal.close();}}),createButton]});
    modal.setCloseGuard(()=>!busy);
  }
  const workspace=h('div',{class:'activity-v2-workspace'},h('aside',{class:'activity-v2-directory'},h('div',{class:'row-between'},h('h2',{text:'活动目录'}),count),search,h('div',{class:'activity-v2-filters'},stage,region,category),list),pane);
  const createButton=button({label:'新建活动',variant:'primary',onClick:create});
  const tools=h('details',{class:'activity-page-tools'},h('summary',{text:'管理工具'}),h('div',{},
   ...(getSessionState().user?.role==='super_admin'?[button({label:'活动权限与负责人配置',onClick:()=>configureWorkspaceRoles(load)})]:[]),
   button({label:'献血车排班',onClick:async()=>{const {openScheduleSource}=await import('./activity-schedule-source.js');await openScheduleSource(async()=>{if(await leave())await load();});}}),
   button({label:'来源活动纳入',onClick:async()=>{const {openSourceIntake}=await import('./activity-source-intake.js');await openSourceIntake({events,onAdopted:async result=>{selected=result._id;stage.control.value='';await load();}});}}),
   button({label:'历史活动审核人配置',onClick:()=>configureActivityApprovers(load)}),
   button({label:'服务记录核对',href:'/console/volunteers',variant:'ghost'})));
  tools.open=!window.matchMedia('(max-width:800px)').matches;
  const node=h('div',{class:'view wspad activity-v2'},pageHead({title:'活动管理',actions:[tools,createButton,button({label:'刷新',onClick:async()=>{if(await leave())await load();}})]}),message,workspace);
  void load();return {title:'活动管理',crumb:'活动管理',node,dispose:()=>{disposed=true;loadSequence++;editor?.dispose();release();window.removeEventListener('beforeunload',beforeUnload);}};
}
