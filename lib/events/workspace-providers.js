import {canonicalActivityCategory} from '../../public/app/shared/activity-taxonomy.js';
import {readFile} from 'node:fs/promises';
import {accountFromRow} from '../identity/store.js';
import {isAccountActive} from '../permissions.js';
import {WORKSPACE_REGIONS,workspaceCategories} from '../../public/app/shared/activity-workspace.js';
import {workflowConfig} from './blood-roster.js';
import {createWorkspaceApprovalRouting} from './workspace-approval-routing.js';
import {compileWorkspaceRoleAssignments,withWorkspaceSuperAdmins} from './workspace-role-policy.js';

const unavailable=(message='新版活动权限名单尚未完整加载')=>Object.assign(new Error(message),{statusCode:503,code:'workspace_roster_unavailable'});
const invalid=message=>Object.assign(new Error(message),{statusCode:503,code:'workspace_roster_invalid'});

/** Roster data is operator-maintained and only supplies role/region/category
 * bindings. Account status, email verification and email addresses always come
 * from the current identity snapshot. */
export function compileWorkspaceRoster(input,accounts){
  const rows=Array.isArray(input)?input:input?.rows;
  if(!Array.isArray(rows)||!rows.length)throw invalid('地区名单为空');
  const accountList=Array.isArray(accounts)?accounts:[];
  const byId=new Map();
  for(const account of accountList){
    if(!account?.accountId)continue;
    if(byId.has(account.accountId))throw invalid('账号表中存在重复账号ID');
    byId.set(account.accountId,account);
  }
  const seen=new Set();
  const compiled=rows.map((row,index)=>{
    const label=`地区名单第${index+1}行`;
    if(!row||typeof row!=='object'||Array.isArray(row))throw invalid(`${label}格式无效`);
    if(Object.keys(row).some(key=>!['accountId','region','role','categories','name'].includes(key)))throw invalid(`${label}包含未知字段`);
    const accountId=typeof row.accountId==='string'?row.accountId.trim():'';
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(accountId))throw invalid(`${label}账号ID无效`);
    if(!WORKSPACE_REGIONS.includes(row.region))throw invalid(`${label}地区无效`);
    if(!['presidium','director'].includes(row.role))throw invalid(`${label}角色无效`);
    const categories=Array.isArray(row.categories)?row.categories.map(canonicalActivityCategory):null;
    if(!Array.isArray(categories)||new Set(categories).size!==categories.length||categories.some(category=>!workspaceCategories(row.region).includes(category)))throw invalid(`${label}类别无效`);
    if(row.role==='director'&&!categories.length)throw invalid(`${label}主任必须绑定中心类别`);
    if(row.name!==undefined&&(typeof row.name!=='string'||row.name.length>80))throw invalid(`${label}姓名无效`);
    const identity=`${accountId}:${row.region}`;
    if(seen.has(identity))throw invalid(`${label}账号与地区重复`);
    seen.add(identity);
    const account=byId.get(accountId);
    return {
      accountId,
      region:row.region,
      role:row.role,
      categories:[...categories],
      name:(row.name||account?.realName||account?.label||accountId).trim(),
      active:Boolean(account&&isAccountActive(account)&&account.emailVerified===true&&/^\d{6,20}$/.test(String(account.studentId||''))),
      email:account?.email||'',
      emailVerified:account?.emailVerified===true,
    };
  });
  return {complete:true,rows:compiled};
}

export async function readWorkspaceRoster(path,accounts){
  let raw;
  try{raw=JSON.parse(await readFile(path,'utf8'));}
  catch(error){
    if(error.code==='ENOENT')return withWorkspaceSuperAdmins({complete:false,policy:'two-stage',rows:[]},accounts);
    throw unavailable('新版活动权限名单无法读取');
  }
  let roster;
  if(Array.isArray(raw.assignments)){
    const configured=compileWorkspaceRoleAssignments(raw.assignments,accounts),overridden=new Set(raw.assignments.map(row=>row.accountId));
    const previous=raw.rows?.length?compileWorkspaceRoster(raw,accounts).rows.filter(row=>!overridden.has(row.accountId)):[];
    roster={complete:true,policy:'two-stage',rows:[...previous,...configured]};
  }else roster=compileWorkspaceRoster(raw,accounts);
  return withWorkspaceSuperAdmins(roster,accounts);
}

