import {workspaceRosterEvidence} from './workspace-roster.js';

const denied=()=>Object.assign(new Error('无权访问或修改此活动草稿'),{statusCode:403});
export function workspaceDraftAccess(row,actor,roster){
 const content=row.content||{},region=content.region;
 if(!region){
  const own=row.ownerId===actor;
  return {canView:own,canEdit:own&&row.stage==='草稿'&&!row.submission};
 }
 const evidence=workspaceRosterEvidence(actor,region,roster?.rows,{complete:roster?.complete===true});
 const valid=evidence.verified&&(!content.category||evidence.categories.includes(content.category));
 const chair=valid&&evidence.role==='presidium';
 const director=valid&&evidence.role==='director'&&actor===(content.responsibleId||row.ownerId);
 return {canView:Boolean(chair||director||valid&&row.ownerId===actor),canEdit:Boolean((chair||director)&&row.stage==='草稿'&&!row.submission)};
}
export function createWorkspaceDraftAuthorization({actor,getRoster,assertCreate}){
 return async(row,requested,intent)=>{
  if(!actor||requested!==actor)throw denied();
  const roster=await getRoster(),access=workspaceDraftAccess(row,actor,roster);
  const evidence=workspaceRosterEvidence(actor,row.content?.region,roster?.rows,{complete:roster?.complete===true});
  const target=['create','edit-target'].includes(intent)&&row.ownerId===actor&&evidence.verified&&(!row.content.category||evidence.categories.includes(row.content.category));
  const handoff=intent==='edit-target'&&evidence.verified&&evidence.categories.includes(row.content.category);
  const replay=intent==='submit'&&row.submission?.actor===actor||intent==='edit'&&row.removal?.actor===actor;
  if(intent==='view'?!access.canView:!access.canEdit&&!target&&!handoff&&!(replay&&access.canView))throw denied();
  if(['create','edit-target'].includes(intent)&&row.content.category)assertCreate?.({center:row.content.category});
  return access;
 };
}
