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
  let drafts=[],events=[],selected=context.query.get('draft')||'',editor=null,disposed=false,loadSequence=0;
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
  function records(){return [...drafts.map(d=>({id:d.id,name:d.content.name,stage:d.stage,region:d.content.region,category:d.content.category,date:d.content.date,endDate:d.content.endDate,draft:d})),...events.filter(e=>e['状态']!=='已归档').map(e=>{const c=config(e);return {id:e._id,name:e['活动名称'],stage:workspaceStage(e),region:e['活动地区']==='苏州地区'||c.region==='苏州活动'?'suzhou':'nanjing',category:e['组织类别']||c.center,date:e['报名日期'],event:e};})];}
  function renderList(){
    const rows=records().filter(r=>(!search.control.value||r.name?.includes(search.control.value))&&(!stage.control.value||r.stage===stage.control.value)&&(!region.control.value||r.region===region.control.value)&&(!category.control.value||r.category===category.control.value));
    count.textContent=`${rows.length} 项`;list.replaceChildren(...rows.map(row=>h('button',{type:'button',class:'activity-v2-card',aria:{pressed:String(row.id===selected)},on:{click:async()=>{if(row.id===selected)return;if(!await leave())return;selected=row.id;renderList();renderDetail();}}},h('strong',{text:row.name}),h('span',{class:'row-between'},h('span',{class:'activity-v2-badge',text:row.stage||'未分类'}),h('small',{text:row.date?(row.endDate&&row.endDate!==row.date?`${row.date} — ${row.endDate}`:row.date):'日期待填写'})))));
    if(!rows.length)list.append(emptyState({title:'没有符合条件的活动',description:'调整筛选或新建活动。'}));
  }
  function renderDetail(){
    editor?.dispose();editor=null;pane.replaceChildren();const row=records().find(r=>r.id===selected);
    patchQuery({workspace:'v2',draft:row?.draft?row.id:null});
    if(!row){pane.append(emptyState({title:'选择活动开始管理'}));return;}
    const heading=h('header',{class:'activity-v2-heading'},button({label:directoryCollapsed?'›':'‹',variant:'ghost',onClick:toggleDirectory}),h('h2',{text:row.name}),h('ol',{'aria-label':'活动阶段'},...WORKSPACE_STAGES.map(text=>h('li',{text,class:text===row.stage?'is-current':'','aria-current':text===row.stage?'step':null}))));pane.append(heading);const collapse=heading.querySelector('button');collapse.classList.add('activity-v2-collapse');collapse.setAttribute('aria-label',directoryCollapsed?'展开活动列表':'收起活动列表');collapse.setAttribute('aria-expanded',String(!directoryCollapsed));
    if(row.draft){
      editor=activityDraftWorkspace({initial:row.draft,editable:row.draft.ownerId===currentActor&&row.draft.stage==='草稿'&&!row.draft.submissionStatus,allowSubmit:false,
        actionsNode:moreActions(row),
        loadResponsibleOptions:async params=>(await request(`${root}/responsible-options?${new URLSearchParams(params)}`,{fresh:true})).options,
        loadResponsibleProfile:async params=>(await request(`${root}/responsible-profile?${new URLSearchParams(params)}`,{fresh:true})).profile,
        ownerNode:definitionList([['草稿创建人',getSessionState().user?.label||row.draft.ownerId]]),
        save:async({id,expectedVersion,content})=>{const result=(await request(`${root}/${id}`,{method:'PATCH',body:{expectedVersion,content}})).result;drafts=drafts.map(d=>d.id===result.id?result:d);renderList();heading.querySelector('h2').textContent=result.content.name;return result;},
        preview:async(id,body)=>(await request(`${root}/${id}/preview`,{method:'POST',body})).result,
        confirmPreview:async(id,body)=>(await request(`${root}/${id}/confirm-preview`,{method:'POST',body})).result,
      });pane.append(editor.node);
    }else pane.append(h('div',{class:'activity-v2-existing'},definitionList([['活动名称',row.name],['阶段',row.stage],['地区',row.region==='suzhou'?'苏州地区':'南京地区'],['类别',row.category],['日期',row.date],['地点',row.event['地点']]]),button({label:'进入现有活动工作区',href:`/console/events?event=${encodeURIComponent(row.id)}&mode=all`,variant:'primary'})));
  }
  function moreActions(row){
    let busy=false,pending=null;
    const copyButton=button({label:'复制为新活动',onClick:async()=>{
      if(busy||!await leave())return;busy=true;copyButton.disabled=true;
      pending||={requestId:crypto.randomUUID(),expectedVersion:drafts.find(d=>d.id===row.id).version};
      try{const result=(await request(`${root}/${row.id}/copy`,{method:'POST',body:pending})).result;if(disposed)return;
        drafts=[result,...drafts.filter(d=>d.id!==result.id)];selected=result.id;stage.control.value='草稿';search.control.value='';region.control.value='';syncCategories();category.control.value='';directoryCollapsed=false;workspace.classList.remove('is-directory-collapsed');renderList();renderDetail();list.scrollTop=0;notify.success('已复制为新草稿');
      }catch(error){if(!error.status||error.status>=500)notify.warning('复制结果待核对','再次操作将核对原复制请求。');else{pending=null;reportError(error,'复制未完成');}}
      finally{busy=false;copyButton.disabled=false;}
    }});
    return h('details',{class:'activity-v2-more'},h('summary',{text:'更多操作 ⌄'}),h('div',{class:'activity-v2-more__menu'},copyButton));
  }
  async function load(){const sequence=++loadSequence;try{const [a,b]=await Promise.all([request(root,{fresh:true}),request('/api/volunteer/workflow/catalog',{fresh:true})]);if(disposed||sequence!==loadSequence)return;drafts=a.drafts;events=b.events;if(!selected)selected=drafts[0]?.id||events[0]?._id||'';message.replaceChildren();renderList();renderDetail();}catch(error){if(disposed||sequence!==loadSequence)return;message.replaceChildren(notice(error.message||'草稿加载失败，请稍后重试',{tone:'warning'}));}}
  function create(){
    const name=field({label:'活动名称',required:true,maxlength:500}),requestId=crypto.randomUUID();let modal,busy=false;
    const createButton=button({label:'开始填写',variant:'primary',onClick:async()=>{
      if(busy||!name.control.reportValidity()||!await leave())return;busy=true;createButton.disabled=true;
      try{const result=(await request(root,{method:'POST',body:{requestId,content:{name:name.control.value}}})).result;busy=false;await modal.close();if(disposed)return;drafts.unshift(result);selected=result.id;renderList();renderDetail();}
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
