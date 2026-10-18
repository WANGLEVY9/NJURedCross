import {h} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {notify,reportError} from '../../core/toast.js';
import {openDrawer} from '../../ui/overlay.js';
import {field,button,notice,runWithLoading} from '../../ui/primitives.js';
import {peoplePicker} from '../../ui/people-picker.js';
import {protectDrawerDraft} from '../../ui/drawer-draft.js';
import {supportsHoursSubmission} from '../../shared/hours-submission.js';

const endpoint='/api/volunteer/workflow/approval-routing';
export function returnActivityApproval(event,mutate){
 const reason=field({label:'退回原因',required:true,multiline:true,rows:4,maxlength:500});let drawer,save;
 save=button({label:'确认退回',variant:'primary',onClick:async()=>{
  if(!reason.control.reportValidity())return;
  try{await runWithLoading(save,()=>mutate(`/events/${event._id}/return-approval`,{reason:reason.control.value,token:event.positionToken}));drawer.close();}catch(error){reportError(error,'申请未退回');}
 }});
 drawer=openDrawer({title:'退回修改',description:'退回原因显示在活动详情中，负责人修改后可重新提交。',body:reason,footer:[save]});
}
export function canReviewActivity(event,actor,superAdmin){
 if(event['状态']!=='待审核')return false;
 if(event.approvalAccess)return event.approvalAccess.canReview===true;
 if(superAdmin)return true;
 let config;try{config=JSON.parse(event['报名页配置']||'{}');}catch{return false;}
 if(config.approval&&config.approval.reviewerId!==actor)return false;
 return event['负责人账号ID']!==actor&&config.lastEditor!==actor;
}

export function canReviewHours(event,actor,superAdmin){
 if(!supportsHoursSubmission(event))return true;
 if(event.hoursAccess)return event.hoursAccess.canReview===true;
 if(superAdmin)return true;
 try{const c=JSON.parse(event['报名页配置']||'{}'),ids=c.approval?.reviewerIds||[c.approval?.reviewerId];return ids.filter(Boolean).includes(actor);}catch{return false;}
}

export async function configureActivityApprovers(onSaved){
 try{
  const settings=await request(endpoint);
  if(!settings.canConfigure){notify.warning('仅主席团和指导组成员可以配置默认审核人');return;}
  const fields=settings.categories.map(item=>{
   const value=item.reviewerIds??settings.mappings?.[item.category]??item.reviewerId;
   const picker=peoplePicker({label:`${item.category}默认审核人`,people:settings.reviewers,selected:Array.isArray(value)?value:value?[value]:[]});
   return {category:item.category,picker,node:h('section',{class:'stack-3'},h('h3',{class:'t-h3',text:item.category}),picker.node)};
  });
  let drawer,save,guard,busy=false;
  save=button({label:'保存默认审核人',variant:'primary',onClick:async()=>{
   if(busy)return;busy=true;drawer.body.inert=true;
   try{await runWithLoading(save,()=>request(endpoint,{method:'PUT',body:{version:settings.version,mappings:Object.fromEntries(fields.map(f=>[f.category,f.picker.value()]))}}));guard.markSaved();busy=false;await drawer.close();notify.success('默认审核人已保存');try{await onSaved?.();}catch{notify.warning('配置已保存，页面刷新失败，请稍后刷新');}}
   catch(error){reportError(error,error.status===409?'配置已被更新，请重新打开后核对':'配置未保存，选择已保留');}finally{busy=false;drawer.body.inert=false;}
  }});
  drawer=openDrawer({title:'默认审核人配置',description:'每类活动可选择多位主席团或指导组成员，任意一人批准即可。',width:640,body:h('div',{class:'stack-5'},notice('用于新申请的默认选择；已提交申请的审核人保持不变。',{tone:'neutral'}),...fields.map(f=>f.node)),footer:[button({label:'取消',onClick:()=>drawer.close()}),save]});
  guard=protectDrawerDraft(drawer,{readFields:()=>[],readExtraState:()=>fields.map(f=>f.picker.value()),isBusy:()=>busy});
 }catch(error){reportError(error,'审核主席配置暂时无法加载');}
}
