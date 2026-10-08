import { registrationOpen } from '../../public/app/shared/activity-management.js';
import {publishedRosterRow,rosterReview} from '../../public/app/shared/roster-review.js';
import { managementRoutes } from './management-api.js';
import { hasPermission, isAccountActive } from '../permissions.js';
/** Console mutations + private student view. No credentials or raw tables on public routes. */
import { workflowEventApproved } from './workflow.js';
import { registrationResult, workflowConfig } from './blood-roster.js';
import { storePhoto,removePhoto,sendPhoto } from './attendance-photo.js';
import { workflowParticipant } from './participant.js';
export async function workflowRoutes(req,res,url,ctx){
 const admin=url.pathname.startsWith('/api/volunteer/workflow');
 const student=url.pathname.startsWith('/api/portal/workflow');
 const publicList=url.pathname==='/api/public/workflow/events';
 if(!admin&&!student&&!publicList)return false;
 if(publicList&&req.method!=='GET')return ctx.json(res,405,{ok:false,message:'仅支持读取'});
 const session=admin?ctx.requireConsoleAccess(req,res,'events'):student?ctx.requirePortalSession(req,res):null;
 if((admin||student)&&!session)return;
 const mutating=req.method!=='GET';
 if(mutating){
   if(!ctx.requireCsrf(req,res,session))return;
   if(req.headers.origin){let trusted=false;try{trusted=new URL(req.headers.origin).host===req.headers.host;}catch{}if(!trusted)return ctx.json(res,403,{ok:false,code:'origin_forbidden',message:'请求来源不受信任。'});}
 }
 const w=await ctx.getWorkflow();
 if(publicList&&req.method==='GET'){const data=await w.read();return ctx.json(res,200,{ok:true,events:data.events.filter(row=>registrationOpen(row)&&workflowEventApproved(row)).map(row=>({id:row._id,name:row['活动名称'],date:row['报名日期'],slot:row['报名时段'],position:row['岗位'],location:row['地点'],capacity:Number(row['容量']),notice:row['通知草稿'],full:data.registrations.filter(r=>r['活动ID']===row['活动ID']&&['待筛选','已确认','已签到'].includes(r['报名状态'])).length>=Number(workflowConfig(row).registrationLimit??row['容量']),blood:workflowConfig(row).blood||null}))});}
 if(student){const account=workflowParticipant(await ctx.getAccount(session));if(!account?.accountId)return ctx.json(res,403,{ok:false,message:'请先完成校园邮箱账号验证。'});
   if(req.method==='GET'&&url.pathname==='/api/portal/workflow/me'){const data=await w.read();const own=data.registrations.filter(row=>row['账号ID']===account.accountId).map(row=>publishedRosterRow(data.events.find(e=>e['活动ID']===row['活动ID']),row));const ownEvents=new Set(own.map(row=>row['活动ID']));return ctx.json(res,200,{ok:true,registrations:own.map(row=>({code:row['报名ID'],date:row['报名日期'],slot:row['报名时段'],position:row['岗位'],status:row['报名状态'],entryStatus:row['录入状态'],result:row['报名状态']==='待筛选'?'名单确认中':registrationResult(row),leaveStatus:row['请假状态']||'',reason:row['处理说明']||'',leaveReason:row['请假原因']||'',attendanceSubmitted:Boolean(row['签到照片ID']),eventName:data.events.find(e=>e['活动ID']===row['活动ID'])?.['活动名称']||'',location:data.events.find(e=>e['活动ID']===row['活动ID'])?.['地点']||'',eventStatus:data.events.find(e=>e['活动ID']===row['活动ID'])?.['状态']||'',stopReason:data.events.find(e=>e['活动ID']===row['活动ID'])?.['停点说明']||''})),ledger:data.ledger.filter(row=>row['账号ID']===account.accountId).map(row=>({status:row['状态'],serviceHours:Number(row['服务时长']),trainingHours:Number(row['培训时长']),travelHours:Number(row['交通时长'])})),profile:(()=>{const p=data.profiles.find(row=>row['账号ID']===account.accountId);return p?{serviceHours:Number(p['志愿时长']),trainingHours:Number(p['培训时长']),travelHours:Number(p['交通时长'])}:null;})(),events:data.events.filter(row=>ownEvents.has(row['活动ID'])).map(row=>({activityId:row['活动ID'],name:row['活动名称']}))});}
   const match=url.pathname.match(/^\/api\/portal\/workflow\/events\/([^/]+)\/register$/);
   if(req.method==='POST'&&match){const body=await ctx.readJson(req);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='replacement')||(body.replacement!==undefined&&typeof body.replacement!=='boolean'))return ctx.json(res,400,{ok:false,message:'报名资料由已验证账号自动获取，请勿提交身份覆盖字段。'});const result=await w.register(decodeURIComponent(match[1]),account,body);return ctx.json(res,201,{ok:true,result:{code:result['报名ID'],status:'待确认'},message:'已提交报名，等待名单确认。'});}
   const action=url.pathname.match(/^\/api\/portal\/workflow\/registrations\/([^/]+)\/(leave|attendance|photo)$/);
   if(action){const code=decodeURIComponent(action[1]);const row=await w.ownRegistration(code,account);
     if(req.method==='GET'&&action[2]==='photo')return sendPhoto(res,row['签到照片ID']);
     if(req.method==='POST'&&action[2]==='leave'){const body=await ctx.readJson(req);await w.requestLeave(code,account,body.reason);return ctx.json(res,200,{ok:true,message:'请假已提交，等待审批。'});}
     if(req.method==='POST'&&action[2]==='attendance'){const data=await w.read();if(rosterReview(data.events.find(e=>e['活动ID']===row['活动ID']))?.phase==='publishing')return ctx.json(res,409,{ok:false,message:'名单正在提交，请稍后再试。'});if(row['报名状态']!=='已确认'||row['签到照片ID']||row['请假状态']==='待审批')return ctx.json(res,409,{ok:false,message:'当前报名不能提交签到。'});const photo=await storePhoto(req);try{const result=await w.submitAttendance(code,account,photo);return ctx.json(res,200,{ok:true,result});}catch(error){await removePhoto(photo);throw error;}}
   }
   return ctx.json(res,404,{ok:false,message:'流程接口不存在'});
 }
 if(admin){
   const extended=await managementRoutes(req,res,url,ctx,w,session);if(extended!==false)return extended;
   async function validateOwners(body){if(!body?.coOwners?.length)return body;const directory=ctx.getDirectory?await ctx.getDirectory():[];if(!Array.isArray(body.coOwners)||body.coOwners.some(id=>!directory.some(a=>(a.accountId||a.username)===id&&isAccountActive(a)&&hasPermission(a,'events'))))throw Object.assign(new Error('补充负责人必须是有活动权限的在职管理员'),{statusCode:400});return body;}

   if(req.method==='GET'&&url.pathname==='/api/volunteer/workflow')return ctx.json(res,200,{ok:true,...await w.overview(),testOnly:true});
   const exportMatch=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/export-preview$/);
   if(req.method==='GET'&&exportMatch)return ctx.json(res,200,{ok:true,...await w.exportDraft(decodeURIComponent(exportMatch[1]))});
   const photoMatch=url.pathname.match(/^\/api\/volunteer\/workflow\/registrations\/([^/]+)\/photo$/);
   if(photoMatch&&req.method==='GET'){const data=await w.read();const row=data.registrations.find(r=>r._id===decodeURIComponent(photoMatch[1]));if(!row)return ctx.json(res,404,{ok:false,message:'报名不存在'});return sendPhoto(res,row['签到照片ID']);}
   const actor=ctx.actor(session);
   if(req.method==='GET'&&url.pathname==='/api/volunteer/workflow/sources'){let managed=[];const warnings=[];if(ctx.getManagedSources)try{managed=await ctx.getManagedSources();}catch{warnings.push('活动项目表暂时无法读取；志愿服务表中的活动仍可配置。');}return ctx.json(res,200,{ok:true,sources:await w.sources(managed),warnings});}
   if(req.method==='POST'&&url.pathname==='/api/volunteer/workflow/adopt'){const body=await ctx.readJson(req);const managed=body.key?.startsWith('managed:')&&ctx.getManagedSources?await ctx.getManagedSources():[];const row=await w.adopt(body.key,await validateOwners(body.config),actor,managed);await ctx.audit(req,session,'workflow.source.adopt',row._id);return ctx.json(res,201,{ok:true,result:row});}
   const noticeMatch=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/notice$/);
   if(req.method==='PATCH'&&noticeMatch){const body=await ctx.readJson(req);await w.editNotice(decodeURIComponent(noticeMatch[1]),body.text,actor,{publishAt:body.publishAt});await ctx.audit(req,session,'workflow.events.notice',decodeURIComponent(noticeMatch[1]));return ctx.json(res,200,{ok:true});}
   const editMatch=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)$/);
   if(req.method==='PATCH'&&editMatch){await w.edit(decodeURIComponent(editMatch[1]),await validateOwners(await ctx.readJson(req)),actor);await ctx.audit(req,session,'workflow.events.edit',decodeURIComponent(editMatch[1]));return ctx.json(res,200,{ok:true});}

   if(req.method==='POST'&&url.pathname==='/api/volunteer/workflow/blood-roster'){const result=await w.prepareBloodWeek(await ctx.readJson(req),actor);await ctx.audit(req,session,'workflow.blood.prepare',String(result.count));return ctx.json(res,201,{ok:true,result});}
   if(req.method==='POST'&&url.pathname==='/api/volunteer/workflow/events'){const row=await w.create(await validateOwners(await ctx.readJson(req)),actor);return ctx.json(res,201,{ok:true,result:row});}
   const match=url.pathname.match(/^\/api\/volunteer\/workflow\/(events|registrations|hours)\/([^/]+)\/(approve|publish|confirm|checkin|review|post|stop|submit|archive|restore|close|reject|revoke-confirmation|leave-approve|leave-reject)$/);
   if(match&&req.method==='POST'){const [,kind,encoded,action]=match,id=decodeURIComponent(encoded);const body=await ctx.readJson(req);let result;
     if(kind==='events'&&action==='approve')result=await w.approve(id,actor,session.role);
     else if(kind==='events'&&['submit','archive','restore','close'].includes(action))result=await w[action](id);
     else if(kind==='events'&&action==='stop')result=await w.stop(id,body.reason);
     else if(kind==='events'&&action==='publish')result=await w.publish(id);
     else if(kind==='registrations'&&['confirm','reject','revoke-confirmation'].includes(action)){
       const data=await w.read(),row=data.registrations.find(r=>r._id===id),event=data.events.find(e=>e['活动ID']===row?.['活动ID']);
       if(!event)return ctx.json(res,404,{ok:false,message:'报名不存在'});
       result=await w.stageRoster(event._id,[id],action==='confirm'?'confirm':action==='reject'?'reject':'reset',body.reason,body.token);
     }
     else if(kind==='registrations'&&['leave-approve','leave-reject'].includes(action))result=await w.decideLeave(id,action==='leave-approve',body.reason);
     else if(kind==='registrations'&&action==='checkin')result=await w.checkin(id,actor,body.note);
     else if(kind==='registrations'&&action==='review')result=await w.reviewHours(id,actor);
     else if(kind==='hours'&&action==='approve')result=await w.approveHours(id,actor,session.role);
     else if(kind==='hours'&&action==='post')result=await w.post(id);
     else return ctx.json(res,404,{ok:false,message:'操作不存在'});
     await ctx.audit(req,session,`workflow.${kind}.${action}`,id);
     return ctx.json(res,200,{ok:true,result:result||null});
   }
 }
 return ctx.json(res,404,{ok:false,message:'流程接口不存在'});
}
