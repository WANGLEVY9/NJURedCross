/** Private management extensions. Directory output is an explicit business profile whitelist. */
import { hasPermission, isAccountActive } from '../permissions.js';
import {rosterReview,rosterMailKey} from '../../public/app/shared/roster-review.js';

/**
 * Result-mail evidence for one or several sessions of a project.
 *
 * Query registrations for the requested sessions only, then look up exact mail
 * keys once. No overview, check-in, ledger or profile table is needed.
 */
export async function mailStatusForEvents(ctx,w,ids,authorityEvents){
  const data=await w.mailStatusData(ids,authorityEvents);
  const groups=[];
  for(const id of ids){
    const event=data.events.find(e=>e._id===id);
    if(!event)continue;
    const review=rosterReview(event);
    const rows=data.registrations.filter(r=>r['活动ID']===event['活动ID']&&(review?(review.phase==='final'||review.immediate)&&review.published[r._id]:['已确认','已签到','未入选'].includes(r['报名状态'])));
    groups.push({review,rows,key:r=>rosterMailKey(r,review?.published?.[r._id])});
  }
  let statuses={};
  try{if(ctx.getResultMailStatus)statuses=await ctx.getResultMailStatus(groups.flatMap(group=>group.rows.map(group.key)));}catch{/* Missing records are unknown, never proof of non-delivery. */}
  return {
    items:groups.flatMap(({review,rows,key})=>rows.map(r=>{const k=key(r),receipt=review?.deliveries?.[k],status=receipt?.status==='sent'?receipt:statuses[k]?.status==='sent'?statuses[k]:receipt||statuses[k];return {id:r._id,status:['sent','failed','not_sent'].includes(status?.status)?status.status:'unknown',sentAt:status?.status==='sent'?status.sentAt||'':''};})),
    missing:ids.filter(id=>!data.events.some(e=>e._id===id)),
  };
}
export async function managementRoutes(req,res,url,ctx,w,session,authorityEvents) {
  const root='/api/volunteer/workflow';
  const mailEdit=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/success-mail$/);
  if(mailEdit&&req.method==='PATCH'){
    const body=await ctx.readJson(req),id=decodeURIComponent(mailEdit[1]);
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['template','token'].includes(key)))return ctx.json(res,400,{ok:false,message:'邮件编辑字段无效'});
    await w.saveSuccessMail(id,body.template,body.token);
    await ctx.audit(req,session,'workflow.success-mail.save',id);
    return ctx.json(res,200,{ok:true});
  }
  const statusMatch=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/mail-status$/);
  if(statusMatch&&req.method==='GET'){
    const {items,missing}=await mailStatusForEvents(ctx,w,[decodeURIComponent(statusMatch[1])],authorityEvents);
    if(missing.length)return ctx.json(res,404,{ok:false,message:'活动不存在'});
    return ctx.json(res,200,{ok:true,items});
  }
  // 批量端点在 workflow-api.js 中注册：那里才有逐活动的权限断言。
  if(url.pathname===`${root}/directory`&&req.method==='GET') {
    const accounts=ctx.getDirectory?await ctx.getDirectory():[];
    const eventId=url.searchParams.get('event');
    const data=eventId?await w.detail(eventId):url.searchParams.get('owners')==='true'?{registrations:[]}:await w.overview();const ids=new Set(data.registrations.map(r=>r['账号ID']));
    let participants=accounts;let profileWarning=false;
    if(ctx.getParticipantDirectory)try{participants=await ctx.getParticipantDirectory(accounts,data.registrations);}catch{profileWarning=true;}
    return ctx.json(res,200,{ok:true,administrators:accounts.filter(a=>isAccountActive(a)&&(ctx.getEventAuthority?a.organization?.verified:hasPermission(a,'events'))).map(a=>({id:a.accountId||a.username,name:a.realName||a.label||a.username,studentId:a.studentId||''})),
      profileWarning,participants:participants.filter(a=>ids.has(a.accountId)).map(a=>({accountId:a.accountId,realName:a.realName,studentId:a.studentId,campus:a.campus||'',department:a.department||'',organizationDepartment:a.organizationDepartment||a.division||'',grade:a.grade||'',phone:a.phone||'',email:a.email||'',gender:a.gender||'',wechat:a.wechat||'',qq:a.qq||'',certificateStatus:['yes','no'].includes(a.certificateStatus)?a.certificateStatus:'unknown',certificate:a.certificate||'',coreMemberStatus:['yes','no'].includes(a.coreMemberStatus)?a.coreMemberStatus:'unknown'}))});
  }
  const match=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/(batch-decide|finalize-roster|reopen-roster|notify-results)$/);
  if(!match||req.method!=='POST')return false;
  const id=decodeURIComponent(match[1]),body=await ctx.readJson(req);
  if(match[2]==='batch-decide'){
    if(!body||typeof body!=='object'||Array.isArray(body)||body.immediate!==undefined&&typeof body.immediate!=='boolean')return ctx.json(res,400,{ok:false,message:'名单审批字段无效'});
    // Both outcomes publish immediately; explicit draft edits remain compatible.
    // Explicit immediate:false remains available for a deliberate draft edit.
    const immediate=['confirm','reject'].includes(body.decision)&&body.immediate!==false;
    const result=await w.stageRoster(id,body.ids,body.decision,body.reason,body.token,{immediate,actor:ctx.actor(session)});
    if(immediate||result.immediate){
      try{
        if(ctx.queueRegistrationNotifications){
          result.mailPending=true;
          ctx.queueRegistrationNotifications();
        }else{
          result.mail=await w.deliverRoster(id,{send:ctx.sendResultMail||(()=>Promise.resolve({ok:false})),statuses:ctx.getResultMailStatus});
          if(result.mail.remaining||result.mail.failedCount||result.mail.unknown?.length)result.mailPending=true;
        }
      }
      catch{result.mailPending=true;}
    }
    await ctx.audit(req,session,'workflow.registrations.batch',id);
    return ctx.json(res,200,{ok:true,result});
  }
  if(match[2]==='reopen-roster'){
    await w.reopenRoster(id,body.token);await ctx.audit(req,session,'workflow.roster.reopen',id);return ctx.json(res,200,{ok:true});
  }
  if(match[2]==='finalize-roster'){
    await w.finalizeRoster(id,body.token,ctx.actor(session),{resumeOnly:true});await ctx.audit(req,session,'workflow.roster.finalize',id);
  }
  const result=await w.deliverRoster(id,{send:ctx.sendResultMail||(()=>Promise.resolve({ok:false})),statuses:ctx.getResultMailStatus,retry:body.retry===true});
  await ctx.audit(req,session,'workflow.registrations.notify',id);
  return ctx.json(res,200,{ok:true,result});
}
