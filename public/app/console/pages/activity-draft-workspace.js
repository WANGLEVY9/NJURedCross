import {h} from '../../core/dom.js';
import {panel,field,button,definitionList,notice} from '../../ui/primitives.js';
import {openDrawer,confirmAction} from '../../ui/overlay.js';
import {notify,reportError} from '../../core/toast.js';
import {normalizeWorkspaceDraft,workspaceCategories,workspaceNotice,workspaceDraftErrors} from '../../shared/activity-workspace.js';

/** Inline editor. Its host supplies real, permission-checked persistence; no local storage or demo actors. */
export function activityDraftWorkspace({initial,ownerNode,editable=false,allowSubmit=true,save,preview,confirmPreview,submit,onSubmitted=()=>{}}) {
  let content=normalizeWorkspaceDraft(initial.content),version=initial.version,id=initial.id;
  let saved=JSON.stringify(content),busy=false,uncertain=false,confirmed=null,disposed=false;
  const controls=new Map(),root=h('div',{class:'activity-draft-workspace'}),form=h('div',{class:'activity-draft-workspace__form'}),details=h('div'),status=h('span',{class:'t-caption',role:'status'});
  const dirty=()=>JSON.stringify(content)!==saved;
  function update(){confirmed=null;status.textContent=dirty()?'有未保存的修改':'已保存';send.disabled=true;}
  function input(key,label,type='text',extra={}){
    const node=field({name:key,label,type,value:content[key]||'',required:false,...extra,onInput:()=>{content[key]=node.control.value;update();}});
    controls.set(key,node.control);return node;
  }
  const region=input('region','活动地区','text',{options:[{value:'',label:'请选择'}, {value:'nanjing',label:'南京地区'},{value:'suzhou',label:'苏州地区'}]});
  const category=input('category','活动类别','text',{options:['',...workspaceCategories(content.region)].map(value=>({value,label:value||'请选择'}))});
  function categoryOptions(){const values=workspaceCategories(content.region);if(!values.includes(content.category))content.category='';category.control.replaceChildren(...['',...values].map(value=>h('option',{value,text:value||'请选择'})));category.control.value=content.category;}
  region.control.addEventListener('change',()=>{categoryOptions();update();});
  const mode=input('bookingMode','报名方式','text',{options:[{value:'',label:'请选择报名方式'},{value:'unified',label:'整体活动统一报名'},{value:'grouped',label:'按岗位分别报名'}]});
  form.append(panel({title:'基本信息',body:h('div',{class:'activity-draft-grid'},input('name','活动名称'),region,category,ownerNode,input('description','活动说明','text',{multiline:true,rows:3}))}),panel({title:'报名方式',body:mode}),details);
  let previousMode=content.bookingMode;
  mode.control.addEventListener('change',async()=>{
    const next=mode.control.value;
    if(previousMode&&next!==previousMode&&!await confirmAction({title:'切换报名方式？',description:'当前方式的岗位或统一安排将清空。',confirmLabel:'切换'})){content.bookingMode=previousMode;mode.control.value=previousMode;return;}
    if(next!==previousMode){content.positions=[];for(const k of ['start','end','location','capacity','serviceHours','trainingHours','travelHours','work'])content[k]='';}
    content.bookingMode=next;previousMode=next;renderDetails();update();
  });
  function positionTable(){
    const tbody=h('tbody');
    for(const p of content.positions){
      const row=h('tr');
      for(const [key,label,type]of [['name','岗位名称','text'],['date','日期','date'],['start','开始时间','time'],['end','结束时间','time'],['campus','校区','text'],['location','地点','text'],['capacity','人数','number'],['serviceHours','服务时长','number'],['trainingHours','培训时长','number'],['travelHours','交通时长','number'],['work','工作内容','text']]){
        const options=key==='campus'?[{value:'',label:'请选择'},...(content.region==='suzhou'?['苏州']:['鼓楼','仙林','浦口']).map(value=>({value,label:value+'校区'}))]:undefined;
        const f=field({label,value:p[key],type,options,required:false,step:type==='time'?60:'any',onInput:()=>{p[key]=f.control.value;update();}});row.append(h('td',{},f));
      }
      row.append(h('td',{},button({label:'复制',size:'sm',onClick:()=>{content.positions.push({...p,id:crypto.randomUUID()});renderDetails();update();}}),button({label:'删除',variant:'ghost',size:'sm',onClick:()=>{content.positions=content.positions.filter(x=>x.id!==p.id);renderDetails();update();}})));tbody.append(row);
    }
    return h('div',{class:'activity-draft-table'},h('table',{},h('thead',{},h('tr',{},...['岗位','日期','开始','结束','校区','地点','人数','服务','培训','交通','工作内容','操作'].map(text=>h('th',{text})))),tbody));
  }
  function renderDetails(){
    details.replaceChildren();if(!content.bookingMode)return;
    const arrange=h('div',{class:'activity-draft-grid'},input('date','活动开始日期','date'),input('endDate','活动结束日期','date'),input('deadline','报名截止时间（北京时间）','datetime-local'));
    if(content.bookingMode==='unified')for(const [key,label,type]of [['start','开始时间','time'],['end','结束时间','time'],['location','地点','text'],['capacity','报名人数','number'],['serviceHours','服务时长','number'],['trainingHours','培训时长','number'],['travelHours','交通时长','number'],['work','工作内容','text']])arrange.append(input(key,label,type,{step:type==='time'?60:'any'}));
    details.append(panel({title:'活动安排',body:arrange}));
    if(content.bookingMode==='grouped')details.append(panel({title:'岗位安排',body:h('div',{class:'stack-3'},positionTable(),button({label:'添加岗位',onClick:()=>{content.positions.push({id:crypto.randomUUID(),name:'',date:content.date,start:'',end:'',campus:'',location:'',capacity:'',serviceHours:'',trainingHours:'',travelHours:'',work:''});renderDetails();update();}}))}));
    const text=input('notice','通知正文','text',{multiline:true,rows:7});
    details.append(panel({title:'报名通知',actions:[button({label:'根据安排生成通知',onClick:async()=>{if(content.notice&&!await confirmAction({title:'替换通知正文？',description:'根据当前活动和岗位安排重新生成。',confirmLabel:'替换'}))return;content.notice=workspaceNotice(content);text.control.value=content.notice;update();}})],body:text}));
    form.inert=!editable||busy;
  }
  async function run(action,{readOnly=false}={}){
    if(!editable&&!readOnly||busy||uncertain||disposed)return;
    busy=true;form.inert=true;for(const b of [viewButton,editButton,saveButton,previewButton,send])b.disabled=true;
    try{await action();}catch(error){if(!readOnly&&!error.status&&error.statusCode===undefined){uncertain=true;notify.warning('操作结果待核对','请重新加载活动确认结果，不要重复提交。');}else reportError(error,readOnly?'信息加载失败，请重试':'操作未完成，输入已保留');}
    finally{busy=false;if(!disposed){form.inert=!editable;viewButton.disabled=uncertain;editButton.disabled=saveButton.disabled=previewButton.disabled=!editable||uncertain;send.disabled=!allowSubmit||!editable||uncertain||dirty()||!confirmed;}}
  }
  const saveButton=button({label:'保存草稿',onClick:()=>run(async()=>{const result=await save({id,expectedVersion:version,content:normalizeWorkspaceDraft(content)});if(disposed)return;id=result.id;version=result.version;content=normalizeWorkspaceDraft(result.content);saved=JSON.stringify(content);confirmed=null;status.textContent='已保存';})});
  async function showPreview(confirmable){
    if(confirmable&&dirty()){notify.warning('请先保存草稿');return;}
    const data=await preview(id,{expectedVersion:version});if(disposed)return;
    const d=data.content;
    const rows=[['活动名称',d.name],['活动地区',d.region==='suzhou'?'苏州地区':'南京地区'],['活动类别',d.category],['活动说明',d.description],['报名方式',d.bookingMode==='grouped'?'按岗位分别报名':'整体活动统一报名'],['日期范围',d.date+' — '+d.endDate],['报名截止',d.deadline],['活动时间',d.start+' — '+d.end],['地点',d.location],['人数',d.capacity],['服务 / 培训 / 交通时长',[d.serviceHours,d.trainingHours,d.travelHours].join(' / ')],['工作内容',d.work],['报名通知',d.notice]];
    const complete=data.errors?.length===0;
    const body=h('div',{class:'stack-4'},definitionList(rows),d.positions.length?h('div',{class:'activity-draft-table'},h('table',{},h('thead',{},h('tr',{},...['岗位','日期','开始','结束','校区','地点','人数','服务时长','培训时长','交通时长','工作内容'].map(text=>h('th',{text})))),h('tbody',{},...d.positions.map(p=>h('tr',{},...['name','date','start','end','campus','location','capacity','serviceHours','trainingHours','travelHours','work'].map(k=>h('td',{text:p[k]}))))))):null,!complete?notice((data.errors||[]).join('；'),{tone:'warning'}):null);
    let drawer;const confirm=button({label:'确认已预览',variant:'primary',onClick:()=>run(async()=>{await confirmPreview(id,{expectedVersion:version,digest:data.digest});confirmed=data.digest;await drawer.close();})});confirm.disabled=!complete;
    drawer=openDrawer({title:confirmable?'完整活动预览':'活动信息',width:1100,body,footer:[button({label:'返回',onClick:()=>drawer.close()}),...(confirmable&&editable?[confirm]:[])]});
  }
  const viewButton=button({label:'活动信息查看',onClick:()=>run(()=>showPreview(false),{readOnly:true})});
  const editButton=button({label:'活动信息修改',disabled:!editable,onClick:()=>{if(editable&&!busy&&!uncertain)controls.get('name')?.focus();}});
  const previewButton=button({label:'预览',onClick:()=>run(()=>showPreview(true),{readOnly:true})});
  const send=button({label:'提交审批',variant:'primary',onClick:()=>run(async()=>{if(dirty()||!confirmed)return;const errors=workspaceDraftErrors(content);if(errors.length){notify.warning(errors[0]);return;}await submit(id,{expectedVersion:version,digest:confirmed});saved=JSON.stringify(content);await onSubmitted(id);})});
  root.append(h('div',{class:'activity-draft-toolbar'},viewButton,editButton,h('span',{class:'activity-draft-toolbar__divider','aria-hidden':'true'}),saveButton,previewButton,send,status),form);
  if(!allowSubmit)send.title='当前草稿暂不能提交审批';
  renderDetails();for(const b of [saveButton,previewButton,send])b.disabled=!editable;send.disabled=true;
  return {node:root,hasUnsaved:dirty,isSaving:()=>busy,dispose:()=>{disposed=true;},getId:()=>id};
}
