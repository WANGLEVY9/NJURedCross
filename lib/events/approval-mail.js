import {createHash} from 'node:crypto';
import {workflowConfig} from './blood-roster.js';
import {eventResponsibleIds} from '../../public/app/shared/activity-responsibility.js';
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
  const staged=approval?.mode==='workspace-regional';
  const reviewerIds=approval?.levels?.final?.ids||approval?.reviewerIds;
  if(event['状态']!=='待审核'||approval?.policy!=='any'&&!staged||!Array.isArray(reviewerIds))continue;
  for(const id of new Set(reviewerIds)){
   const matches=accounts.filter(a=>(a.accountId||a.username)===id);
   if(matches.length!==1)continue;
   const account=matches[0];
   const permitted=staged?regionalReviewers[event._id]?.includes(id):account.role==='super_admin'||account.organization?.reviewer;
   if(!isAccountActive(account)||account.emailVerified!==true||!permitted||!/^\d+@(smail\.nju\.edu\.cn|nju\.edu\.cn)$/.test(account.email||'')||account.email.split('@')[0]!==account.studentId)continue;
   const hash=createHash('sha256').update(JSON.stringify([event['活动ID'],event['申请版本'],approval.submittedAt,id,...(staged?['final']:[])])).digest('hex');
   const stage=staged?'终审':'';
   const instruction=staged?`本邮件提醒当前${stage}审核人处理。终审通过后进入待发布阶段。`:'本申请由任意一位审核人批准即可进入下一阶段。';
   messages.push({to:account.email,subject:`南大红会｜活动待审批：${event['活动名称']}`,text:`${account.realName||'审核人'}：\n\n有一项活动申请等待${stage||'审核'}。\n活动：${event['活动名称']}\n${applicationSchedule(event,config)}\n\n前往审核：${site.origin}/console/events?event=${encodeURIComponent(event._id)}&mode=all\n\n${instruction}请以管理端显示的最新状态为准。`,kind:'workflow-result',idempotencyKey:`APPROVAL:${hash}`,activityId:event['活动ID']});
  }
 }
 return messages;
}

/** Only approvals committed with this feature opt in; never backfill historical mail. */
export function publicationMessages(events,accounts,origin){
 const site=new URL(origin);if(site.protocol!=='https:')throw Error('Publication origin must use HTTPS');
 const messages=[];
 for(const event of events){
  const c=workflowConfig(event),proof=c.publicationNotice;
  if(!proof||proof.version!==String(event['申请版本'])||String(event['批准版本'])!==proof.version||!event['审批时间']||!['可发布','报名中','进行中','已结束'].includes(event['状态'])||c.parentActivityId||c.workspaceRemoval)continue;
  const pending=event['状态']==='可发布',mode=pending?'待选择':c.publishAt?'定时发布':'立即发布';
  const published=typeof proof.publishedAt==='string'&&/Z$/.test(proof.publishedAt)&&Number.isFinite(Date.parse(proof.publishedAt))?new Date(Date.parse(proof.publishedAt)+8*3600000).toISOString().slice(0,19).replace('T',' '):null;
  const time=pending?'尚未选择，请由审核人在管理端设置':((c.publishAt?shanghaiInstant(c.publishAt)?.local.slice(0,19).replace('T',' '):published)||'请查看管理端发布记录')+'（北京时间）';
  for(const id of eventResponsibleIds(event)){
   const matches=accounts.filter(a=>(a.accountId||a.username)===id);if(matches.length!==1)continue;
   const a=matches[0];if(!isAccountActive(a)||a.emailVerified!==true||!/^\d+@(smail\.nju\.edu\.cn|nju\.edu\.cn)$/.test(a.email||'')||a.email.split('@')[0]!==a.studentId)continue;
   const hash=createHash('sha256').update(JSON.stringify([event['活动ID'],proof.version,proof.approvedAt,id,mode,c.publishAt||proof.publishedAt||''])).digest('hex');
   messages.push({to:a.email,subject:`南大红会｜活动审批通过：${event['活动名称']}`,kind:'workflow-result',idempotencyKey:`PUBLICATION:${hash}`,activityId:event['活动ID'],text:`${a.realName||'活动负责人'}：\n\n活动已通过终审。\n活动：${event['活动名称']}\n发布方式：${mode}\n发布时间：${time}\n\n以下为报名通知，可直接复制：\n\n${event['通知草稿']||'尚未填写报名通知，请在管理端完善。'}\n\n管理活动：${site.origin}/console/events?event=${encodeURIComponent(event._id)}`});
  }
 }
 return messages;
}
