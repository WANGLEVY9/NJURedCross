import {canonicalActivityCategory} from '../../public/app/shared/activity-taxonomy.js';
import {workspaceRosterEvidence} from './workspace-roster.js';

const denied=()=>Object.assign(new Error('无权访问或修改此活动草稿'),{statusCode:403});
export function workspaceDraftAccess(row,actor,roster){
 const content=row.content||{},region=content.region;
 const global=['nanjing','suzhou'].some(area=>workspaceRosterEvidence(actor,area,roster?.rows,{complete:roster?.complete===true}).role==='global');
 if(global)return {canView:true,canEdit:row.stage==='草稿'&&!row.submission};
 const ownerDraft=row.ownerId===actor&&row.stage==='草稿'&&!row.submission&&!content.responsibleId;
 if(!region){
  return {canView:row.ownerId===actor,canEdit:ownerDraft};
 }
 const evidence=workspaceRosterEvidence(actor,region,roster?.rows,{complete:roster?.complete===true});
 const valid=evidence.verified&&(!content.category||evidence.categories.includes(canonicalActivityCategory(content.category)));
 const chair=valid&&(evidence.role==='global'||evidence.role==='presidium'&&(!evidence.finalCategories||evidence.finalCategories.includes(content.category)));
 const director=valid&&(evidence.role==='director'||evidence.initialCategories?.includes(content.category))&&actor===(content.responsibleId||row.ownerId);
 return {canView:Boolean(ownerDraft||chair||director||valid&&row.ownerId===actor),canEdit:Boolean(ownerDraft||(chair||director)&&row.stage==='草稿'&&!row.submission)};
}
export function createWorkspaceDraftAuthorization({actor,getRoster,assertCreate}){
 return async(row,requested,intent)=>{
  if(!actor||requested!==actor)throw denied();
  const roster=await getRoster(),access=workspaceDraftAccess(row,actor,roster);
  const evidence=workspaceRosterEvidence(actor,row.content?.region,roster?.rows,{complete:roster?.complete===true});
  const ownerPrivate=row.ownerId===actor&&!row.content?.responsibleId;
  const target=['create','edit-target'].includes(intent)&&row.ownerId===actor&&(ownerPrivate||evidence.verified)&&(!row.content.category||ownerPrivate||evidence.categories.includes(canonicalActivityCategory(row.content.category)));
  const handoff=intent==='edit-target'&&evidence.verified&&evidence.categories.includes(canonicalActivityCategory(row.content.category));
  const replay=intent==='submit'&&row.submission?.actor===actor||intent==='edit'&&row.removal?.actor===actor;
  if(intent==='view'?!access.canView:!access.canEdit&&!target&&!handoff&&!(replay&&access.canView))throw denied();
  if(['create','edit-target'].includes(intent)&&row.content.category)assertCreate?.({center:row.content.category,region:row.content.region});
  return access;
 };
}
