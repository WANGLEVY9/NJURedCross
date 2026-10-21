import {activityInformationPreview} from './activity-information-preview.js';
import {h} from '../../core/dom.js';
import {button,field,panel,definitionList,notice} from '../../ui/primitives.js';
import {openModal,openDrawer,confirmAction} from '../../ui/overlay.js';
import {reportError,notify} from '../../core/toast.js';
import {activityDraftWorkspace} from './activity-draft-workspace.js';
import {activityPublicationChoice} from './activity-publication-choice.js';
import {workspaceDraftErrors} from '../../shared/activity-workspace.js';

/** A single pending-approval page, including approved-but-unpublished activities. */
export function activityApprovalWorkspace({event,content,actionsNode,loadContent,save,mutate,onChanged,loadResponsibleOptions,loadResponsibleProfile}){
 let busy=false,disposed=false,editWorkspace=null;
 const config=JSON.parse(event['报名页配置']||'{}'),access=event.approvalAccess||{},returned=event['状态']==='草稿',scheduled=event['状态']==='报名中'&&Date.parse(config.publishAt)>Date.now(),ready=event['状态']==='可发布'||scheduled;
 const mayEdit=!scheduled&&(ready?access.canPublish:returned?access.canManageRegistration:access.canReview)===true;
 const root=h('div',{class:'activity-approval-workspace'}),body=h('div',{class:'activity-approval-content'}),controls=[];
 const initialPending=Boolean(config.approval?.levels&&!config.approval.initialReview);
 const state=h('p',{role:'status',class:'t-caption',text:scheduled?`已安排定时发布：${config.publishAt.slice(0,16).replace('T',' ')}（北京时间）`:returned?'已退回，等待修改':ready?'审批已通过，等待发布':config.approval?.levels?initialPending?'等待主任团一级初审':'一级初审已通过，等待分管主席二级终审':'等待本地区主席团审批'});
 async function run(task){if(busy||disposed)return;busy=true;for(const b of controls)b.disabled=true;try{await task();}catch(error){reportError(error,'操作未完成，请刷新核对活动状态');}finally{busy=false;if(!disposed)for(const b of controls)b.disabled=b.dataset.unavailable==='true';}}
 function control(label,onClick,enabled=true,variant){const b=button({label,onClick,variant});b.dataset.unavailable=String(!enabled);b.disabled=!enabled;controls.push(b);return b;}
 function preview(){return activityInformationPreview(content);}
 async function edit(){
  if(!mayEdit||disposed)return;
  let source=await loadContent(),modal,submittedClosing=false;
  editWorkspace=activityDraftWorkspace({initial:source,editable:true,allowSubmit:returned,showSubmissionActions:returned,saveLabel:'保存修改',loadResponsibleOptions,loadResponsibleProfile,
   save:async({expectedVersion,content})=>{await save({expectedVersion,content,token:source.token});source=await loadContent();return source;},
   preview:async()=>{source=await loadContent();return {...source,digest:source.token,errors:workspaceDraftErrors(source.content)};},
   confirmPreview:async(_id,{digest})=>mutate('workspace-preview',{token:digest}),
   submit:async(_id,{digest})=>mutate('workspace-resubmit',{token:digest}),
   onSubmitted:async()=>{submittedClosing=true;await modal.close();await onChanged();notify.success('已重新提交审批');},
  });
  modal=openModal({title:returned?'修改退回活动':'修改待审批活动',width:1100,body:editWorkspace.node,footer:[button({label:'完成',onClick:()=>modal.close()})]});
  modal.surface?.classList.add('activity-approval-editor-modal');
  modal.setCloseGuard(async()=>{if(submittedClosing)return true;if(editWorkspace.isSaving())return false;if(editWorkspace.hasUnsaved()&&!await confirmAction({title:'放弃未保存的修改？',confirmLabel:'放弃修改'}))return false;editWorkspace.dispose();if(!disposed)await onChanged();return true;});
 }
 function publication(){activityPublicationChoice({publish:()=>mutate('publish',{}),schedule:publishAt=>mutate('schedule',{publishAt}),onPublished:onChanged});}
 const view=control('活动信息查看',()=>openDrawer({title:'完整活动信息',width:1100,body:preview(),footer:[]}));
 const editButton=control('活动信息修改',()=>run(edit),mayEdit);
 const approve=control(initialPending?'初审通过':config.approval?.levels?'终审通过':'审批通过',()=>run(async()=>{await mutate('approve',{token:content.token});await onChanged();if(!initialPending)publication();}),access.canReview===true&&!returned&&!ready,'primary');
 const back=control('审批退回',()=>{
  const reason=field({label:'退回原因',required:true,multiline:true,maxlength:500});let modal;
  const send=button({label:'确认退回',variant:'primary',onClick:async()=>{if(!reason.control.reportValidity()||!reason.control.value.trim())return;send.disabled=true;try{await mutate('return-approval',{reason:reason.control.value.trim(),token:content.token});send.disabled=false;await modal.close();await onChanged();}catch(error){reportError(error,'退回未完成，请刷新核对');}finally{send.disabled=false;}}});
  modal=openModal({title:'退回活动',body:reason,footer:[button({label:'取消',onClick:()=>modal.close()}),send]});modal.setCloseGuard(()=>!send.disabled);
 },access.canReview===true&&!returned&&!ready);
 const toolbar=h('div',{class:'activity-draft-toolbar'},view,editButton,...(!returned&&!ready&&access.canReview===true?[approve,back]:[]),...(ready&&access.canPublish===true?[control(scheduled?'调整发布':'发布',publication,true,'primary'),...(scheduled?[control('取消定时发布',()=>run(async()=>{await mutate('schedule',{publishAt:null});await onChanged();}))]:[])]:[]),actionsNode);
 body.append(panel({title:'审核进度',body:h('div',{class:'stack-3'},state,definitionList([['审批地区',content.content.region==='suzhou'?'苏州分部主席团':'南京地区主席团'],['审核人',(config.approval?.reviewerNames||[]).join('、')||config.approvalReturn?.reviewerName||'待分配'],['申请版本',String(event['申请版本'])],...(ready?[['通过时间',event['审批时间']]]:[])]),config.approvalReturn?notice(`退回原因：${config.approvalReturn.reason}`,{tone:'warning'}):null)}),panel({title:'活动信息预览',body:preview()}));
 root.append(toolbar,body);
 return {node:root,dispose:()=>{disposed=true;editWorkspace?.dispose();},hasUnsaved:()=>editWorkspace?.hasUnsaved()||false,isSaving:()=>busy||editWorkspace?.isSaving()||false};
}
