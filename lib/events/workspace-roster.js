import {canonicalActivityCategory} from '../../public/app/shared/activity-taxonomy.js';
import {workspaceCategories,WORKSPACE_REGIONS,workspacePermissions} from '../../public/app/shared/activity-workspace.js';

const denied=()=>({verified:false,active:false,actor:'',region:'',role:'',categories:[]});
/** The provider supplies a complete, trusted roster; names and client claims are never authority. */
export function workspaceRosterEvidence(actor,region,rows,{complete=false}={}) {
  if(!complete||typeof actor!=='string'||!actor||!WORKSPACE_REGIONS.includes(region)||!Array.isArray(rows))return denied();
  const matches=rows.filter(row=>row?.accountId===actor&&row?.region===region);
  if(matches.length!==1)return denied();
  const row=matches[0],allowed=workspaceCategories(region);
  const categories=Array.isArray(row.categories)?row.categories.map(canonicalActivityCategory):null;
  if(row.active!==true||!['presidium','director'].includes(row.role)||!Array.isArray(categories)
    ||categories.some(category=>!allowed.includes(category))||new Set(categories).size!==categories.length
    ||row.role==='director'&&!categories.length)return denied();
  return {verified:true,active:true,actor,region,role:row.role,categories:row.role==='presidium'?[...allowed]:[...categories]};
}

/** Region must be chosen from the persisted event, not a requested authority region. */
export function workspaceRosterPermissions(event,actor,rows,options) {
  return workspacePermissions(event,workspaceRosterEvidence(actor,event.region,rows,options));
}
