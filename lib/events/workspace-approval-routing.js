import {approvalCategory} from './approval-routing.js';
import {workflowConfig} from './blood-roster.js';
import {workspaceCategories} from '../../public/app/shared/activity-workspace.js';
import {workspaceRosterEvidence,workspaceLevelAllowed} from './workspace-roster.js';
import {activityKind,canonicalActivityCategory} from '../../public/app/shared/activity-taxonomy.js';

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
 function eligible(data,actor,region,category,level='final'){return workspaceLevelAllowed(workspaceRosterEvidence(actor,region,data.rows,{complete:true}),category,level);}
 async function assertReviewer(event,actor){
  if(event['状态']!=='待审核')throw fail(409,'只有待审批活动可以审核');
  const {region,category}=scope(event),data=await evidence();
  if(!eligible(data,actor,region,category))throw fail(403,'仅活动所属地区和分管类别的终审人可以审核');
  const approval=workflowConfig(event).approval;
  if(approval?.mode!=='workspace-regional'||approval.region!==region||canonicalActivityCategory(approval.category)!==category||approval.version!==versionOf(event))throw fail(409,'审批绑定已失效，请重新提交');
  const reviewerIds=approval.levels?.final?.ids||approval.reviewerIds;
  if(!Array.isArray(reviewerIds)||!reviewerIds.includes(actor))throw fail(403,'当前账号不在本次申请的审核名单中，请重新提交后审核');
  const row=data.rows.find(row=>row.accountId===actor&&row.region===region);
  return {reviewerId:actor,reviewerName:row.name||actor,role:'platform_admin',canSelfReview:true};
 }
 async function assertPublisher(event,actor){
   const {region,category}=scope(event),data=await evidence(),approval=workflowConfig(event).approval;
   if(!eligible(data,actor,region,category))throw fail(403,'仅活动所属地区和分管类别的终审人可以发布或调整定时发布');
   if(approval?.mode!=='workspace-regional'||approval.region!==region||canonicalActivityCategory(approval.category)!==category||approval.version!==versionOf(event))throw fail(409,'审批绑定已失效，请重新提交');
 }
 async function assertRegistrar(event,actor){
   const {region,category}=scope(event),data=await evidence();
   const identity=workspaceRosterEvidence(actor,region,data.rows,{complete:true});
   if(eligible(data,actor,region,category))return;
   if(workspaceLevelAllowed(identity,category,'initial')&&[event['负责人账号ID'],...(workflowConfig(event).coOwners||[])].includes(actor))return;
   throw fail(403,'仅本项目负责人和本地区主席团可以处理报名');
 }
 return {
  async assign(event){
   const {region,category}=scope(event),data=await evidence();
   const ids=[...new Set(data.rows.filter(row=>row.region===region&&typeof row.accountId==='string'&&eligible(data,row.accountId,region,category)).map(row=>row.accountId))].sort();
   if(!ids.length||ids.length>50)throw fail(409,'活动所属地区未配置有效主席团名单，可以先保存草稿');
   const names=ids.map(id=>data.rows.find(row=>row.accountId===id&&row.region===region).name||id);
   return {mode:'workspace-regional',region,category,version:versionOf(event),reviewerIds:ids,reviewerNames:names,reviewerId:ids[0],reviewerName:names[0],policy:'any',submittedAt:new Date(now()).toISOString()};
  },
  assertReviewer,
  assertPublisher,
  assertRegistrar,
  assertHoursReviewer:assertPublisher,
  async hoursRecipient(event){
   const {region,category}=scope(event),data=await evidence(),id=event['负责人账号ID'],identity=workspaceRosterEvidence(id,region,data.rows,{complete:true});
   const row=data.rows.find(row=>row.accountId===id&&row.region===region);
   if(!workspaceLevelAllowed(identity,category,'initial')||row?.emailVerified!==true||typeof row.email!=='string'||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)||/[\r\n]/.test(row.email))throw fail(503,'负责人的已验证邮箱尚未接入，请先完善人员档案');
   return {accountId:id,email:row.email};
  },
  async assertHoursRecorder(event,actor){
   const {region,category}=scope(event),data=await evidence(),identity=workspaceRosterEvidence(actor,region,data.rows,{complete:true});
   if(workspaceLevelAllowed(identity,category,'initial')&&[event['负责人账号ID'],...(workflowConfig(event).coOwners||[])].includes(actor))return;
   throw fail(403,'仅本项目负责主任可以进行时长初审');
  },
  async describe(events,actor){return Promise.all(events.map(async event=>{let canReview=false,canPublish=false,canManageRegistration=false;try{await assertRegistrar(event,actor);canManageRegistration=true;}catch{/* Fresh write authorization is still required. */}try{await assertPublisher(event,actor);canPublish=true;}catch{/* Publication has its own regional authority. */}if(event['状态']==='待审核')try{await assertReviewer(event,actor);canReview=true;}catch{/* Display only; writes re-read the roster independently. */}return {...event,approvalAccess:{required:true,canReview,canPublish,canManageRegistration}};}));},
 };
}
