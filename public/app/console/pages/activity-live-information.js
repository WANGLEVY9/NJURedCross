import {workspaceNotice} from '../../shared/activity-workspace.js';
import {h} from '../../core/dom.js';
import {field,button,definitionList,notice} from '../../ui/primitives.js';
import {openModal,confirmAction} from '../../ui/overlay.js';
import {reportError,notify} from '../../core/toast.js';

/** Edit published information while preserving booked positions and result receipts. */
export async function activityLiveInformation({load,save,onSaved}){
 const source=await load(),d=source.content;
 let busy=false,uncertain=false,disposed=false,closed=false,modal;
 const name=field({label:'活动名称',value:d.name,required:true,maxlength:500,disabled:d.bookingMode==='grouped'});
 const description=field({label:'活动说明',value:d.description,multiline:true,maxlength:2000});
 const text=field({label:'通知正文',value:d.notice,required:true,multiline:true,rows:9,maxlength:10000});
 let autoNotice=d.notice===workspaceNotice(d);
 text.control.addEventListener('input',()=>{autoNotice=false;});
 for(const control of [name.control,description.control])control.addEventListener('input',()=>{if(autoNotice)text.control.value=workspaceNotice({...d,name:name.control.value,description:description.control.value});});
 const values=()=>JSON.stringify([name.control.value,description.control.value,text.control.value]);let saved=values();
 const message=h('div'),form=h('div',{class:'stack-4'},definitionList([['活动负责人',source.responsibleName||d.responsibleId],['活动日期',`${d.date} — ${d.endDate}`],['岗位安排','保留现有岗位、时间、名额与负责人']]),name,description,text,message);
 const submit=button({label:'保存修改',variant:'primary',onClick:async()=>{
  if(busy||uncertain||disposed||!name.control.reportValidity()||!text.control.reportValidity())return;
  if(values()===saved){await modal.close();return;}busy=true;submit.disabled=true;form.inert=true;
  try{await save({expectedVersion:source.version,token:source.token,content:{...d,name:name.control.value,description:description.control.value,notice:text.control.value}});saved=values();busy=false;await modal.close();notify.success('活动信息已保存');try{await onSaved();}catch(error){reportError(error,'信息已保存，名单刷新失败');}}
  catch(error){if(!error.status&&error.statusCode===undefined){uncertain=true;message.replaceChildren(notice('保存结果待核对，请刷新活动确认。',{tone:'warning'}));}else reportError(error,'修改未保存，填写内容已保留');}
  finally{busy=false;if(!disposed){submit.disabled=uncertain;form.inert=uncertain;}}
 }});
 modal=openModal({title:'修改报名中活动信息',onClose:()=>{closed=true;},width:900,body:form,footer:[button({label:'取消',onClick:()=>modal.close()}),submit]});
 modal.setCloseGuard(async()=>!busy&&(values()===saved||await confirmAction({title:'放弃未保存的修改？',confirmLabel:'放弃修改'})));
 return {hasUnsaved:()=>!closed&&values()!==saved,isSaving:()=>busy,dispose:()=>{disposed=true;closed=true;modal.setCloseGuard(null);void modal.close();}};
}
