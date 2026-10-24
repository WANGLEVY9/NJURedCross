import {canonicalActivityCategory} from '../../public/app/shared/activity-taxonomy.js';
import {workspaceRosterEvidence} from './workspace-roster.js';
import {workspaceCategories,WORKSPACE_REGIONS,workspaceResponsibleIds,workspaceReviewerIds} from '../../public/app/shared/activity-workspace.js';
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
 return ids.filter(id=>{const evidence=workspaceRosterEvidence(id,region,roster.rows,{complete:true});return evidence.verified&&(evidence.role==='global'||evidence.role==='director'||evidence.initialCategories?.includes(category))&&evidence.categories.includes(category);}).map(id=>{
  const row=roster.rows.find(row=>row.accountId===id&&row.region===region);return {id,name:typeof row.name==='string'&&row.name.trim()?row.name.trim():id};
 }).sort((a,b)=>a.id.localeCompare(b.id));
}
export function workspaceReviewerOptions(region,category,roster){
 if(roster?.complete!==true||!Array.isArray(roster.rows))throw fail(503,'审批人名单尚未完整加载');
 return [...new Set(roster.rows.filter(row=>row.region===region).map(row=>row.accountId))].filter(id=>{
  const evidence=workspaceRosterEvidence(id,region,roster.rows,{complete:true});
  return evidence.verified&&evidence.categories.includes(category)&&(evidence.role==='global'||evidence.role==='presidium'&&(!evidence.finalCategories||evidence.finalCategories.includes(category)));
 }).map(id=>{const row=roster.rows.find(row=>row.accountId===id&&row.region===region);return {id,name:row.name||id,role:row.role};}).sort((a,b)=>a.id.localeCompare(b.id));
}

/** Names choose display defaults only; fresh role evidence and persisted account IDs grant authority. */
export function workspaceProjectPeopleOptions(actor,region,category,roster){
 category=canonicalActivityCategory(category);
 const collaborators=workspaceResponsibleOptions(actor,region,category,roster).filter(row=>row.id!==actor);
 const reviewers=workspaceReviewerOptions(region,category,roster),names=['金中宸','袁金雨'];
 const defaults=new Set(reviewers.filter(row=>row.role==='presidium').map(row=>row.id)),unavailableDefaults=[];
 for(const name of names){const matches=reviewers.filter(row=>row.name===name);if(matches.length===1)defaults.add(matches[0].id);else unavailableDefaults.push(name);}
 const self=roster.rows.find(row=>row.accountId===actor&&row.region===region);
 return {self:{id:actor,name:self?.name||actor},collaborators,reviewers:reviewers.map(({id,name})=>({id,name})),defaultReviewerIds:[...defaults],unavailableDefaults};
}

export function assertWorkspaceResponsible(content,actor,roster,{required=false,ownerId}={}){
 const ids=workspaceResponsibleIds(content);
 if(content.projectOwnerId!==undefined){
  if(ownerId&&content.projectOwnerId!==ownerId||ids[0]!==content.projectOwnerId)throw fail(403,'立项负责人须为草稿创建者，不能修改');
  const owner=workspaceRosterEvidence(content.projectOwnerId,content.region,roster?.rows,{complete:roster?.complete===true});
  if(!owner.verified||!owner.categories.includes(content.category))throw fail(403,'立项负责人的地区或中心权限已失效');
  const options=workspaceResponsibleOptions(actor,content.region,content.category,roster);
  if(ids.slice(1).some(id=>!options.some(row=>row.id===id)))throw fail(403,'协作负责人已停用或不属于对应地区和中心');
  const reviewers=workspaceReviewerIds(content),choices=workspaceReviewerOptions(content.region,content.category,roster);
  if(reviewers===undefined||required&&!reviewers.length)throw fail(400,'请选择审批人');
  if(reviewers.some(id=>!choices.some(row=>row.id===id)))throw fail(403,'审批人已停用或没有对应地区和中心的审批权限');
  return ids[0];
 }
 if(!ids.length){if(required)throw fail(400,'请选择活动负责人');return;}
 const options=workspaceResponsibleOptions(actor,content.region,content.category,roster);
 if(ids.some(id=>!options.some(row=>row.id===id)))throw fail(403,'活动负责人已停用或不属于对应地区和中心');
 return ids[0];
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
