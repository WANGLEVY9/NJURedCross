import {canonicalActivityCategory} from '../../public/app/shared/activity-taxonomy.js';
import {approvalCategory} from './approval-routing.js';
import {workflowConfig} from './blood-roster.js';
import {workspaceCategories} from '../../public/app/shared/activity-workspace.js';
import {workspaceRosterEvidence} from './workspace-roster.js';
import {activityKind} from '../../public/app/shared/activity-taxonomy.js';
import {eventResponsibleIds} from '../../public/app/shared/activity-responsibility.js';

const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode,code:'workspace_regional_approval'});
function versionOf(event){const version=event['申请版本'];if(!['string','number'].includes(typeof version)||!/^\d+$/.test(String(version))||!Number.isSafeInteger(Number(version))||Number(version)<1)throw fail(409,'申请版本无效');return String(Number(version));}
function scope(event){
 const config=workflowConfig(event),regions=[];
 for(const value of [event['活动地区'],config.region].filter(Boolean)){
  if(['南京地区','南京活动'].includes(value))regions.push('nanjing');
  else if(['苏州地区','苏州活动'].includes(value))regions.push('suzhou');
  else throw fail(409,'活动地区无效，请核对后重新提交');
 }
 if(!regions.length||new Set(regions).size!==1)throw fail(409,'活动地区不一致，请核对后重新提交');
 const region=regions[0],category=approvalCategory(event);
 if(config.center&&activityKind({center:config.center})!==category)throw fail(409,'活动类别不一致，请核对后重新提交');
 if(!workspaceCategories(region).includes(category))throw fail(409,'活动地区与类别不匹配');
 return {region,category};
}

/** Opt-in adapter for createWorkflow. Provider must return a complete trusted account roster.
 * It intentionally has no legacy global-super-admin fallback or client-selected recipients. */
