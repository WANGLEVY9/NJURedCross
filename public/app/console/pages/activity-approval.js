import {h} from '../../core/dom.js';
import {request} from '../../core/api.js';
import {notify,reportError} from '../../core/toast.js';
import {openDrawer} from '../../ui/overlay.js';
import {field,button,notice,runWithLoading} from '../../ui/primitives.js';

const endpoint='/api/volunteer/workflow/approval-routing';
export function returnActivityApproval(event,mutate){
 const reason=field({label:'退回原因',required:true,multiline:true,rows:4,maxlength:500});let drawer,save;
 save=button({label:'确认退回',variant:'primary',onClick:async()=>{
  if(!reason.control.reportValidity())return;
  try{await runWithLoading(save,()=>mutate(`/events/${event._id}/return-approval`,{reason:reason.control.value}));drawer.close();}catch(error){reportError(error,'申请未退回');}
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

export async function configureActivityApprovers(onSaved){
 try{
  const settings=await request(endpoint);
  if(!settings.canConfigure){notify.warning('仅超级管理员可以配置审核主席');return;}
  const options=[{value:'',label:'未配置'},...settings.reviewers.map(a=>({value:a.id,label:a.name}))];
  const fields=settings.categories.map(item=>{
   const choices=item.reviewerId&&!settings.reviewers.some(a=>a.id===item.reviewerId)?[...options,{value:item.reviewerId,label:'原审核账号已停用或无权限'}]:options;
   return {category:item.category,node:field({label:`${item.category}审核主席`,value:item.reviewerId,options:choices})};
  });
  let drawer,save;
  save=button({label:'保存对应关系',variant:'primary',onClick:async()=>{
   try{await runWithLoading(save,()=>request(endpoint,{method:'PUT',body:{version:settings.version,mappings:Object.fromEntries(fields.map(f=>[f.category,f.node.control.value]))}}));drawer.close();await onSaved();notify.success('审核主席对应关系已保存');}catch(error){reportError(error,'配置未保存');}
  }});
  drawer=openDrawer({title:'配置审核主席',description:'各类别对应一位审核主席，同一位主席可负责多个类别。',width:600,body:h('div',{class:'stack-4'},notice('修改对应关系只影响以后提交的申请；已提交申请仍由原分配主席审核。',{tone:'neutral'}),...fields.map(f=>f.node)),footer:[save]});
 }catch(error){reportError(error,'审核主席配置暂时无法加载');}
}
