import {ACTIVITY_CATEGORY_OPTIONS,activityKind} from '../../public/app/shared/activity-taxonomy.js';
import {hasPermission,isAccountActive} from '../permissions.js';
import {workflowConfig} from './blood-roster.js';

const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode,code:'activity_approval_routing'});
export const approvalAccountId=account=>account.accountId||account.username;
export const eligibleApprover=account=>isAccountActive(account)&&['platform_admin','super_admin'].includes(account.role)&&hasPermission(account,'events');
const accountName=account=>account.realName||account.label||account.username||approvalAccountId(account);
export function approvalCategory(event){const config=workflowConfig(event);return activityKind({center:event['组织类别']&&event['组织类别']!=='未分类'?event['组织类别']:config.center,type:event['活动类别']});}

export function validateApprovalMappings(mappings){
 if(!mappings||typeof mappings!=='object'||Array.isArray(mappings)||Object.keys(mappings).some(key=>!ACTIVITY_CATEGORY_OPTIONS.includes(key)))throw fail(400,'活动类别配置无效');
 if(Object.values(mappings).some(value=>{const ids=Array.isArray(value)?value:[value];return ids.length>50||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||id.length>100||id!==id.trim()||Array.isArray(value)&&!id);}))throw fail(400,'审核人账号无效');
 return Object.fromEntries(ACTIVITY_CATEGORY_OPTIONS.map(category=>[category,mappings[category]||'']));
}