const sqlText=value=>`'${String(value).replaceAll("'","''")}'`;

/** Exact read-only joins for the responsible person. No client-supplied
 * profile row ID, phone number or email address is accepted. */
export async function readWorkspaceProfileData({identityBase,volunteerBase,baseUuid,accountId}){
  if(typeof accountId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(accountId))throw invalid('负责人账号无效');
  const [accountRows,bindings]=await Promise.all([
    identityBase.query(`SELECT * FROM \`平台账号表\` WHERE 账号ID = ${sqlText(accountId)} LIMIT 2`),
    identityBase.query(`SELECT * FROM \`账号关联表\` WHERE 账号ID = ${sqlText(accountId)} LIMIT 2`),
  ]);
  const account=accountRows.length===1?accountFromRow(accountRows[0]):null;
  if(!account)return {complete:false};
  if(bindings.length!==1||bindings[0]['资料BaseUUID']!==baseUuid||typeof bindings[0]['资料行ID']!=='string'||!bindings[0]['资料行ID'])return {complete:false};
  const profiles=await volunteerBase.query(`SELECT * FROM \`个人主页（编辑版）\` WHERE _id = ${sqlText(bindings[0]['资料行ID'])} LIMIT 2`);
  return {complete:true,baseUuid,accounts:[account],bindings,profiles};
}

const regionalEvent=event=>{
  const config=workflowConfig(event);
  return config?.approval?.mode==='workspace-regional'||Boolean(config?.workspaceSubmission);
};

/** Keep the verified legacy reviewer flow intact while the new workspace uses
 * its own region-bound chair evidence. */
export function createActivityApprovalRouter({legacy,getRoster}){
  if(!legacy)throw new Error('缺少既有审批路由');
  const regional=createWorkspaceApprovalRouting({getRoster});
  const route=event=>regionalEvent(event)?regional:legacy;
  async function describePartitioned(events,legacyDescribe,regionalDescribe){
    const legacyEvents=[],regionalEvents=[],legacyIndexes=[],regionalIndexes=[];
    events.forEach((event,index)=>{
      if(regionalEvent(event)){regionalEvents.push(event);regionalIndexes.push(index);}
      else{legacyEvents.push(event);legacyIndexes.push(index);}
    });
    const [legacyRows,regionalRows]=await Promise.all([
      legacyEvents.length?legacyDescribe(legacyEvents):[],
      regionalEvents.length?regionalDescribe(regionalEvents):[],
    ]);
    const result=new Array(events.length);
    legacyRows.forEach((row,index)=>{result[legacyIndexes[index]]=row;});
    regionalRows.forEach((row,index)=>{result[regionalIndexes[index]]=row;});
    return result;
  }
  return {
    ...legacy,
    assign:event=>route(event).assign(event),
    assertReviewer:(event,actor)=>route(event).assertReviewer(event,actor),
    assertRemovalManager:(event,actor)=>regional.assertRegistrar(event,actor),
    assertRemovalReviewer:(event,actor)=>regional.assertRemovalReviewer(event,actor),
    assertPublisher:async(event,actor)=>{
      if(regionalEvent(event))return regional.assertPublisher(event,actor);
    },
    assertRegistrar:async(event,actor)=>{
      if(regionalEvent(event))return regional.assertRegistrar(event,actor);
    },
    assertHoursRecorder:async(event,actor)=>{
      if(regionalEvent(event))return regional.assertHoursRecorder(event,actor);
    },
    assertHoursReviewer:async(event,actor)=>{
      if(regionalEvent(event))return regional.assertHoursReviewer(event,actor);
      return legacy.assertReviewer(event,actor);
    },
    hoursRecipient:event=>{
      if(regionalEvent(event))return regional.hoursRecipient(event);
      throw unavailable('负责人附件邮件仅用于新版活动');
    },
    describe:(events,actor)=>describePartitioned(
      events,
      rows=>legacy.describe(rows,actor),
      rows=>regional.describe(rows,actor),
    ),
    describeForAuthority:(events,authority)=>describePartitioned(
      events,
      rows=>legacy.describeForAuthority?legacy.describeForAuthority(rows,authority):legacy.describe(rows,authority?.actor),
      rows=>regional.describe(rows,authority?.actor),
    ),
  };
}
