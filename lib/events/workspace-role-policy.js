import {isAccountActive,hasPermission} from '../permissions.js';
import {workspaceCategories} from '../../public/app/shared/activity-workspace.js';
import {canonicalActivityCategory} from '../../public/app/shared/activity-taxonomy.js';

const fail=message=>Object.assign(new Error(message),{statusCode:400,code:'workspace_roles_invalid'});
export const WORKSPACE_ROLE_CODES=Object.freeze(['R01','R02','R03','R04','R05','R06','R11']);
/** Identity is always resolved by stable account ID, never by a name in a workbook. */
export function compileWorkspaceRoleAssignments(assignments,accounts,{validateAccounts=false}={}){
 if(!Array.isArray(assignments)||assignments.length>300)throw fail('活动角色配置无效');
 const seen=new Set(),rows=[];
 for(const item of assignments){
  if(!item||Object.keys(item).some(key=>!['accountId','roles','finalCategories','initialCategories'].includes(key))||typeof item.accountId!=='string'||seen.has(item.accountId)||!Array.isArray(item.roles)||!item.roles.length||new Set(item.roles).size!==item.roles.length||item.roles.some(role=>!WORKSPACE_ROLE_CODES.includes(role)))throw fail('账号或角色重复、格式无效');
  seen.add(item.accountId);
  const matches=accounts.filter(account=>account.accountId===item.accountId);
  if(matches.length>1||validateAccounts&&matches.length!==1)throw fail('角色配置引用了不存在或重复的账号');
  const account=matches[0]||{accountId:item.accountId},active=isAccountActive(account)&&account.emailVerified===true&&['platform_admin','super_admin'].includes(account.role)&&hasPermission(account,'events')&&(!item.roles.includes('R11')||account.role==='super_admin');
  if(validateAccounts&&!['platform_admin','super_admin'].includes(account.role))throw fail('请先在账号管理中启用管理端身份，再分配活动角色');
  if(validateAccounts&&!hasPermission(account,'events'))throw fail('请先在账号管理中启用活动管理模块权限');
  if(validateAccounts&&item.roles.includes('R11')&&account.role!=='super_admin')throw fail('R11 仅可绑定已核验的平台总权限账号，请先在账号管理中核对');
  const categories=key=>{const values=item[key]||[];if(!Array.isArray(values)||new Set(values).size!==values.length||values.some(value=>!workspaceCategories('nanjing').includes(canonicalActivityCategory(value))))throw fail('分管活动类别无效');return values.map(canonicalActivityCategory);};
  const initial=categories('initialCategories'),final=categories('finalCategories');
  if(initial.length&&!item.roles.some(role=>['R01','R02','R03'].includes(role)))throw fail('专项初审范围须绑定南京一级初审角色 R01、R02 或 R03');
  if(item.roles.includes('R05')&&!final.length)throw fail('南京终审须明确分管类别；跨中心负责人请选择全部类别');
  for(const region of ['nanjing','suzhou']){
   const first=new Set(region==='suzhou'&&item.roles.includes('R04')?workspaceCategories(region):region==='nanjing'?item.roles.flatMap(code=>({R01:['综事中心'],R02:['博爱中心'],R03:['生命中心']})[code]||[]):[]);
   if(region==='nanjing')for(const value of initial)first.add(value);
   const last=region==='suzhou'&&item.roles.includes('R06')?workspaceCategories(region):region==='nanjing'&&item.roles.includes('R05')?final:[];
   const global=item.roles.includes('R11');
   if(global||first.size||last.length)rows.push({accountId:item.accountId,region,role:global?'global':last.length?'presidium':'director',categories:global?workspaceCategories(region):[...new Set([...first,...last])],initialCategories:[...first],finalCategories:last,name:account.realName||account.label||account.accountId,active,email:account.email||'',emailVerified:account.emailVerified===true});
  }
 }
 return rows;
}

/** Verified platform super-admins remain usable before a regional file is configured. */
export function withWorkspaceSuperAdmins(roster,accounts){
 const rows=[...(roster.rows||[])];
 for(const account of accounts.filter(row=>row.role==='super_admin'&&isAccountActive(row)&&row.emailVerified===true&&accounts.filter(other=>other.accountId===row.accountId).length===1)){
  for(const region of ['nanjing','suzhou']){
   const existing=rows.findIndex(row=>row.accountId===account.accountId&&row.region===region);
   const row={accountId:account.accountId,region,role:'global',categories:workspaceCategories(region),name:account.realName||account.label||account.accountId,active:true,email:account.email||'',emailVerified:true};
   if(existing<0)rows.push(row);else rows[existing]=row;
  }
 }
 return {...roster,complete:roster.complete===true||rows.some(row=>row.role==='global'),rows};
}
