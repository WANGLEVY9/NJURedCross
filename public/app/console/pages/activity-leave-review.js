import {getSessionState} from '../../core/api.js';
import {eventResponsibleIds} from '../../shared/activity-responsibility.js';
import {h} from '../../core/dom.js';
import {button,field} from '../../ui/primitives.js';
import {openModal} from '../../ui/overlay.js';
import {notify,reportError} from '../../core/toast.js';
/** Shared review controls for registration and running workspaces. */
export function leaveReviewActions(row,{enabled,decide,refresh}){
 if(row['请假状态']!=='待审批'||!enabled||!decide)return null;
 async function review(approved){
  const reason=field({label:'处理说明',multiline:true,required:true,maxlength:500,value:approved?'同意请假':''});let dialog,saving=false;
  const confirm=button({label:approved?'确认批准请假':'确认驳回请假',variant:'primary',onClick:async()=>{if(saving||!reason.control.reportValidity()||!reason.control.value.trim())return;saving=true;confirm.disabled=true;reason.control.disabled=true;try{await decide(row._id,approved,reason.control.value.trim());saving=false;await dialog.close();await refresh();notify.success('请假处理结果已保存');}catch(error){reportError(error,'处理结果请刷新核对');}finally{saving=false;confirm.disabled=false;reason.control.disabled=false;}}});
  dialog=openModal({title:approved?'批准请假':'驳回请假',body:h('div',{class:'stack-3'},h('p',{text:`${row['姓名']}：${row['请假原因']||'未填写原因'}`}),reason),footer:[button({label:'取消',onClick:()=>dialog.close()}),confirm]});dialog.setCloseGuard(()=>!saving);
 }
 return h('div',{class:'row-2 row-wrap'},button({label:'批准请假',size:'sm',onClick:()=>review(true)}),button({label:'驳回请假',size:'sm',onClick:()=>review(false)}));
}
export const leaveStatus=row=>row['请假状态']?({待审批:'请假待审批',已批准:'请假已批准',已驳回:'请假已驳回'})[row['请假状态']]||row['请假状态']:'未请假';

export function canReviewLeave(event){const user=getSessionState().user||{};return user.role==='super_admin'||eventResponsibleIds(event).includes(user.accountId||user.username);}
