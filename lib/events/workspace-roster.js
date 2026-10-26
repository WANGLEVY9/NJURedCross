import {workspaceCategories,WORKSPACE_REGIONS,workspacePermissions} from '../../public/app/shared/activity-workspace.js';

const denied=()=>({verified:false,active:false,actor:'',region:'',role:'',categories:[]});
/** The provider supplies a complete, trusted roster; names and client claims are never authority. */
export function workspaceRosterEvidence(actor,region,rows,{complete=false}={}) {
  if(!complete||typeof actor!=='string'||!actor||!WORKSPACE_REGIONS.includes(region)||!Array.isArray(rows))return denied();
  const matches=rows.filter(row=>row?.accountId===actor&&row?.region===region);
  if(matches.length!==1)return denied();
  const row=matches[0],allowed=workspaceCategories(region);
  if(row.active!==true||!['presidium','director','global'].includes(row.role)||!Array.isArray(row.categories)
    ||row.categories.some(category=>!allowed.includes(category))||new Set(row.categories).size!==row.categories.length
    ||row.role==='director'&&!row.categories.length)return denied();
  return {verified:true,active:true,actor,region,role:row.role,categories:row.role==='global'||row.role==='presidium'&&!row.finalCategories?[...allowed]:[...row.categories],initialCategories:row.initialCategories,finalCategories:row.finalCategories};
}

/** Explicit role assignments retain separate initial and final scopes. */
export function workspaceLevelAllowed(identity,category,level){
  if(!identity.verified||!identity.categories.includes(category))return false;
  if(identity.role==='global')return true;
  const categories=level==='initial'?identity.initialCategories:identity.finalCategories;
  return categories?categories.includes(category):identity.role===(level==='initial'?'director':'presidium');
}

/** Region must be chosen from the persisted event, not a requested authority region. */
export function workspaceRosterPermissions(event,actor,rows,options) {
  return workspacePermissions(event,workspaceRosterEvidence(actor,event.region,rows,options));
}
