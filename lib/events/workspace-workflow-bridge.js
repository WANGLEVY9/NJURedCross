import {normalizeWorkspaceDraft,workspaceDraftErrors} from '../../public/app/shared/activity-workspace.js';
import {activityWindow,shanghaiInstant} from '../../public/app/shared/activity-window.js';
import {assertWorkspaceResponsible} from './workspace-responsible.js';
import {createWorkspaceApprovalRouting} from './workspace-approval-routing.js';

const fail=message=>Object.assign(new Error(message),{statusCode:400});
/** No writes: convert a fully previewed draft into native workflow input. */
export function workspaceWorkflowInput(input){
 const content=normalizeWorkspaceDraft(input),errors=workspaceDraftErrors(content);
 if(errors.length)throw fail(errors.join('；'));
 const grouped=content.bookingMode==='grouped';
 const positions=content.positions.map(p=>({...activityWindow(`${p.date}T${p.start}`,`${p.date}T${p.end}`),name:p.name,campus:p.campus,location:p.location,capacity:Number(p.capacity),work:p.work,serviceHours:Number(p.serviceHours),trainingHours:Number(p.trainingHours||0),travelHours:Number(p.travelHours||0)}));
 const first=grouped?positions[0]:content;
 const window=grouped?activityWindow(`${content.date}T00:00`,`${content.endDate}T23:59`):activityWindow(`${content.date}T${content.start}`,`${content.endDate}T${content.end}`);
 return {content,positions,deadline:shanghaiInstant(content.deadline).canonical,body:{name:content.name,region:content.region==='suzhou'?'苏州活动':'南京活动',center:content.category,bookingMode:content.bookingMode,window,capacity:grouped?positions.reduce((sum,p)=>sum+p.capacity,0):Number(content.capacity),serviceHours:Number(first.serviceHours),trainingHours:Number(first.trainingHours||0),travelHours:Number(first.travelHours||0),location:first.location,work:first.work}};
}

/** The roster and workflow are server-owned; no client identity or reviewer overrides. */
export function createWorkspaceWorkflowBridge({workflow,getRoster}){
 const routing=createWorkspaceApprovalRouting({getRoster});
 async function build(content,actor){
  const input=workspaceWorkflowInput(content);
  assertWorkspaceResponsible(input.content,actor,await getRoster(),{required:true});
  return workflow.prepareWorkspaceSubmission(input,actor,routing);
 }
 return {
  prepare:async(draft,actor)=>{await build(draft.content,actor);return {content:structuredClone(draft.content)};},
  apply:claim=>workflow.acceptWorkspaceSubmission(claim,()=>build(claim.plan.content,claim.actor)),
  inspect:claim=>workflow.inspectWorkspaceSubmission(claim),
 };
}
