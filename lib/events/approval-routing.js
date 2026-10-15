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
 if(Object.values(mappings).some(id=>typeof id!=='string'||id.length>100||id!==id.trim()))throw fail(400,'审核主席账号无效');
 return Object.fromEntries(ACTIVITY_CATEGORY_OPTIONS.map(category=>[category,mappings[category]||'']));
}

/** Account IDs are stable; names are display snapshots, never authority. */
export function createApprovalRouting({store,getAccounts,now=()=>Date.now()}){
 async function context(){const [settings,accounts]=await Promise.all([store.read(),getAccounts()]);return {settings,accounts};}
 function currentAccount(accounts,id){return accounts.find(a=>approvalAccountId(a)===id&&eligibleApprover(a));}
 function assertReviewerAccount(event,accounts,actor){
  const account=currentAccount(accounts,actor);
  if(!account)throw fail(403,'审核账号已停用或没有活动权限，请联系管理员');
  // Global approval comes from the fresh server-side account, never a body role or name.
  if(account.role==='super_admin')return account;
  const approval=workflowConfig(event).approval;
  if(!approval||approval.category!==approvalCategory(event))throw fail(409,'此申请尚未分配审核主席，请编辑后重新提交审批');
  if(approval.reviewerId!==actor)throw fail(403,'仅对应审核主席或超级管理员可以审核此活动');
  return account;
 }
 return {
  async assign(event){
   const {settings,accounts}=await context(),category=approvalCategory(event),id=settings.mappings[category];
   const account=currentAccount(accounts,id);
   if(!id||!account)throw fail(409,`${category}尚未配置可用的审核主席，请联系超级管理员；可以先保存草稿`);
   return {category,reviewerId:id,reviewerName:accountName(account),submittedAt:new Date(now()).toISOString()};
  },
  async assertReviewer(event,actor){const account=assertReviewerAccount(event,await getAccounts(),actor);return {reviewerId:approvalAccountId(account),reviewerName:accountName(account),role:account.role};},
  async describe(events,actor){
   const accounts=events.some(event=>event['状态']==='待审核')?await getAccounts():[];
   return events.map(event=>{
    let canReview=false;
    if(event['状态']==='待审核')try{const account=assertReviewerAccount(event,accounts,actor);canReview=account.role==='super_admin'||event['负责人账号ID']!==actor&&workflowConfig(event).lastEditor!==actor;}catch{/* Display denial; mutation returns the precise rejection. */}
    return {...event,approvalAccess:{required:true,canReview}};
   });
  },
  async settings(){
   const {settings,accounts}=await context();
   return {...settings,categories:ACTIVITY_CATEGORY_OPTIONS.map(category=>{const id=settings.mappings[category]||'',account=currentAccount(accounts,id);return {category,reviewerId:id,reviewerName:account?accountName(account):'',available:Boolean(account)};}),reviewers:accounts.filter(eligibleApprover).map(account=>({id:approvalAccountId(account),name:accountName(account)}))};
  },
  async save(body){
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['version','mappings'].includes(key)))throw fail(400,'审核主席配置字段无效');
   const mappings=validateApprovalMappings(body.mappings);
   return store.update(body.version,async()=>{
    const accounts=await getAccounts();
    if(Object.values(mappings).some(id=>id&&!currentAccount(accounts,id)))throw fail(400,'请选择启用且有活动权限的管理员作为审核主席');
    return mappings;
   });
  }
 };
}

export async function approvalRoutingRoutes(req,res,url,ctx,session){
 if(url.pathname!=='/api/volunteer/workflow/approval-routing')return false;
 if(!ctx.approvalRouting)throw fail(503,'审核主席配置服务不可用');
 if(req.method==='GET')return ctx.json(res,200,{ok:true,...await ctx.approvalRouting.settings(),canConfigure:session.role==='super_admin'});
 if(req.method==='PUT'){
  if(session.role!=='super_admin')throw fail(403,'仅超级管理员可以配置审核主席');
  const result=await ctx.approvalRouting.save(await ctx.readJson(req));
  await ctx.audit(req,session,'workflow.approval-routing.configure','activity-categories');
  return ctx.json(res,200,{ok:true,...result});
 }
 return ctx.json(res,405,{ok:false,message:'此接口仅支持读取和保存审核主席配置'});
}
