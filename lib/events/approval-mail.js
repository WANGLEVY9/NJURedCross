import {createHash} from 'node:crypto';
import {workflowConfig} from './blood-roster.js';
import {isAccountActive} from '../permissions.js';

/** Messages are derived from committed applications and fresh reviewer identities. */
export function approvalMessages(events,accounts,origin,{regionalReviewers={}}={}){
 const site=new URL(origin);if(site.protocol!=='https:')throw new Error('Approval origin must use HTTPS');
 const messages=[];
 for(const event of events){
  const approval=workflowConfig(event).approval;
  const staged=approval?.mode==='workspace-regional'&&approval?.policy==='two-stage';
  if(event['状态']!=='待审核'||approval?.policy!=='any'&&!staged||!Array.isArray(approval?.reviewerIds))continue;
  for(const id of new Set(approval.reviewerIds)){
   const matches=accounts.filter(a=>(a.accountId||a.username)===id);
   if(matches.length!==1)continue;
   const account=matches[0];
   const permitted=staged?regionalReviewers[event._id]?.includes(id):account.role==='super_admin'||account.organization?.reviewer;
   if(!isAccountActive(account)||account.emailVerified!==true||!permitted||!/^\d+@(smail\.nju\.edu\.cn|nju\.edu\.cn)$/.test(account.email||'')||account.email.split('@')[0]!==account.studentId)continue;
   const hash=createHash('sha256').update(JSON.stringify([event['活动ID'],event['申请版本'],approval.submittedAt,id,...(staged?[approval.initialReview?'final':'initial']:[])])).digest('hex');
   messages.push({to:account.email,subject:`南大红会｜活动待审批：${event['活动名称']}`,text:`${account.realName||'审核人'}：\n\n有一项活动申请等待审核。\n活动：${event['活动名称']}\n日期：${event['报名日期']}\n时段：${event['报名时段']}\n地点：${event['地点']}\n\n前往审核：${site.origin}/console/events?event=${encodeURIComponent(event._id)}&mode=all\n\n本申请由任意一位审核人批准即可进入下一阶段。请以管理端显示的最新状态为准。`,kind:'workflow-result',idempotencyKey:`APPROVAL:${hash}`,activityId:event['活动ID']});
  }
 }
 return messages;
}
