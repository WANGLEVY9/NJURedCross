import {canonicalActivityCategory} from '../../public/app/shared/activity-taxonomy.js';
import {workspaceRosterEvidence} from './workspace-roster.js';
import {workspaceCategories,WORKSPACE_REGIONS} from '../../public/app/shared/activity-workspace.js';
import {isAccountActive} from '../permissions.js';
const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode,code:'workspace_responsible_invalid'});
/** A requested account ID is a choice, never an authorization claim. */
export function workspaceResponsibleOptions(actor,region,category,roster){
 category=canonicalActivityCategory(category);
 if(roster?.complete!==true||!Array.isArray(roster.rows))throw fail(503,'负责人名单尚未完整加载');
 if(!WORKSPACE_REGIONS.includes(region)||!workspaceCategories(region).includes(category))throw fail(400,'请先选择有效的活动地区和类别');
 const access=workspaceRosterEvidence(actor,region,roster.rows,{complete:true});
 if(!access.verified||!access.categories.includes(category))throw fail(403,'无权选择该地区和中心的负责人');
 const ids=[...new Set(roster.rows.filter(row=>row?.region===region&&typeof row.accountId==='string'&&row.accountId.length<=100).map(row=>row.accountId))];
 return ids.filter(id=>{const evidence=workspaceRosterEvidence(id,region,roster.rows,{complete:true});return evidence.verified&&evidence.role==='director'&&evidence.categories.includes(category);}).map(id=>{
  const row=roster.rows.find(row=>row.accountId===id&&row.region===region);return {id,name:typeof row.name==='string'&&row.name.trim()?row.name.trim():id};
 }).sort((a,b)=>a.id.localeCompare(b.id));
}
export function assertWorkspaceResponsible(content,actor,roster,{required=false}={}){
 if(!content.responsibleId){if(required)throw fail(400,'请选择活动负责人');return;}
 if(!workspaceResponsibleOptions(actor,content.region,content.category,roster).some(row=>row.id===content.responsibleId))throw fail(403,'活动负责人已停用或不属于对应地区和中心');
 return content.responsibleId;
}

/** Read-only identity join. Reuses the existing account binding columns, never
 * synchronizes/creates profiles and never accepts a browser-supplied profile row ID. */
export function workspaceResponsibleProfile(actor,region,category,targetId,roster,data){
 if(!workspaceResponsibleOptions(actor,region,category,roster).some(row=>row.id===targetId))throw fail(403,'无法查看该负责人的资料');
 if(data?.complete!==true||!data.baseUuid||!Array.isArray(data.accounts)||!Array.isArray(data.bindings)||!Array.isArray(data.profiles))throw fail(503,'个人资料档案尚未完整加载');
 const accounts=data.accounts.filter(row=>row.accountId===targetId),bindings=data.bindings.filter(row=>row['账号ID']===targetId);
 if(accounts.length!==1||bindings.length!==1)throw fail(409,'账号资料关联需核对');
 const account=accounts[0],binding=bindings[0];
 if(!isAccountActive(account)||account.emailVerified!==true||!/^\d{6,20}$/.test(account.studentId||'')||binding['资料BaseUUID']!==data.baseUuid||binding['资料同步状态']!=='已同步'||!binding['资料行ID'])throw fail(409,'个人资料档案尚未核验关联');
 if(data.bindings.some(row=>row['账号ID']!==targetId&&row['资料BaseUUID']===data.baseUuid&&row['资料行ID']===binding['资料行ID']))throw fail(409,'个人资料档案存在重复关联');
 const profiles=data.profiles.filter(row=>row._id===binding['资料行ID']);
 if(profiles.length!==1||String(profiles[0]['学号'])!==account.studentId||profiles[0]['姓名']!==account.realName)throw fail(409,'个人资料档案身份不一致');
 const profile=profiles[0];return {accountId:targetId,name:profile['姓名'],department:profile['院系']||'',grade:profile['年级']||'',campus:profile['校区']||''};
}
