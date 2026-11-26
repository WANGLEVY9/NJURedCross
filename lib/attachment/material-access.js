import {hasPermission,isAccountActive} from '../permissions.js';
import {workspaceRosterEvidence} from '../events/workspace-roster.js';
import {resolveMediaCenter} from './activities.js';
import {normalizeMediaCenter} from './store.js';

export function materialAccess(account,roster){
 const active=isAccountActive(account);
 const outreach=active&&hasPermission(account,'outreach');
 const full=outreach&&Boolean(account.accountId)&&account.role==='super_admin'&&account.emailVerified===true;
 const rows=roster?.assignedRows||roster?.rows;
 const centers=new Set();
 if(outreach&&account.emailVerified===true&&account.accountId){
  for(const region of ['nanjing','suzhou']){
   const evidence=workspaceRosterEvidence(account.accountId,region,rows,{complete:roster?.complete===true});
   const categories=evidence.role==='director'?evidence.categories:evidence.initialCategories||[];
   for(const category of categories){
    const center=resolveMediaCenter(category);
    if(center)centers.add(center);
   }
  }
 }
 const scopes=['mine',...(centers.size?['center']:[]),...(full?['all']:[])];
 const owns=item=>active&&Boolean(account.accountId&&String(item.uploader||'')===account.accountId||
   account.username&&item.uploader===account.username);
 return {scopes,outreach,owns,allows(item,scope){
  if(!scopes.includes(scope))return false;
  if(scope==='all')return true;
  if(scope==='center')return centers.has(normalizeMediaCenter(item.center));
  return owns(item);
 }};
}