/** Account IDs are stable; names are display snapshots, never authority. */
export function createApprovalRouting({store,getAccounts,organizationMode=false,now=()=>Date.now()}){
 const idsOf=value=>Array.isArray(value)?value:value?[value]:[];
 const organizationalReviewer=a=>isAccountActive(a)&&a.emailVerified===true&&a.organization?.verified===true&&a.organization?.reviewer===true;
 function canConfigureFrom(accounts,actor){const matches=accounts.filter(a=>approvalAccountId(a)===actor);return matches.length===1&&(organizationMode?organizationalReviewer(matches[0]):matches[0].role==='super_admin'&&isAccountActive(matches[0]));}
 async function canConfigure(actor){return canConfigureFrom(await getAccounts(),actor);}
 async function context(){const [settings,accounts]=await Promise.all([store.read(),getAccounts()]);return {settings,accounts};}
 function currentAccount(accounts,id){return accounts.find(a=>approvalAccountId(a)===id&&isAccountActive(a)&&(organizationMode?a.role==='super_admin'||a.organization?.reviewer===true:eligibleApprover(a)));}
 function assertReviewerAccount(event,accounts,actor){
  const account=currentAccount(accounts,actor);
  if(!account)throw fail(403,'审核账号已停用或没有活动权限，请联系管理员');
  // Global approval comes from the fresh server-side account, never a body role or name.
  if(account.role==='super_admin')return account;
  const approval=workflowConfig(event).approval;
  if(!approval||approval.category!==approvalCategory(event))throw fail(409,'此申请尚未分配审核主席，请编辑后重新提交审批');
  if(!(approval.reviewerIds||[approval.reviewerId]).includes(actor))throw fail(403,'仅对应审核主席或超级管理员可以审核此活动');
  return account;
 }
 function describeWithAccounts(events,actor,accounts){
  return events.map(event=>{
   let canReview=false;
   if(event['状态']==='待审核')try{const account=assertReviewerAccount(event,accounts,actor);canReview=account.role==='super_admin'||organizationMode&&account.organization?.global||event['负责人账号ID']!==actor&&workflowConfig(event).lastEditor!==actor;}catch{/* Display denial; mutations revalidate independently. */}
   let canReviewHours=false;try{assertReviewerAccount(event,accounts,actor);canReviewHours=true;}catch{/* Read-only projection. */}
   return {...event,approvalAccess:{required:true,canReview},hoursAccess:{canReview:canReviewHours}};
  });
 }
 return {
  canConfigure,
  // Only the server's current request authority may supply this evidence.
  // No directory-wide join is needed to describe the current actor's access.
  describeForAuthority(events,authority){return describeWithAccounts(events,authority.actor,[authority.account]);},
  async assign(event){
   if(organizationMode){
    const accounts=await getAccounts(),category=approvalCategory(event),ids=workflowConfig(event).reviewerIds??idsOf((await store.read()).mappings[category]);
    if(!Array.isArray(ids)||!ids.length||ids.length>50||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!accounts.some(a=>approvalAccountId(a)===id&&organizationalReviewer(a))))throw fail(400,'请选择有效的主席团或指导组审核人');
    return {category,reviewerIds:ids,reviewerNames:ids.map(id=>accountName(currentAccount(accounts,id))),reviewerId:ids[0],reviewerName:accountName(currentAccount(accounts,ids[0])),policy:'any',submittedAt:new Date(now()).toISOString()};
   }
   const {settings,accounts}=await context(),category=approvalCategory(event),selected=idsOf(settings.mappings[category]),id=selected[0];
   const account=currentAccount(accounts,id);
   if(!id||!account||selected.some(id=>!currentAccount(accounts,id)))throw fail(409,`${category}尚未配置可用的审核主席，请联系超级管理员；可以先保存草稿`);
   return {category,reviewerId:id,reviewerName:accountName(account),...(selected.length>1?{reviewerIds:selected,reviewerNames:selected.map(id=>accountName(currentAccount(accounts,id))),policy:'any'}:{}),submittedAt:new Date(now()).toISOString()};
  },
  async assertReviewer(event,actor){const account=assertReviewerAccount(event,await getAccounts(),actor);return {reviewerId:approvalAccountId(account),reviewerName:accountName(account),role:account.role,canSelfReview:Boolean(organizationMode&&account.organization?.global)};},
  async describe(events,actor){
   const accounts=events.length?await getAccounts():[];
   return describeWithAccounts(events,actor,accounts);
  },
  async settings(actor){
   const {settings,accounts}=await context(),canConfigure=canConfigureFrom(accounts,actor);
   if(organizationMode)return {...settings,canConfigure,mode:'organization',policy:'any',categories:ACTIVITY_CATEGORY_OPTIONS.map(category=>({category,reviewerIds:idsOf(settings.mappings[category])})),reviewers:accounts.filter(organizationalReviewer).map(a=>({id:approvalAccountId(a),name:accountName(a),studentId:a.studentId||''}))};
   return {...settings,canConfigure,categories:ACTIVITY_CATEGORY_OPTIONS.map(category=>{const ids=idsOf(settings.mappings[category]),id=ids[0]||'',account=currentAccount(accounts,id);return {category,reviewerIds:ids,reviewerId:id,reviewerName:account?accountName(account):'',available:ids.length>0&&ids.every(id=>Boolean(currentAccount(accounts,id)))};}),reviewers:accounts.filter(eligibleApprover).map(account=>({id:approvalAccountId(account),name:accountName(account)}))};
  },
  async save(body,actor){
   if(organizationMode&&!await canConfigure(actor))throw fail(403,'仅主席团和指导组成员可以配置默认审核人');
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['version','mappings'].includes(key)))throw fail(400,'审核主席配置字段无效');
   const mappings=validateApprovalMappings(body.mappings);
   return store.update(body.version,async()=>{
    const accounts=await getAccounts();
    if(organizationMode){
     if(!await canConfigure(actor))throw fail(403,'配置权限已变化，请刷新后重试');
     if(Object.values(mappings).flatMap(idsOf).some(id=>!accounts.some(a=>approvalAccountId(a)===id&&organizationalReviewer(a))))throw fail(400,'请选择启用的主席团或指导组成员');
     return Object.fromEntries(Object.entries(mappings).map(([category,value])=>[category,idsOf(value)]));
    }
    if(Object.values(mappings).flatMap(idsOf).some(id=>!currentAccount(accounts,id)))throw fail(400,'请选择启用且有活动权限的管理员作为审核主席');
    return mappings;
   });
  }
 };
}

export async function approvalRoutingRoutes(req,res,url,ctx,session){
 if(url.pathname!=='/api/volunteer/workflow/approval-routing')return false;
 if(!ctx.approvalRouting)throw fail(503,'审核主席配置服务不可用');
 const actor=ctx.actor?ctx.actor(session):session.accountId||session.username;
 if(req.method==='GET'){const settings=await ctx.approvalRouting.settings(actor);return ctx.json(res,200,{ok:true,...settings});}
 if(req.method==='PUT'){
  if(!await ctx.approvalRouting.canConfigure(actor))throw fail(403,'仅主席团和指导组成员可以配置默认审核人');
  const result=await ctx.approvalRouting.save(await ctx.readJson(req),actor);
  await ctx.audit(req,session,'workflow.approval-routing.configure','activity-categories');
  return ctx.json(res,200,{ok:true,...result});
 }
 return ctx.json(res,405,{ok:false,message:'此接口仅支持读取和保存审核主席配置'});
}
