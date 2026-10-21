import {createHash} from 'node:crypto';
import {workflowConfig} from './blood-roster.js';
import {isAccountActive} from '../permissions.js';
import {shanghaiInstant} from '../../public/app/shared/activity-window.js';

function applicationSchedule(event,config){
 const positions=(config.positionDraft||config.positionPlan)?.positions;
 if(config.bookingMode!=='grouped')return `日期：${event['报名日期']||'待补充'}\n时段：${event['报名时段']||'待补充'}\n地点：${event['地点']||'待补充'}`;
 if(!Array.isArray(positions)||!positions.length)return '岗位安排：暂缺，请在管理端核对。';
 const clock=value=>shanghaiInstant(value)?.local.slice(0,16).replace('T',' ')||'待补充';
 return '岗位安排：\n'+positions.map((p,index)=>`${index+1}. ${p.name||`岗位${index+1}`}\n时间：${clock(p.start)} - ${clock(p.end)}\n地点：${p.location||'待补充'}`).join('\n\n');
}

/** Messages are derived from committed applications and fresh reviewer identities. */
export function approvalMessages(events,accounts,origin,{regionalReviewers={}}={}){
 const site=new URL(origin);if(site.protocol!=='https:')throw new Error('Approval origin must use HTTPS');
 const messages=[];
 for(const event of events){
  const config=workflowConfig(event),approval=config.approval;
  const staged=approval?.mode==='workspace-regional'&&approval?.policy==='two-stage';
  if(event['状态']!=='待审核'||approval?.policy!=='any'&&!staged||!Array.isArray(approval?.reviewerIds))continue;
  for(const id of new Set(approval.reviewerIds)){
   const matches=accounts.filter(a=>(a.accountId||a.username)===id);
   if(matches.length!==1)continue;
   const account=matches[0];
   const permitted=staged?regionalReviewers[event._id]?.includes(id):account.role==='super_admin'||account.organization?.reviewer;
   if(!isAccountActive(account)||account.emailVerified!==true||!permitted||!/^\d+@(smail\.nju\.edu\.cn|nju\.edu\.cn)$/.test(account.email||'')||account.email.split('@')[0]!==account.studentId)continue;
   const hash=createHash('sha256').update(JSON.stringify([event['活动ID'],event['申请版本'],approval.submittedAt,id,...(staged?[approval.initialReview?'final':'initial']:[])])).digest('hex');
   const stage=staged?(approval.initialReview?'终审':'初审'):'';
   const instruction=staged?`本邮件提醒当前${stage}审核人处理。${approval.initialReview?'终审通过后进入待发布阶段。':'初审通过后还需终审。'}`:'本申请由任意一位审核人批准即可进入下一阶段。';
   messages.push({to:account.email,subject:`南大红会｜活动待审批：${event['活动名称']}`,text:`${account.realName||'审核人'}：\n\n有一项活动申请等待${stage||'审核'}。\n活动：${event['活动名称']}\n${applicationSchedule(event,config)}\n\n前往审核：${site.origin}/console/events?event=${encodeURIComponent(event._id)}&mode=all\n\n${instruction}请以管理端显示的最新状态为准。`,kind:'workflow-result',idempotencyKey:`APPROVAL:${hash}`,activityId:event['活动ID']});
  }
 }
 return messages;
}
