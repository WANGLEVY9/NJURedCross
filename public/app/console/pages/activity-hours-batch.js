import {h} from '../../core/dom.js';
import {button,field,notice} from '../../ui/primitives.js';
import {openModal,confirmAction} from '../../ui/overlay.js';
import {notify,reportError} from '../../core/toast.js';

/** Shared selection and version-bound review; attendance and hours stay untouched. */
export function hoursBatchReview({title,description,getToken,itemOf,save,onSaved,onSaving=()=>{}}){
 let rows=[],enabled=false,busy=false,dirty=false,dialog=null,disposed=false,version;
 const selected=new Set(),checks=new Map(),count=h('span',{class:'t-caption',role:'status'});
 function controls(){
  count.textContent=`已选 ${selected.size} 条`;
  all.disabled=busy||!enabled||!rows.length;clear.disabled=busy||!selected.size;
  review.disabled=busy||!enabled||!selected.size;
  for(const [id,input]of checks){input.checked=selected.has(id);input.disabled=busy||!enabled;}
 }
 const all=button({label:'全选当前名单',size:'sm',onClick:()=>{if(busy||!enabled)return;for(const row of rows)selected.add(row.id);controls();}});
 const clear=button({label:'取消选择',variant:'ghost',size:'sm',onClick:()=>{if(busy)return;selected.clear();controls();}});
 const review=button({label:'批量审核',size:'sm',onClick:open});
 const node=h('div',{class:'activity-hours-batch'},count,all,review,clear);
 function open(){
  if(busy||!enabled||!selected.size||dialog)return;
  const targets=rows.filter(row=>selected.has(row.id)),token=getToken();
  const decision=field({label:'审核结果',value:'pass',options:[{value:'pass',label:'审核通过'},{value:'fail',label:'不通过'}]}),reason=field({label:'不通过原因',required:true,multiline:true,maxlength:500}),feedback=h('div',{role:'status'});
  let uncertain=false;
  function lock(){decision.control.disabled=busy||uncertain;reason.control.disabled=busy||uncertain;confirm.disabled=busy||uncertain;cancel.disabled=busy;refresh.hidden=!uncertain;refresh.disabled=busy;}
  function change(){reason.hidden=decision.control.value!=='fail';dirty=true;}
  decision.control.addEventListener('change',change);reason.control.addEventListener('input',()=>{dirty=true;});reason.hidden=true;
  const cancel=button({label:'取消',onClick:()=>dialog.close()});
  const refresh=button({label:'刷新名单后重新选择',onClick:async()=>{
   if(busy)return;busy=true;lock();onSaving(true);
   try{await onSaved();selected.clear();dirty=false;busy=false;await dialog.close();}
   catch(error){reportError(error,'名单刷新失败');}
   finally{busy=false;onSaving(false);lock();controls();}
  }});
  const confirm=button({label:'确认审核',variant:'primary',onClick:async()=>{
   if(busy||uncertain)return;
   const value=decision.control.value,note=value==='fail'?reason.control.value.trim():'';
   if(value==='fail'&&(!reason.control.reportValidity()||!note))return;
   busy=true;lock();controls();onSaving(true);
   try{
    await save({token,items:targets.map(row=>({...itemOf(row),decision:value,reason:note}))});
    await onSaved();selected.clear();dirty=false;busy=false;await dialog.close();notify.success(`已保存 ${targets.length} 条审核结果`);
   }catch(error){uncertain=![400,403].includes(error.status);feedback.replaceChildren(notice(uncertain?'保存结果待核对，请刷新名单后重新选择。':'审核未完成，请检查权限与填写内容。',{tone:'warning'}));reportError(error,'批量审核未完成');}
   finally{busy=false;onSaving(false);lock();controls();}
  }});
  dialog=openModal({title,width:680,body:h('div',{class:'stack-3'},h('p',{text:`本次审核 ${targets.length} 条参与记录。`}),h('p',{class:'t-caption',text:description}),h('details',{},h('summary',{text:'查看所选名单'}),...targets.map(row=>h('p',{class:'t-caption',text:`${row.name} ${row.studentId}${row.position?' · '+row.position:''}`}))),feedback,decision,reason),footer:[cancel,refresh,confirm],onClose:()=>{dialog=null;dirty=false;}});
  dialog.setCloseGuard(async()=>disposed||!busy&&(!dirty||await confirmAction({title:'放弃未保存的批量审核？',confirmLabel:'放弃修改'})));lock();
 }
 return {node,update(next,allowed){
  rows=next;enabled=allowed;const token=getToken();
  if(version!==token){selected.clear();version=token;}
  for(const id of selected)if(!rows.some(row=>row.id===id))selected.delete(id);
  checks.clear();node.hidden=!enabled;controls();
 },selection(row){
  if(!enabled)return null;
  const input=h('input',{type:'checkbox',checked:selected.has(row.id),'aria-label':`选择 ${row.name} ${row.studentId}`,on:{change:()=>{if(busy)return;if(input.checked)selected.add(row.id);else selected.delete(row.id);controls();}}});
  checks.set(row.id,input);input.disabled=busy;return input;
 },hasUnsaved:()=>dirty,isSaving:()=>busy,dispose(){disposed=true;dirty=false;void dialog?.close();}};
}
