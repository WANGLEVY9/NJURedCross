import {workspaceContentFromEvent} from './workspace-event-copy.js';
import {workflowApprovalHash} from './workflow.js';
import {normalizeWorkspaceDraft,workspaceDraftErrors,workspaceResponsibleIds} from '../../public/app/shared/activity-workspace.js';
import {activityWindow,shanghaiInstant} from '../../public/app/shared/activity-window.js';
import {assertWorkspaceResponsible} from './workspace-responsible.js';
import {createWorkspaceApprovalRouting} from './workspace-approval-routing.js';
import {flexibleCapacity} from '../../public/app/shared/activity-capacity.js';
import {readWorkflowConfig} from './workflow-config-integrity.js';

const fail=message=>Object.assign(new Error(message),{statusCode:400});
/** No writes: convert a fully previewed draft into native workflow input. */
export function workspaceWorkflowInput(input){
 const content=normalizeWorkspaceDraft(input),errors=workspaceDraftErrors(content);
 if(errors.length)throw fail(errors.join('；'));
 const grouped=content.bookingMode==='grouped';
 const positions=content.positions.map(p=>({...activityWindow(`${p.date}T${p.start}`,`${p.date}T${p.end}`),name:p.name,campus:p.campus,location:p.location,capacity:Number(p.capacity),...(p.flexibleCapacity!==undefined?{flexibleCapacity:flexibleCapacity(p.flexibleCapacity)}:{}),work:p.work,serviceHours:Number(p.serviceHours),trainingHours:Number(p.trainingHours||0),travelHours:Number(p.travelHours||0)}));
 const first=grouped?positions[0]:content;
 const window=grouped?activityWindow(`${content.date}T00:00`,`${content.endDate}T23:59`):activityWindow(`${content.date}T${content.start}`,`${content.endDate}T${content.end}`);
 return {content,positions,deadline:shanghaiInstant(content.deadline).canonical,body:{name:content.name,region:content.region==='suzhou'?'苏州活动':'南京活动',center:content.category,bookingMode:content.bookingMode,window,capacity:grouped?positions.reduce((sum,p)=>sum+p.capacity,0):Number(content.capacity),...(!grouped&&content.flexibleCapacity!==undefined?{flexibleCapacity:flexibleCapacity(content.flexibleCapacity)}:{}),...(grouped&&positions.some(p=>flexibleCapacity(p.flexibleCapacity)>0)?{registrationLimit:positions.reduce((sum,p)=>sum+p.capacity+flexibleCapacity(p.flexibleCapacity),0)}:{}),serviceHours:Number(first.serviceHours),trainingHours:Number(first.trainingHours||0),travelHours:Number(first.travelHours||0),location:first.location,work:first.work,coOwners:workspaceResponsibleIds(content).slice(1)}};
}

/** The roster and workflow are server-owned; no client identity or reviewer overrides. */
export function createWorkspaceWorkflowBridge({workflow,getRoster}){
 const routing=createWorkspaceApprovalRouting({getRoster});
 async function build(content,actor,version=1){
  const input=workspaceWorkflowInput(content);
  const roster=await getRoster();assertWorkspaceResponsible(input.content,actor,roster,{required:true});input.responsibleNames=workspaceResponsibleIds(input.content).map(id=>roster.rows.find(row=>row.accountId===id&&row.region===input.content.region)?.name||id);input.responsibleName=input.responsibleNames.join('、');
  return workflow.prepareWorkspaceSubmission(input,actor,routing,{version});
 }
 return {
  content:async(id,actor,authorityEvents)=>{
   const events=await workflow.workspaceEditEvents(id,authorityEvents),event=events.find(e=>e._id===id);
   if(!event)throw fail('活动不存在');const c=readWorkflowConfig(event);
   if(!c.workspaceSubmission)throw fail('当前活动尚未接入新版编辑');
   const content=workspaceContentFromEvent(event);content.notice=event['通知草稿']||'';content.description=c.workspaceDescription||'';
   const pending=c.workspaceEdit&&c.workspaceEdit.actor===actor&&['applying','finishing'].includes(c.workspaceEdit.status)?workflow.workspaceEditReceipt(event,actor):null;
   return {id,version:Number(event['申请版本']),content,...(content.projectOwnerId?{ownerId:content.projectOwnerId,projectOwnerName:c.workspaceResponsibleNames?.[0]||content.projectOwnerId,collaboratorNames:c.workspaceResponsibleNames?.slice(1)||[],reviewerNames:c.approval?.reviewerNames||[]}:{}),responsibleName:c.workspaceResponsibleName||content.responsibleId,token:workflowApprovalHash(event),canEdit:actor?await workflow.canEditWorkspace(id,actor,events):false,...(c.workspaceEdit&&c.workspaceEdit.actor===actor?{lastEdit:{status:c.workspaceEdit.status,token:c.workspaceEdit.token},...(pending?{pendingEdit:{token:c.workspaceEdit.token,expectedVersion:c.workspaceEdit.expectedVersion,content:pending.content}}:{})}:{})};
  },
  save:(id,body,actor)=>workflow.updateWorkspaceSubmission(id,body,actor,(content,version)=>build(content,actor,version)),
  prepare:async(draft,actor)=>{await build(draft.content,actor);return {content:structuredClone(draft.content)};},
  apply:claim=>workflow.acceptWorkspaceSubmission(claim,()=>build(claim.plan.content,claim.actor)),
  inspect:claim=>workflow.inspectWorkspaceSubmission(claim),
 };
}
