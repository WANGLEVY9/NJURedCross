import {h,setVars} from '../../core/dom.js';
import {panel,field,button,notice} from '../../ui/primitives.js';
import {openDrawer,confirmAction} from '../../ui/overlay.js';
import {notify,reportError} from '../../core/toast.js';
import {normalizeWorkspaceDraft,workspaceCategories,workspaceNotice,isWorkspaceNoticeAuto} from '../../shared/activity-workspace.js';
import {activityInformationPreview} from './activity-information-preview.js';
import {positionLabel} from '../../shared/position-labels.js';

/** Inline editor. Its host supplies real, permission-checked persistence; no local storage or demo actors. */
export function activityDraftWorkspace({initial,ownerNode,actionsNode,loadResponsibleOptions,editable=false,allowSubmit=true,saveLabel='保存草稿',showSubmissionActions=true,save,preview,confirmPreview,submit,onSubmitted=()=>{}}) {
  let content=normalizeWorkspaceDraft(initial.content),version=initial.version,id=initial.id;
  let saved=JSON.stringify(content),busy=false,uncertain=false,disposed=false,previewSubmit=null;
  let autoNotice=isWorkspaceNoticeAuto(content);
  const controls=new Map(),root=h('div',{class:'activity-draft-workspace'}),form=h('div',{class:'activity-draft-workspace__form'}),details=h('div'),status=h('span',{class:'t-caption',role:'status'});
  const dirty=()=>JSON.stringify(content)!==saved;
  let noticeFrame=0,observedWidth=-1;
  function scheduleNoticeSize(){
    cancelAnimationFrame(noticeFrame);noticeFrame=requestAnimationFrame(()=>{
      const node=controls.get('notice');if(disposed||!node?.isConnected)return;
      setVars(node,{'--notice-height':'auto'});const style=getComputedStyle(node),border=parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth);setVars(node,{'--notice-height':Math.ceil(Math.max(180,node.scrollHeight+border))+'px'});
    });
  }
  const noticeObserver=new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(width!==observedWidth){observedWidth=width;scheduleNoticeSize();}});noticeObserver.observe(root);

  function update(key){if(key==='notice')autoNotice=false;else if(autoNotice&&(content.bookingMode||content.notice)){content.notice=workspaceNotice(content);const noticeControl=controls.get('notice');if(noticeControl)noticeControl.value=content.notice;}scheduleNoticeSize();status.textContent=dirty()?'有未保存的修改':'已保存';if(previewSubmit)previewSubmit.disabled=true;}
  function input(key,label,type='text',extra={}){
    const node=field({name:key,label,type,value:content[key]||'',required:false,...extra,onInput:()=>{if(['region','category','bookingMode'].includes(key))return;content[key]=node.control.value;update(key);}});
    if(['description','deadline'].includes(key))node.classList.add('activity-draft-field-wide');
    if(key==='notice'){node.classList.add('activity-notice-field');node.control.classList.add('activity-notice-input');}
    controls.set(key,node.control);return node;
  }
  const region=input('region','活动地区','text',{options:[{value:'',label:'请选择'}, {value:'nanjing',label:'南京地区'},{value:'suzhou',label:'苏州地区'}]});
  const category=input('category','活动类别','text',{options:['',...workspaceCategories(content.region)].map(value=>({value,label:value||'请选择'}))});
  function categoryOptions(){const values=workspaceCategories(content.region);if(!values.includes(content.category))content.category='';category.control.replaceChildren(...['',...values].map(value=>h('option',{value,text:value||'请选择'})));category.control.value=content.category;}
  region.control.addEventListener('change',()=>{content.region=region.control.value;categoryOptions();resetResponsible();update();});
  let responsibleSequence=0,responsibleOptions=[];
  const responsible=input('responsibleId','活动负责人','text',{options:[{value:'',label:'请选择活动负责人'},...(content.responsibleId?[{value:content.responsibleId,label:content.responsibleId}]:[])]});
  const responsibleMessage=h('span',{class:'t-caption activity-responsible-message','aria-live':'polite'});
  responsible.control.addEventListener('change',()=>{content.responsibleId=responsible.control.value;update();});
  category.control.addEventListener('change',()=>{content.category=category.control.value;resetResponsible();update();});
  function resetResponsible(){content.responsibleId='';responsible.control.value='';void refreshResponsible();}
  async function refreshResponsible(){
    const sequence=++responsibleSequence;responsibleOptions=[];
    const selected=content.responsibleId;
    responsible.control.replaceChildren(h('option',{value:'',text:'请选择活动负责人'}),...(selected?[h('option',{value:selected,text:selected})]:[]));responsible.control.value=selected;
    responsible.control.disabled=true;
    if(!loadResponsibleOptions||!content.region||!content.category){responsibleMessage.textContent=loadResponsibleOptions?'请先选择活动地区和类别':'负责人名单尚未接入';return;}
    responsibleMessage.textContent='正在加载负责人名单…';
    try{const options=await loadResponsibleOptions({region:content.region,category:content.category});if(disposed||sequence!==responsibleSequence)return;
      responsibleOptions=options;responsible.control.replaceChildren(h('option',{value:'',text:'请选择活动负责人'}),...options.map(row=>h('option',{value:row.id,text:options.filter(other=>other.name===row.name).length>1?`${row.name}（${row.id}）`:row.name})),...(selected&&!options.some(row=>row.id===selected)?[h('option',{value:selected,text:'原负责人已不在当前有效名单'})]:[]));responsible.control.value=selected;
      responsibleMessage.textContent=selected&&!options.some(row=>row.id===selected)?'请重新选择有效的活动负责人':options.length?'':'暂无符合条件的负责人，请联系平台总权限管理员配置活动角色';
      responsible.control.disabled=!editable;
    }catch(error){if(!disposed&&sequence===responsibleSequence)responsibleMessage.textContent=error.status===503?'活动权限名单暂不可用，请在管理工具的「活动权限与负责人配置」中核对':error.message||'负责人名单加载失败，请稍后重试';}
  }
  const mode=input('bookingMode','岗位数量','text',{options:[{value:'',label:'待选择'},{value:'unified',label:'单岗位'},{value:'grouped',label:'多岗位'}]});
  form.append(panel({title:'基本信息',body:h('div',{class:'activity-draft-grid'},input('name','活动名称'),region,category,h('div',{class:'stack-2'},responsible,responsibleMessage,ownerNode),input('description','活动说明','text',{multiline:true,rows:3}))}),panel({title:'岗位数量',body:mode}),details);
  let previousMode=content.bookingMode;
  mode.control.addEventListener('change',async()=>{
    const next=mode.control.value;
    if(previousMode&&next!==previousMode&&!await confirmAction({title:'切换岗位数量？',description:'当前岗位安排将清空。',confirmLabel:'切换'})){content.bookingMode=previousMode;mode.control.value=previousMode;return;}
    if(next!==previousMode){content.positions=[];for(const k of ['start','end','location','capacity','serviceHours','trainingHours','travelHours','work'])content[k]='';}
    content.bookingMode=next;previousMode=next;renderDetails();update();
  });
  function positionTable(){
    const tbody=h('tbody');
    for(const [index,p] of content.positions.entries()){
      const row=h('tr'),cells=[h('td'),h('td'),h('td'),h('td'),h('td')];row.append(...cells);
      cells[0].append(h('strong',{class:'activity-position-label',text:positionLabel(index+1)}));
      for(const [key,label,type]of [['name','岗位名称','text'],['date','日期','date'],['start','开始时间','time'],['end','结束时间','time'],['location','地点','text'],['capacity','人数','number'],['serviceHours','服务时长','number'],['trainingHours','培训时长','number'],['travelHours','交通时长','number'],['work','工作内容','text']]){
        const f=field({label,value:p[key],type,required:false,step:type==='time'?60:'any',onInput:()=>{p[key]=f.control.value;update();}});cells[['name','capacity'].includes(key)?0:['date','start','end'].includes(key)?1:['location','work'].includes(key)?2:3].append(f);
      }
      cells[4].append(button({label:'复制',size:'sm',onClick:()=>{content.positions.push({...p,id:crypto.randomUUID()});renderDetails();update();}}),button({label:'删除',variant:'ghost',size:'sm',onClick:()=>{content.positions=content.positions.filter(x=>x.id!==p.id);renderDetails();update();}}));tbody.append(row);
    }
    return h('div',{class:'activity-draft-table'},h('table',{},h('thead',{},h('tr',{},...['岗位与人数','日期与时间','地点与工作','时长（小时）','操作'].map(text=>h('th',{text})))),tbody));
  }
  function renderDetails(){
    details.replaceChildren();if(!content.bookingMode)return;
    const arrange=h('div',{class:'activity-draft-grid'},input('deadline','报名截止时间（北京时间）','datetime-local'),input('date','活动开始日期','date'),input('endDate','活动结束日期','date'));
    if(content.bookingMode==='unified')for(const [key,label,type]of [['start','开始时间','time'],['end','结束时间','time'],['location','地点','text'],['capacity','报名人数','number'],['serviceHours','服务时长','number'],['trainingHours','培训时长','number'],['travelHours','交通时长','number'],['work','工作内容','text']])arrange.append(input(key,label,type,{step:type==='time'?60:'any'}));
    details.append(panel({title:'活动安排',body:arrange}));
    if(content.bookingMode==='grouped')details.append(panel({title:'岗位安排',body:h('div',{class:'stack-3'},positionTable(),button({label:'添加岗位',onClick:()=>{content.positions.push({id:crypto.randomUUID(),name:'',date:content.date,start:'',end:'',campus:'',location:'',capacity:'',serviceHours:'',trainingHours:'',travelHours:'',work:''});renderDetails();update();}}))}));
    const text=input('notice','通知正文','text',{multiline:true,rows:7});
    details.append(panel({title:'报名通知',actions:[button({label:'根据安排生成通知',onClick:async()=>{if(content.notice&&!await confirmAction({title:'替换通知正文？',description:'根据当前活动和岗位安排重新生成。',confirmLabel:'替换'}))return;content.notice=workspaceNotice(content);autoNotice=true;text.control.value=content.notice;update();}})],body:text}));
    form.inert=!editable||busy;scheduleNoticeSize();
  }
  async function run(action,{readOnly=false}={}){
    if(!editable&&!readOnly||busy||uncertain||disposed)return;
    busy=true;form.inert=true;for(const b of [viewButton,editButton,saveButton,previewButton])b.disabled=true;
    try{await action();}catch(error){if(!readOnly&&!error.status&&error.statusCode===undefined){uncertain=true;notify.warning('操作结果待核对','请重新加载活动确认结果，不要重复提交。');}else reportError(error,readOnly?'信息加载失败，请重试':'操作未完成，输入已保留');}
    finally{busy=false;if(!disposed){form.inert=!editable;viewButton.disabled=uncertain;editButton.disabled=saveButton.disabled=previewButton.disabled=!editable||uncertain;if(previewSubmit)previewSubmit.disabled=uncertain||dirty()||previewSubmit.dataset.unavailable==='true';}}
  }
  const saveButton=button({label:saveLabel,onClick:()=>run(async()=>{const result=await save({id,expectedVersion:version,content:normalizeWorkspaceDraft(content)});if(disposed)return;id=result.id;version=result.version;content=normalizeWorkspaceDraft(result.content);saved=JSON.stringify(content);for(const [key,control] of controls)control.value=content[key]||'';scheduleNoticeSize();status.textContent='已保存';})});
  async function showPreview(confirmable){
    if(confirmable&&dirty()){notify.warning('请先保存草稿');return;}
    const data=await preview(id,{expectedVersion:version});if(disposed)return;
    const d=data.content;
    const responsibleName=responsibleOptions.find(row=>row.id===d.responsibleId)?.name||d.responsibleId||'未选择';
    const complete=data.errors?.length===0;
    const body=h('div',{class:'stack-4'},activityInformationPreview({content:d,responsibleName}),!complete?notice((data.errors||[]).join('；'),{tone:'warning'}):null);
    let drawer,submitting=false;const confirm=button({label:'提交审核',variant:'primary',onClick:()=>run(async()=>{if(dirty())return;submitting=true;confirm.disabled=true;try{await confirmPreview(id,{expectedVersion:version,digest:data.digest});await submit(id,{expectedVersion:version,digest:data.digest});saved=JSON.stringify(content);submitting=false;await drawer.close();await onSubmitted(id);}finally{submitting=false;}})});confirm.dataset.unavailable=String(!complete||!allowSubmit);confirm.disabled=!complete||!allowSubmit;previewSubmit=confirm;
    drawer=openDrawer({title:confirmable?'完整活动预览':'活动信息',width:1100,body,footer:[button({label:'返回',onClick:()=>drawer.close()}),...(confirmable&&editable?[confirm]:[])]});
    drawer.setCloseGuard(()=>!submitting);
  }
  const viewButton=button({label:'活动信息查看',onClick:()=>run(()=>showPreview(false),{readOnly:true})});
  const editButton=button({label:'活动信息修改',disabled:!editable,onClick:()=>{if(editable&&!busy&&!uncertain)controls.get('name')?.focus();}});
  const previewButton=button({label:'预览',onClick:()=>run(()=>showPreview(true),{readOnly:true})});
  root.append(h('div',{class:'activity-draft-toolbar'},viewButton,editButton,h('span',{class:'activity-draft-toolbar__divider','aria-hidden':'true'}),saveButton,...(showSubmissionActions?[previewButton]:[]),status,actionsNode),form);
  renderDetails();for(const b of [saveButton,previewButton])b.disabled=!editable;
  void refreshResponsible();
  return {node:root,hasUnsaved:dirty,isSaving:()=>busy,dispose:()=>{disposed=true;cancelAnimationFrame(noticeFrame);noticeObserver.disconnect();},getId:()=>id};
}
