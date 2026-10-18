import {h} from '../../core/dom.js';
import {field,button,notice} from '../../ui/primitives.js';
import {openModal} from '../../ui/overlay.js';
import {shanghaiInstant} from '../../shared/activity-window.js';
import {reportError,notify} from '../../core/toast.js';

/** Call only after the approval write has succeeded. Closing never undoes approval. */
export function activityPublicationChoice({publish,schedule,onPublished=()=>{},now=()=>Date.now()}){
 let busy=false,uncertain=false,modal;
 const method=field({label:'发布方式',options:[{value:'',label:'请选择发布方式'},{value:'immediate',label:'立即发布'},{value:'scheduled',label:'定时发布'}]});
 const time=field({label:'定时发布时间（北京时间）',type:'datetime-local',step:60,value:''});
 const timeSection=h('div',{hidden:true},time),message=h('div');
 const confirm=button({label:'确认发布',variant:'primary',onClick:async()=>{
  if(busy||uncertain)return;
  const choice=method.control.value;if(!['immediate','scheduled'].includes(choice)){notify.warning('请选择发布方式');return;}
  let publishAt;
  if(choice==='scheduled'){
   const instant=shanghaiInstant(time.control.value);
   time.control.setCustomValidity(!instant?'请选择定时发布时间':instant.timestamp<=now()?'请选择未来的北京时间':'');
   if(!time.control.reportValidity())return;publishAt=instant.canonical;
  }
  busy=true;setDisabled(true);
  try{if(choice==='immediate')await publish();else await schedule(publishAt);busy=false;await modal.close();await onPublished();}
  catch(error){if(!error.status&&error.statusCode===undefined){uncertain=true;message.replaceChildren(notice('发布结果待核对，请刷新活动确认结果。',{tone:'warning'}));}else reportError(error,'发布未完成，请核对活动状态');}
  finally{busy=false;setDisabled(uncertain);}
 }});
 const later=button({label:'稍后发布',onClick:()=>{if(!busy)void modal.close();}});
 function setDisabled(value){confirm.disabled=value;method.control.disabled=value;time.control.disabled=value;later.disabled=busy;}
 method.control.addEventListener('change',()=>{timeSection.hidden=method.control.value!=='scheduled';});
 time.control.addEventListener('input',()=>time.control.setCustomValidity(''));
 modal=openModal({title:'审批通过 · 发布活动',body:h('div',{class:'stack-4'},notice('审批已通过，发布后开放报名。',{tone:'neutral'}),method,timeSection,message),footer:[later,confirm]});
 modal.setCloseGuard(()=>!busy);return modal;
}
