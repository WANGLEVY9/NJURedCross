import {getSessionState,request} from '../../core/api.js';
import {eventResponsibleIds} from '../../shared/activity-responsibility.js';
import {h} from '../../core/dom.js';
import {button,field} from '../../ui/primitives.js';
import {openModal} from '../../ui/overlay.js';
import {notify,reportError} from '../../core/toast.js';
/** Shared review controls for registration and running workspaces. */
export function leaveReviewActions(row,{enabled,decide,refresh}){
 if(row['请假状态']!=='待审批'||!enabled||!decide)return null;
 async function review(approved){
  const reason=field({label:'处理说明（选填）',multiline:true,maxlength:500});let dialog,saving=false;
  const confirm=button({label:approved?'确认批准请假':'确认驳回请假',variant:'primary',onClick:async()=>{if(saving||!reason.control.reportValidity())return;saving=true;confirm.disabled=true;reason.control.disabled=true;try{await decide(row._id,approved,reason.control.value.trim());saving=false;await dialog.close();await refresh();notify.success('请假处理结果已保存');}catch(error){reportError(error,'处理结果请刷新核对');}finally{saving=false;confirm.disabled=false;reason.control.disabled=false;}}});
  dialog=openModal({title:approved?'批准请假':'驳回请假',body:h('div',{class:'stack-3'},h('p',{text:`${row['姓名']}：${row['请假原因']||'未填写原因'}`}),reason),footer:[button({label:'取消',onClick:()=>dialog.close()}),confirm]});dialog.setCloseGuard(()=>!saving);
 }
 return h('div',{class:'row-2 row-wrap'},button({label:'审核通过',size:'sm',onClick:()=>review(true)}),button({label:'不通过',size:'sm',onClick:()=>review(false)}));
}
/** A separate selection dialog keeps leave decisions independent of admission selection. */
export function batchLeaveButton({getRows,refresh,onBusy=()=>{}}){
 return button({label:'批量请假审批',size:'sm',iconName:'checkCheck',onClick:()=>{
  const rows=getRows().filter(r=>r['请假状态']==='待审批'&&['待筛选','已确认'].includes(r['报名状态']));
  if(!rows.length){notify.info('暂无可审批的请假');return;}
  const selected=new Set(),list=h('div',{class:'stack-2'}),status=h('p',{role:'status'});
  let saving=false,uncertain=false,dialog;
  const start=field({label:'起始序号',type:'number',min:1,max:rows.length,value:1}),end=field({label:'结束序号',type:'number',min:1,max:rows.length,value:rows.length});
  const reason=field({label:'处理说明（选填）',multiline:true,maxlength:500});
  function render(){
   list.replaceChildren(...rows.map((r,i)=>h('label',{class:'row-2'},h('input',{type:'checkbox',checked:selected.has(r._id),disabled:saving||uncertain,on:{change:e=>{if(e.target.checked)selected.add(r._id);else selected.delete(r._id);status.textContent=`已选择 ${selected.size} 条`;}}}),h('span',{text:`${i+1}. ${r['姓名']} · ${r['学号']} · ${r['请假原因']||'未填写原因'}`}))));status.textContent=`已选择 ${selected.size} 条`;
  }
  async function submit(approved){
   if(saving||uncertain||!selected.size||!reason.control.reportValidity())return;
   saving=true;onBusy(true);for(const control of dialog.surface.querySelectorAll('input,textarea,button'))control.disabled=true;
   approve.disabled=true;reject.disabled=true;
   try{
    // The existing endpoint validates each decision and returns partial outcomes.
    // Chunk by activity so the established same-activity batch contract is retained.
    const groups=new Map();for(const row of rows.filter(r=>selected.has(r._id))){if(!groups.has(row['活动ID']))groups.set(row['活动ID'],[]);groups.get(row['活动ID']).push(row._id);}
    for(const ids of groups.values())for(let i=0;i<ids.length;i+=100){
     const response=await request('/api/volunteer/workflow/registrations/batch',{method:'POST',body:{ids:ids.slice(i,i+100),action:approved?'leave-approve':'leave-reject',reason:reason.control.value.trim()}});
     if(response.results?.some(r=>!r.ok))throw Error('部分请假未处理，请关闭窗口并刷新核对');
    }
    await refresh();saving=false;await dialog.close();notify.success('请假审批已保存');
   }catch(error){uncertain=true;status.textContent='处理结果待核对，请关闭窗口并刷新名单后重新操作。';reportError(error,'请假审批结果待核对');}
   finally{saving=false;onBusy(false);const close=dialog.surface.querySelector('footer button');if(close)close.disabled=false;}
  }
  const approve=button({label:'审核通过',variant:'primary',onClick:()=>submit(true)}),reject=button({label:'不通过',onClick:()=>submit(false)});
  dialog=openModal({title:'批量请假审批',body:h('div',{class:'stack-3'},h('div',{class:'row-2'},button({label:'全选',onClick:()=>{for(const r of rows)selected.add(r._id);render();}}),button({label:'清空选择',onClick:()=>{selected.clear();render();}})),start,end,button({label:'选择区间',onClick:()=>{if(!start.control.reportValidity()||!end.control.reportValidity())return;const from=Number(start.control.value),to=Number(end.control.value);if(from>to)return;for(const r of rows.slice(from-1,to))selected.add(r._id);render();}}),status,list,reason),footer:[button({label:'关闭',onClick:async()=>{if(saving)return;await dialog.close();if(uncertain)await refresh();}}),approve,reject]});
  dialog.setCloseGuard(()=>!saving);render();
 }});
}
export const leaveStatus=row=>row['请假状态']?({待审批:'请假待审批',已批准:'请假已批准',已驳回:'请假已驳回'})[row['请假状态']]||row['请假状态']:'未请假';

export function canReviewLeave(event){const user=getSessionState().user||{};return user.role==='super_admin'||eventResponsibleIds(event).includes(user.accountId||user.username);}
