import {h} from '../../core/dom.js';
import {button,notice} from '../../ui/primitives.js';
import {openModal,confirmAction} from '../../ui/overlay.js';
import {reportError,notify} from '../../core/toast.js';
import {activityDraftWorkspace} from './activity-draft-workspace.js';

/** Full pre-start editing; the backend retains booked event/registration IDs. */
export async function activityLiveInformation({load,save,onSaved,loadResponsibleOptions,loadResponsibleProfile,loadProjectPeopleOptions}){
 let source=await load(),request=source.pendingEdit||null,busy=false,closed=false,committed=false,modal;
 const message=h('div');
 async function done(){committed=true;await modal.close();notify.success('活动信息已保存');await onSaved();}
 const reconcile=button({label:'核对保存结果',onClick:async()=>{
  if(busy||!request)return;busy=true;reconcile.disabled=true;
  try{let current=await load();if(current.lastEdit?.token!==request.token)throw Error('尚未查到原保存请求，填写内容已保留，请稍后核对');if(current.pendingEdit){await save(current.pendingEdit);current=await load();}if(current.lastEdit?.status!=='complete')throw Error('保存结果仍待核对');busy=false;await done();}
  catch(error){reportError(error,'保存结果仍待核对');}finally{busy=false;reconcile.disabled=false;}
 }});reconcile.hidden=!request;
 const workspace=activityDraftWorkspace({initial:{...source,content:source.pendingEdit?.content||source.content},editable:source.canEdit!==false&&!request,showSubmissionActions:false,saveLabel:'保存修改',loadResponsibleOptions,loadResponsibleProfile,loadProjectPeopleOptions,
  save:async({content})=>{
   if(request)throw Error('请先核对上次保存结果');
   request={expectedVersion:source.version,token:source.token,content};
   try{await save(request);const result=await load();request=null;await done();return result;}
   catch(error){if(!error.status||error.status>=500){reconcile.hidden=false;message.replaceChildren(notice('保存结果待核对，填写内容已保留',{tone:'warning'}));error.status=undefined;error.statusCode=undefined;}else request=null;throw error;}
  },
  preview:async()=>({...source,content:source.content,errors:[]}),
 });
 modal=openModal({title:'修改活动信息',width:1400,body:h('div',{class:'stack-3'},workspace.node,message),footer:[button({label:'取消',onClick:()=>modal.close()}),reconcile],onClose:()=>{closed=true;workspace.dispose();}});
 modal.surface.classList.add('activity-approval-editor-modal');
 modal.setCloseGuard(async()=>committed||!busy&&!workspace.isSaving()&&(!workspace.hasUnsaved()||await confirmAction({title:'放弃未保存的修改？',confirmLabel:'放弃修改'})));
 return {hasUnsaved:()=>!closed&&workspace.hasUnsaved(),isSaving:()=>busy||workspace.isSaving(),dispose:()=>{closed=true;modal.setCloseGuard(null);workspace.dispose();void modal.close();}};
}
