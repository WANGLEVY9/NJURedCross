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
import {pageHead,button,field,notice,emptyState,definitionList} from '../../ui/primitives.js';
import {openModal,confirmAction} from '../../ui/overlay.js';
import {notify,reportError} from '../../core/toast.js';
import {workspaceCategories,WORKSPACE_STAGES,workspaceStage} from '../../shared/activity-workspace.js';
import {activityDraftWorkspace} from './activity-draft-workspace.js';
const root='/api/volunteer/workflow/workspace-drafts';
const config=row=>{try{return JSON.parse(row['报名页配置']||'{}');}catch{return {};}};

/** Opt-in entry until the complete approval/publication migration is verified. Reuses the real console shell. */
export default async function activityWorkspacePage(context){
  let drafts=[],events=[],selected=context.query.get('draft')||context.query.get('event')||'',editor=null,disposed=false,loadSequence=0,detailSequence=0,canSubmit=false;
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
  function records(){return [...drafts.filter(d=>!events.some(e=>e['活动ID']===d.activityId)).map(d=>({id:d.id,name:d.content.name,stage:d.stage,region:d.content.region,category:d.content.category,date:d.content.date,endDate:d.content.endDate,draft:d})),...events.filter(e=>e['状态']!=='已归档'&&!config(e).parentActivityId).map(e=>{const c=config(e);return {id:e._id,name:e['活动名称'],stage:workspaceStage(e),region:e['活动地区']==='苏州地区'||c.region==='苏州活动'?'suzhou':'nanjing',category:e['组织类别']||c.center,date:e['报名日期'],event:e};})];}
  function renderList(){
    const rows=records().filter(r=>(!search.control.value||r.name?.includes(search.control.value))&&(!stage.control.value||r.stage===stage.control.value)&&(!region.control.value||r.region===region.control.value)&&(!category.control.value||r.category===category.control.value));
    count.textContent=`${rows.length} 项`;list.replaceChildren(...rows.map(row=>h('button',{type:'button',class:'activity-v2-card',aria:{pressed:String(row.id===selected)},on:{click:async()=>{if(row.id===selected)return;if(!await leave())return;selected=row.id;renderList();renderDetail();}}},h('strong',{text:row.name}),h('span',{class:'row-between'},h('span',{class:'activity-v2-badge',text:row.stage==='报名中'&&occupancy.get(row.id)?'报名中 · 报名已满':row.stage||'未分类'}),h('small',{text:row.date?(row.endDate&&row.endDate!==row.date?`${row.date} — ${row.endDate}`:row.date):'日期待填写'})))));
    if(!rows.length)list.append(emptyState({title:'没有符合条件的活动',description:'调整筛选或新建活动。'}));
  }
  function renderDetail(){
    const sequence=++detailSequence;editor?.dispose();editor=null;pane.replaceChildren();const row=records().find(r=>r.id===selected);
    patchQuery({workspace:'v2',draft:row?.draft?row.id:null,event:row?.event?row.id:null});
    if(!row){pane.append(emptyState({title:'选择活动开始管理'}));return;}
    const heading=h('header',{class:'activity-v2-heading'},button({label:directoryCollapsed?'›':'‹',variant:'ghost',onClick:toggleDirectory}),h('h2',{text:row.name}),h('ol',{'aria-label':'活动阶段'},...WORKSPACE_STAGES.map(text=>h('li',{text,class:text===row.stage?'is-current':'','aria-current':text===row.stage?'step':null}))));pane.append(heading);const collapse=heading.querySelector('button');collapse.classList.add('activity-v2-collapse');collapse.setAttribute('aria-label',directoryCollapsed?'展开活动列表':'收起活动列表');collapse.setAttribute('aria-expanded',String(!directoryCollapsed));
    if(row.draft){
      editor=activityDraftWorkspace({initial:row.draft,editable:row.draft.ownerId===currentActor&&row.draft.stage==='草稿'&&!row.draft.submissionStatus,allowSubmit:canSubmit,
        actionsNode:moreActions(row),
        loadResponsibleOptions:async params=>(await request(`${root}/responsible-options?${new URLSearchParams(params)}`,{fresh:true})).options,
        loadResponsibleProfile:async params=>(await request(`${root}/responsible-profile?${new URLSearchParams(params)}`,{fresh:true})).profile,
        ownerNode:definitionList([['草稿创建人',getSessionState().user?.label||row.draft.ownerId]]),
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
          editInformation:loadInformation?onSaved=>activityLiveInformation({load:loadInformation,save:body=>request(`${base}/workspace-content`,{method:'PATCH',body}),onSaved}):undefined,
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
        pane.append(h('div',{class:'activity-registration-workspace'},h('div',{class:'activity-draft-toolbar'},view,button({label:'活动信息修改',disabled:true}),button({label:'预览',disabled:true}),button({label:row.stage==='已结束'?'下载时长表':'导出',disabled:true}),moreActions(row)),h('div',{class:'activity-registration-content'},notice(error.message||'时长表加载失败',{tone:'warning'}))));
      }});
    }else pane.append(h('div',{class:'activity-v2-existing'},moreActions(row),definitionList([['活动名称',row.name],['阶段',row.stage],['地区',row.region==='suzhou'?'苏州地区':'南京地区'],['类别',row.category],['日期',row.date],['地点',row.event['地点']]]),button({label:'进入现有活动工作区',href:`/console/events?event=${encodeURIComponent(row.id)}&mode=all`,variant:'primary'})));
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
    return h('details',{class:'activity-v2-more'},h('summary',{text:'更多操作 ⌄'}),h('div',{class:'activity-v2-more__menu'},copyButton));
  }
  async function load(){const sequence=++loadSequence;try{const [a,b]=await Promise.all([request(root,{fresh:true}),request('/api/volunteer/workflow/catalog',{fresh:true})]);if(disposed||sequence!==loadSequence)return;drafts=a.drafts;events=b.events;canSubmit=a.capabilities?.canSubmit===true;if(!selected)selected=drafts[0]?.id||events[0]?._id||'';const linkedDraft=drafts.find(d=>d.id===selected),linkedEvent=events.find(e=>e['活动ID']===linkedDraft?.activityId);if(linkedEvent)selected=linkedEvent._id;message.replaceChildren();renderList();renderDetail();}catch(error){if(disposed||sequence!==loadSequence)return;message.replaceChildren(notice(error.message||'草稿加载失败，请稍后重试',{tone:'warning'}));}}
  function create(){
    const name=field({label:'活动名称',required:true,maxlength:500}),requestId=crypto.randomUUID();let modal,busy=false;
    const createButton=button({label:'开始填写',variant:'primary',onClick:async()=>{
      if(busy||!name.control.reportValidity()||!await leave())return;busy=true;createButton.disabled=true;
      try{const result=(await request(root,{method:'POST',body:{requestId,content:{name:name.control.value}}})).result;busy=false;await modal.close();if(disposed)return;drafts.unshift(result);selected=result.id;stage.control.value='草稿';search.control.value='';region.control.value='';syncCategories();category.control.value='';directoryCollapsed=false;workspace.classList.remove('is-directory-collapsed');renderList();renderDetail();list.scrollTop=0;}
      catch(error){if(!error.status||error.status>=500){name.control.disabled=true;createButton.textContent='核对创建结果';notify.warning('创建结果待核对','再次操作会使用原请求标识核对，不会另建草稿。');}else reportError(error,'创建未完成');}
      finally{busy=false;createButton.disabled=false;}
    }});
    modal=openModal({title:'新建活动',body:name,dismissible:false,footer:[button({label:'取消',onClick:()=>{if(!busy)void modal.close();}}),createButton]});
    modal.setCloseGuard(()=>!busy);
  }
  const workspace=h('div',{class:'activity-v2-workspace'},h('aside',{class:'activity-v2-directory'},h('div',{class:'row-between'},h('h2',{text:'活动目录'}),count),search,h('div',{class:'activity-v2-filters'},stage,region,category),button({label:'清除筛选',variant:'ghost',size:'sm',onClick:()=>{for(const f of [search,stage,region,category])f.control.value='';syncCategories();renderList();}}),list),pane);
  const node=h('div',{class:'view wspad activity-v2'},pageHead({title:'活动管理',actions:[button({label:'新建活动',variant:'primary',onClick:create}),button({label:'刷新',onClick:async()=>{if(await leave())await load();}})]}),message,workspace);
  void load();return {title:'活动管理',crumb:'活动管理',node,dispose:()=>{disposed=true;loadSequence++;editor?.dispose();release();window.removeEventListener('beforeunload',beforeUnload);}};
}
