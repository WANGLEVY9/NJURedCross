import {workspaceRosterEvidence,workspaceLevelAllowed} from './workspace-roster.js';
import {canonicalActivityCategory} from '../../public/app/shared/activity-taxonomy.js';

const denied=()=>Object.assign(new Error('无权访问或修改此活动草稿'),{statusCode:403});
export function workspaceDraftAccess(row,actor,roster){
 const content=row.content||{},region=content.region;
 const ownerDraft=row.ownerId===actor&&row.stage==='草稿'&&!row.submission&&!content.responsibleId;
 if(!region){
  return {canView:row.ownerId===actor,canEdit:ownerDraft};
 }
 const evidence=workspaceRosterEvidence(actor,region,roster?.rows,{complete:roster?.complete===true});
 const category=canonicalActivityCategory(content.category);
 const valid=evidence.verified&&(!category||evidence.categories.includes(category));
 const chair=valid&&(evidence.role==='global'||(category?workspaceLevelAllowed(evidence,category,'final'):evidence.role==='presidium'));
 const director=valid&&(category?workspaceLevelAllowed(evidence,category,'initial'):evidence.role==='director')&&[content.responsibleId||row.ownerId,...(content.responsibleIds||[])].includes(actor);
 return {canView:Boolean(ownerDraft||chair||director||valid&&row.ownerId===actor),canEdit:Boolean(ownerDraft||(chair||director)&&row.stage==='草稿'&&!row.submission)};
}
export function createWorkspaceDraftAuthorization({actor,getRoster,assertCreate}){
 return async(row,requested,intent)=>{
  if(!actor||requested!==actor)throw denied();
  const roster=await getRoster(),access=workspaceDraftAccess(row,actor,roster);
  const evidence=workspaceRosterEvidence(actor,row.content?.region,roster?.rows,{complete:roster?.complete===true});
  const ownerPrivate=row.ownerId===actor&&!row.content?.responsibleId;
  const category=canonicalActivityCategory(row.content.category);
  const target=['create','edit-target'].includes(intent)&&row.ownerId===actor&&(ownerPrivate||evidence.verified)&&(!category||ownerPrivate||evidence.categories.includes(category));
  const handoff=intent==='edit-target'&&evidence.verified&&evidence.categories.includes(category);
  const replay=intent==='submit'&&row.submission?.actor===actor||intent==='edit'&&row.removal?.actor===actor;
  if(intent==='view'?!access.canView:!access.canEdit&&!target&&!handoff&&!(replay&&access.canView))throw denied();
  if(['create','edit-target'].includes(intent)&&row.content.category)assertCreate?.({center:row.content.category});
  return access;
 };
}
