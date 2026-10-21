import {readFile,mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createMutationQueue} from './safety.js';
import {compileWorkspaceRoleAssignments} from './workspace-role-policy.js';
import {isAccountActive,hasPermission} from '../permissions.js';

export function createWorkspaceRoleStore(path,getAccounts){
 const queue=createMutationQueue();
 async function read(){try{const data=JSON.parse(await readFile(path,'utf8'));if(!data||Array.isArray(data)||typeof data!=='object')throw Error('invalid');return data;}catch(error){if(error.code==='ENOENT'){try{await readFile(path+'.configured','utf8');}catch(marker){if(marker.code==='ENOENT')return {version:0,assignments:[]};}throw Object.assign(new Error('活动角色配置缺失，请恢复原文件'),{statusCode:503});}throw Object.assign(new Error('活动角色配置无法读取，请联系平台总权限管理员'),{statusCode:503});}}
 async function authorize(actor){const accounts=await getAccounts(),matches=accounts.filter(row=>row.accountId===actor);if(matches.length!==1||matches[0].role!=='super_admin'||!isAccountActive(matches[0])||matches[0].emailVerified!==true)throw Object.assign(new Error('仅平台总权限管理员可以分配活动权限'),{statusCode:403});return accounts;}
 return {
  async settings(actor){const accounts=await authorize(actor),data=await read();return {version:data.version||0,assignments:data.assignments||[],legacyRows:data.rows?.length||0,accounts:accounts.filter(row=>['super_admin','platform_admin'].includes(row.role)&&isAccountActive(row)&&row.emailVerified===true&&hasPermission(row,'events')).map(row=>({id:row.accountId,name:row.realName||row.label||row.accountId}))};},
  save:(actor,body)=>queue(async()=>{
   const accounts=await authorize(actor),data=await read();
   if(!body||Object.keys(body).some(key=>!['version','assignments'].includes(key))||!Number.isSafeInteger(body.version)||body.version!==(data.version||0))throw Object.assign(new Error('活动权限配置已变化，请刷新后核对'),{statusCode:409});
   compileWorkspaceRoleAssignments(body.assignments,accounts,{validateAccounts:true});
   if(body.assignments.filter(row=>row.roles.includes('R11')).length>3)throw Object.assign(new Error('平台总权限最多配置三人'),{statusCode:400});
   const next={...data,version:body.version+1,managedAccountIds:[...new Set([...(data.managedAccountIds||[]),...(data.assignments||[]).map(row=>row.accountId),...(data.rows||[]).map(row=>row.accountId),...body.assignments.map(row=>row.accountId)])],assignments:structuredClone(body.assignments)};
   await mkdir(dirname(path),{recursive:true});const temporary=`${path}.${randomUUID()}.tmp`;
   try{await writeFile(temporary,JSON.stringify(next,null,2)+'\n',{mode:0o600,flag:'wx'});await writeFile(path+'.configured','configured\n',{mode:0o600});await rename(temporary,path);}finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
   return {version:next.version};
  }),
 };
}