export function createWorkspaceApprovalRouting({getRoster,now=()=>Date.now()}){
 if(typeof getRoster!=='function')throw new Error('缺少可信地区名单来源');
 async function evidence(){const data=await getRoster();if(data?.complete!==true||!Array.isArray(data.rows))throw fail(503,'地区审批名单尚未完整加载，请稍后重试');return data;}
 function eligible(data,actor,region,category,level='final'){
  const identity=workspaceRosterEvidence(actor,region,data.rows,{complete:true});
  if(!identity.verified||!identity.categories.includes(category))return false;
  if(identity.role==='global')return true;
  if(level==='initial')return identity.initialCategories?identity.initialCategories.includes(category):identity.role==='director';
  return identity.finalCategories?identity.finalCategories.includes(category):identity.role==='presidium';
 }
 async function assertReviewer(event,actor){
  if(event['状态']!=='待审核')throw fail(409,'只有待审批活动可以审核');
  const {region,category}=scope(event),data=await evidence();
  const approval=workflowConfig(event).approval;
  if(approval?.mode!=='workspace-regional'||approval.region!==region||canonicalActivityCategory(approval.category)!==category||approval.version!==versionOf(event))throw fail(409,'审批绑定已失效，请重新提交');
  const level=approval.levels&&!approval.initialReview?'initial':'final';
  if(!eligible(data,actor,region,category,level))throw fail(403,level==='initial'?'仅对应地区和类别的一级审核人可以初审':'仅对应地区和分管类别的二级审核人可以终审');
  const ids=approval.levels?.[level]?.ids||approval.reviewerIds;
  const row=data.rows.find(row=>row.accountId===actor&&row.region===region);
  if(approval.levels&&level==='final'&&approval.initialReview?.actor===actor&&row.role!=='global')throw fail(403,'初审与终审须由不同审核人处理，平台总权限可代处理');
  if(row.role!=='global'&&(!Array.isArray(ids)||!ids.includes(actor)))throw fail(403,'当前账号不在本次申请的审核名单中，请重新提交后审核');
  return {reviewerId:actor,reviewerName:row.name||actor,role:row.role==='global'?'super_admin':'platform_admin',canSelfReview:row.role==='global'||!approval.levels,approvalLevel:level,twoStage:Boolean(approval.levels)};
 }
 async function assertPublisher(event,actor){
   const {region,category}=scope(event),data=await evidence(),approval=workflowConfig(event).approval;
   if(!eligible(data,actor,region,category))throw fail(403,'仅对应地区和分管类别的二级审核人可以发布或调整定时发布');
   if(approval?.mode!=='workspace-regional'||approval.region!==region||canonicalActivityCategory(approval.category)!==category||approval.version!==versionOf(event))throw fail(409,'审批绑定已失效，请重新提交');
 }
 function assertRegistrarEvidence(event,actor,data){
   const {region,category}=scope(event);
   const identity=workspaceRosterEvidence(actor,region,data.rows,{complete:true});
   if(eligible(data,actor,region,category)||identity.role==='global')return;
   if((identity.role==='director'||identity.initialCategories?.includes(category))&&identity.categories.includes(category)&&eventResponsibleIds(event).includes(actor))return;
   throw fail(403,'仅本项目负责人和本地区主席团可以处理报名');
 }
 const globalActor=(data,actor)=>['nanjing','suzhou'].some(region=>workspaceRosterEvidence(actor,region,data.rows,{complete:true}).role==='global');
 async function assertRegistrar(event,actor){return assertRegistrarEvidence(event,actor,await evidence());}
 return {
  async authorizeRemovalProject(events,actor,{chairOnly=false,chairEvent}={}){
   if(!Array.isArray(events)||!events.length)throw fail(409,'项目活动为空，请刷新核对');
   const data=await evidence();
   if(globalActor(data,actor))return {canRemove:true};
   for(const event of events)assertRegistrarEvidence(event,actor,data);
   if(chairOnly){const {region,category}=scope(chairEvent||events[0]);return {canRemove:eligible(data,actor,region,category)};}
   return {canRemove:true};
  },
  async assign(event){
   const {region,category}=scope(event),data=await evidence();
   const ids=[...new Set(data.rows.filter(row=>row.region===region&&typeof row.accountId==='string'&&eligible(data,row.accountId,region,category)).map(row=>row.accountId))].sort();
   if(!ids.length||ids.length>50)throw fail(409,'活动所属地区未配置有效主席团名单，可以先保存草稿');
   const names=ids.map(id=>data.rows.find(row=>row.accountId===id&&row.region===region).name||id);
   const binding={mode:'workspace-regional',region,category,version:versionOf(event),reviewerIds:ids,reviewerNames:names,reviewerId:ids[0],reviewerName:names[0],policy:'any',submittedAt:new Date(now()).toISOString()};
   if(data.policy==='two-stage'){
    const initial=[...new Set(data.rows.filter(row=>row.region===region&&eligible(data,row.accountId,region,category,'initial')).map(row=>row.accountId))].sort();
    if(!initial.length||initial.length>50)throw fail(409,'该地区和类别尚未配置一级初审人员，可以先保存草稿');
    const initialNames=initial.map(id=>data.rows.find(row=>row.accountId===id&&row.region===region).name||id);
    binding.levels={initial:{ids:initial,names:initialNames},final:{ids,names}};
    Object.assign(binding,{reviewerIds:initial,reviewerNames:initialNames,reviewerId:initial[0],reviewerName:initialNames[0],policy:'two-stage'});
   }
   return binding;
  },
  assertReviewer,
  assertRemovalReviewer:async(event,actor)=>{const data=await evidence();if(['nanjing','suzhou'].some(region=>workspaceRosterEvidence(actor,region,data.rows,{complete:true}).role==='global'))return;const {region,category}=scope(event);if(!eligible(data,actor,region,category))throw fail(403,'仅对应地区和类别的二级审核人可以删除待审批活动');},
  assertRemovalManager:async(event,actor)=>{
   const data=await evidence();if(['nanjing','suzhou'].some(region=>workspaceRosterEvidence(actor,region,data.rows,{complete:true}).role==='global'))return;
   return assertRegistrar(event,actor);
  },
  assertPublisher,
  assertRegistrar,
  assertHoursReviewer:assertPublisher,
  async hoursRecipient(event){
   const {region,category}=scope(event),data=await evidence();
   const recipients=eventResponsibleIds(event).map(id=>{
    const identity=workspaceRosterEvidence(id,region,data.rows,{complete:true}),row=data.rows.find(row=>row.accountId===id&&row.region===region);
    if(!(identity.role==='global'||identity.role==='director'||identity.initialCategories?.includes(category))||!identity.categories.includes(category)||row?.emailVerified!==true||typeof row.email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)||/[\r\n]/.test(row.email))throw fail(503,'负责人的已验证邮箱尚未接入，请先完善人员档案');
    return {accountId:id,email:row.email};
   });
   if(!recipients.length)throw fail(503,'活动尚未配置有效负责人');
   return {...recipients[0],...(recipients.length>1?{recipients}:{})};
  },
  async assertHoursRecorder(event,actor){
   const {region,category}=scope(event),data=await evidence(),identity=workspaceRosterEvidence(actor,region,data.rows,{complete:true});
   if(identity.role==='global'||(identity.role==='director'||identity.initialCategories?.includes(category))&&identity.categories.includes(category)&&eventResponsibleIds(event).includes(actor))return;
   throw fail(403,'仅本项目负责主任可以进行时长初审');
  },
  async describe(events,actor){return Promise.all(events.map(async event=>{let canReview=false,canPublish=false,canManageRegistration=false;try{await assertRegistrar(event,actor);canManageRegistration=true;}catch{/* Fresh write authorization is still required. */}try{await assertPublisher(event,actor);canPublish=true;}catch{/* Publication has its own regional authority. */}if(event['状态']==='待审核')try{const reviewer=await assertReviewer(event,actor);canReview=reviewer.canSelfReview||!eventResponsibleIds(event).includes(actor)&&workflowConfig(event).lastEditor!==actor;}catch{/* Display only; writes re-read the roster independently. */}return {...event,approvalAccess:{required:true,canReview,canPublish,canManageRegistration}};}));},
 };
}
