import {publicWorkflowEvents} from './public-workflow-events.js';
import {activityProjectKey} from '../../public/app/shared/activity-projects.js';
import {publishedRosterRow,rosterReview} from '../../public/app/shared/roster-review.js';
import { managementRoutes } from './management-api.js';
import { hasPermission, isAccountActive } from '../permissions.js';
/** Console mutations + private student view. No credentials or raw tables on public routes. */
import { registrationResult, workflowConfig } from './blood-roster.js';
import {ordinaryConfig} from './ordinary-groups.js';
import { sendPhoto } from './attendance-photo.js';
import { submitAttendancePhoto } from './attendance-submission.js';
import { workflowParticipant } from './participant.js';
import { sendHoursWorkbook } from './hours-workbook.js';
import {approvalRoutingRoutes} from './approval-routing.js';
import {assertRecordAuthority} from './organization-authority.js';
import {workspaceDraftRoutes} from './workspace-draft-api.js';
import {parseRunningFile} from './running-import.js';
/** Wake result delivery after committed decisions. Never awaits SMTP in the request. */
function notifyDecisions(ctx,items){
 if(!items.length)return false;
 try{
  if(ctx.notifyRegistrationDecisions)return ctx.notifyRegistrationDecisions(items)!==false;
  if(ctx.queueRegistrationNotifications){ctx.queueRegistrationNotifications();return true;}
 }catch{/* The decision is committed; delivery is reconciled separately. */}
 return false;
}
function attendanceOpen(event,events){
 if(!event)return false;
 const project=events.filter(row=>activityProjectKey(row)===activityProjectKey(event));
 return !project.some(row=>workflowConfig(row).runningReview?.status==='submitted')&&(event['状态']==='报名中'||event['状态']==='进行中'&&project.some(row=>workflowConfig(row).workspaceSubmission));
}
export async function workflowRoutes(req,res,url,ctx){
 const admin=url.pathname.startsWith('/api/volunteer/workflow');
 const student=url.pathname.startsWith('/api/portal/workflow');
 const publicList=url.pathname==='/api/public/workflow/events';
 if(!admin&&!student&&!publicList)return false;
 if(publicList&&req.method!=='GET')return ctx.json(res,405,{ok:false,message:'仅支持读取'});
 let authority;
 const mutating=!['GET','HEAD'].includes(req.method);
 const session=admin&&ctx.getEventAuthority?ctx.requirePortalSession(req,res):admin?ctx.requireConsoleAccess(req,res,'events'):student?ctx.requirePortalSession(req,res):null;
 if((admin||student)&&!session)return;
 if(admin&&ctx.getEventAuthority){
  // 展示读允许复用缓存的权限证据；写请求必须直读权威源再判定。
  authority=await ctx.getEventAuthority(session,{allowCache:!mutating});
  if(!authority.canEnter)return ctx.json(res,403,{ok:false,code:'event_scope_forbidden',message:'当前账号没有可管理的活动'});
 }
 if(mutating){
   if(!ctx.requireCsrf(req,res,session))return;
   if (req.headers.origin) {
     let trusted = false;
     try {
       const origin = new URL(req.headers.origin);
       trusted = origin.host === req.headers.host
         && ['http:', 'https:'].includes(origin.protocol);
     } catch {}

     if (!trusted) {
       return ctx.json(res, 403, {
         ok: false,
         code: 'origin_forbidden',
         message: '请求来源不受信任。',
       });
     }
   }
 }
 // Private drafts are not published event rows. Their service performs its own current-owner/scope checks.
 if(admin&&(url.pathname==='/api/volunteer/workflow/workspace-drafts'||url.pathname.startsWith('/api/volunteer/workflow/workspace-drafts/'))){
  return workspaceDraftRoutes(req,res,url,{...ctx,workspaceAuthority:authority},session);
 }
 if(authority){
  const readBody=ctx.readJson;let bodyPromise;
  const originalJson=ctx.json;
  ctx={...ctx,readJson:request=>bodyPromise||=(readBody(request)),json:(response,status,payload,...args)=>originalJson(response,status,Array.isArray(payload?.events)?authority.filter(payload):payload,...args)};
  const path=url.pathname.slice('/api/volunteer/workflow'.length);
  const target=path.match(/^\/(events|registrations|hours)\/([^/]+)(?:\/|$)/);
  if(path==='/events'&&req.method==='POST')authority.assertCreate(await ctx.readJson(req));
  else if(path==='/registrations/batch')await assertRecordAuthority(await ctx.getAuthorityBase(),authority,'registrations',(await ctx.readJson(req)).ids);
  else if(target){
   const id=decodeURIComponent(target[2]);
   if(target[1]==='events'){
    const current=authority.assertEvent(id);
    if(req.method==='PATCH'&&path===`/events/${target[2]}`){
     const body=await ctx.readJson(req);
     if(body.center!==(current?.['组织类别']||workflowConfig(current||{}).center))authority.assertCreate(body);
    }
   }else await assertRecordAuthority(await ctx.getAuthorityBase(),authority,target[1],[id]);
  }else if(path==='/directory'){
   if(url.searchParams.has('event'))authority.assertEvent(url.searchParams.get('event'));
  }else if(path==='/approval-routing'){
   if(mutating)authority.assertGlobal();
  }else if(!['','/catalog','/workspace'].includes(path))authority.assertGlobal();
 }
 if(publicList&&req.method==='GET'){const data=await (ctx.getPublicWorkflowData ? ctx.getPublicWorkflowData() : (await ctx.getWorkflow()).publicRead());return ctx.json(res,200,{ok:true,events:publicWorkflowEvents(data)});}
 if(admin){const routed=await approvalRoutingRoutes(req,res,url,ctx,session);if(routed!==false)return routed;}
 const workflow=await ctx.getWorkflow();
 const w=authority?new Proxy(workflow,{get(target,key){
  if(['read','overview','catalog','detail'].includes(key))return async(...args)=>authority.filter(await target[key](...args));
  return target[key];
 }}):workflow;
 if(student){const account=workflowParticipant(await ctx.getAccount(session));if(!account?.accountId)return ctx.json(res,403,{ok:false,message:'请先完成校园邮箱账号验证。'});
   if(req.method==='GET'&&url.pathname==='/api/portal/workflow/me'){const data=await w.memberRead();const own=data.registrations.filter(row=>row['账号ID']===account.accountId).map(row=>publishedRosterRow(data.events.find(e=>e['活动ID']===row['活动ID']),row));const ownEvents=new Set(own.map(row=>row['活动ID']));return ctx.json(res,200,{ok:true,participant:{realName:account.realName||'',email:account.email||'',campus:account.campus||'',studentId:account.studentId||'',department:account.department||'',grade:account.grade||''},registrations:own.map(row=>({eventId:data.events.find(e=>workflowConfig(e).sourceActivityIds?.includes(row['活动ID']))?._id||data.events.find(e=>e['活动ID']===row['活动ID'])?._id||'',code:row['报名ID'],date:row['报名日期'],slot:row['报名时段'],position:row['岗位'],status:row['报名状态'],entryStatus:row['录入状态'],category:row['活动类型']?row['活动类别']:'',region:row['地区']||'',tableHours:row['志愿时长']===''||row['志愿时长']==null?null:Number(row['志愿时长']),remark:row['备注']||'',notes:row['注意事项']||'',result:row['报名状态']==='待筛选'?'名单确认中':registrationResult(row),leaveStatus:row['请假状态']||'',reason:row['处理说明']||'',leaveReason:row['请假原因']||'',attendanceOpen:attendanceOpen(data.events.find(e=>e['活动ID']===row['活动ID']),data.events),attendanceSubmitted:Boolean(row['签到照片ID']),eventName:row['活动名称']||data.events.find(e=>e['活动ID']===row['活动ID'])?.['活动名称']||'',location:row['地点']||data.events.find(e=>e['活动ID']===row['活动ID'])?.['地点']||'',eventStatus:data.events.find(e=>e['活动ID']===row['活动ID'])?.['状态']||'',stopReason:data.events.find(e=>e['活动ID']===row['活动ID'])?.['停点说明']||'',ordinary:ordinaryConfig(data.events.find(e=>e['活动ID']===row['活动ID'])||{})})),ledger:data.ledger.filter(row=>row['账号ID']===account.accountId).map(row=>({status:row['状态'],serviceHours:Number(row['服务时长']),trainingHours:Number(row['培训时长']),travelHours:Number(row['交通时长'])})),profile:(()=>{const p=data.profiles.find(row=>row['账号ID']===account.accountId);return p?{serviceHours:Number(p['志愿时长']),trainingHours:Number(p['培训时长']),travelHours:Number(p['交通时长'])}:null;})(),events:data.events.filter(row=>ownEvents.has(row['活动ID'])).map(row=>({activityId:row['活动ID'],name:row['活动名称']}))});}
   if(req.method==='GET'&&url.pathname==='/api/portal/workflow/wishlist')return ctx.json(res,200,{ok:true,wishlist:await (await ctx.getWishlist()).own(account)});
   const wish=url.pathname.match(/^\/api\/portal\/workflow\/events\/([^/]+)\/wishlist$/);
   if(wish&&['POST','DELETE'].includes(req.method)){const service=await ctx.getWishlist();await service[req.method==='POST'?'subscribe':'unsubscribe'](decodeURIComponent(wish[1]),account);return ctx.json(res,200,{ok:true});}
   const match=url.pathname.match(/^\/api\/portal\/workflow\/events\/([^/]+)\/register$/);
   if(req.method==='POST'&&match){const body=await ctx.readJson(req);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['replacement','consent'].includes(key))||(body.replacement!==undefined&&typeof body.replacement!=='boolean'))return ctx.json(res,400,{ok:false,message:'报名资料由已验证账号自动获取，请勿提交身份覆盖字段。'});if(body.consent!==true)return ctx.json(res,400,{ok:false,message:'请先阅读并确认参与须知。'});if(!String(account.campus||'').trim())return ctx.json(res,400,{ok:false,message:'请先在会员中心完善个人资料中的校区。'});const result=await w.register(decodeURIComponent(match[1]),account,body);await ctx.audit(req,session,'workflow.registration.create',result._id);return ctx.json(res,201,{ok:true,result:{code:result['报名ID'],status:result['报名状态']==='已确认'?'报名成功':'待确认'},message:result['报名状态']==='已确认'?'报名成功。':'已提交报名，等待名单确认。'});}
   const action=url.pathname.match(/^\/api\/portal\/workflow\/registrations\/([^/]+)\/(leave|attendance|photo)$/);
   if(action){const code=decodeURIComponent(action[1]);const row=await w.ownRegistration(code,account);
     if(req.method==='GET'&&action[2]==='photo')return sendPhoto(res,row['签到照片ID']);
     if(req.method==='POST'&&action[2]==='leave'){const body=await ctx.readJson(req);await w.requestLeave(code,account,body.reason);return ctx.json(res,200,{ok:true,message:'请假已提交，等待审批。'});}
     if (req.method === 'POST' && action[2] === 'attendance') {
       const data=await w.read();if(rosterReview(data.events.find(e=>e['活动ID']===row['活动ID']))?.phase==='publishing')return ctx.json(res,409,{ok:false,message:'名单正在提交，请稍后再试。'});
       if (
         row['报名状态'] !== '已确认' || row['请假状态']==='待审批'
         || row['签到照片ID']
         || row['请假状态'] === '待审批'
       ) {
         return ctx.json(res, 409, {
           ok: false,
           message: '当前报名不能提交签到。',
         });
       }

       const result = await submitAttendancePhoto(req, {
         submit: photoId => w.submitAttendance(code, account, photoId),
       });
       return ctx.json(res, 200, { ok: true, result });
     }
   }
   return ctx.json(res,404,{ok:false,message:'流程接口不存在'});
 }
 if(admin){
   const describe=events=>authority&&ctx.approvalRouting.describeForAuthority?ctx.approvalRouting.describeForAuthority(events,authority):ctx.approvalRouting.describe(events,ctx.actor(session));
   if(req.method==='GET'&&url.pathname==='/api/volunteer/workflow/catalog'){const data=await w.catalog(authority?.events);if(ctx.approvalRouting)data.events=await describe(data.events);return ctx.json(res,200,{ok:true,...data});}
   // 聚合端点：一次返回目录与选中活动的详情，消除前端 catalog → detail 的串行瀑布。
   if(req.method==='GET'&&url.pathname==='/api/volunteer/workflow/workspace'){
     const data=await w.catalog(authority?.events);
     if(ctx.approvalRouting)data.events=await describe(data.events);
     const target=url.searchParams.get('event');
     const chosen=target?data.events.find(e=>e._id===target||e['活动ID']===target):null;
     if(chosen){
       const detail=await w.detail(chosen._id,authority?.events);
       if(ctx.approvalRouting)detail.events=await describe(detail.events);
       // 顶层 payload 由 ctx.json 统一过滤；详情里的活动集合需要在这里先过滤一次。
       if(authority)detail.events=authority.filter({events:detail.events}).events;
       data.detail=detail;
     }
     return ctx.json(res,200,{ok:true,...data});
   }
   const detailMatch=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/detail$/);
   if(req.method==='GET'&&detailMatch){const data=await w.detail(decodeURIComponent(detailMatch[1]),authority?.events);if(ctx.approvalRouting)data.events=await describe(data.events);return ctx.json(res,200,{ok:true,...data});}
   const extended=await managementRoutes(req,res,url,ctx,w,session);if(extended!==false)return extended;
   const removal=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/workspace-removal$/);
   if(removal){
    const id=decodeURIComponent(removal[1]),actor=ctx.actor(session);
    if(req.method==='GET')return ctx.json(res,200,{ok:true,result:await w.workspaceRemoval(id,actor)});
    if(req.method==='POST'){const result=await w.removeWorkspace(id,await ctx.readJson(req),actor);await ctx.audit(req,session,'workflow.workspace.remove-event',id);return ctx.json(res,200,{ok:true,result});}
    return ctx.json(res,405,{ok:false,message:'请求方式无效'});
   }
   const finalHours=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/final-hours(?:-(export|download|mail))?$/);
   if(finalHours){
    const id=decodeURIComponent(finalHours[1]),action=finalHours[2]||'review',actor=ctx.actor(session);
    if(req.method==='GET'&&action==='review')return ctx.json(res,200,{ok:true,result:await w.finalHours(id,actor)});
    if(['GET','HEAD'].includes(req.method)&&action==='download'){
     const file=await w.downloadFinalHours(id,actor);res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="activity-hours.xlsx"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,'Content-Length':file.buffer.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:file.buffer);return;
    }
    if(req.method==='PATCH'&&action==='review'||req.method==='POST'&&['export','mail'].includes(action)){
     const body=await ctx.readJson(req),allowed=action==='review'?['token','items']:action==='export'?['token']:[];
     if(Object.keys(body).some(key=>!allowed.includes(key)))return ctx.json(res,400,{ok:false,message:'最终时长表字段无效'});
     let result;
     if(action==='review')result=await w.saveFinalHours(id,body,actor);
     if(action==='export'){
      result=await w.exportFinalHours(id,body,actor);
      if(ctx.queueFinalHoursMail)ctx.queueFinalHoursMail();
      else if(ctx.sendHoursMail)try{await w.deliverFinalHours(id,actor,ctx.sendHoursMail);}catch{/* Export is committed even when delivery must reconcile. */}
     }
     if(action==='mail')result=await w.deliverFinalHours(id,actor,ctx.sendHoursMail||(()=>Promise.resolve({ok:false})));
     await ctx.audit(req,session,`workflow.final-hours.${action}`,id);return ctx.json(res,200,{ok:true,result});
    }
    return ctx.json(res,405,{ok:false,message:'请求方式无效'});
   }
   const running=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/running-(review|import|preview|submit)$/);
   if(running){
    const id=decodeURIComponent(running[1]),action=running[2],actor=ctx.actor(session);
    if(req.method==='GET'&&action==='review')return ctx.json(res,200,{ok:true,result:await w.runningReview(id,actor)});
    if((req.method==='PATCH'&&action==='review')||(req.method==='POST'&&['import','preview','submit'].includes(action))){
     const body=await ctx.readJson(req),allowed=action==='import'?['name','bytes']:action==='submit'?['token','items','previewToken']:['token','items'];
     if(Object.keys(body).some(key=>!allowed.includes(key)))return ctx.json(res,400,{ok:false,message:'时长初审字段无效'});
     let result;
     if(action==='import'){
      const access=await w.runningReview(id,actor);if(!access.canRecord)return ctx.json(res,403,{ok:false,message:'仅本项目负责主任可以上传时长表'});
      result=await w.importRunningReview(id,await parseRunningFile(body),actor);
     }else result=await w[({review:'saveRunningReview',preview:'previewRunningReview',submit:'submitRunningReview'})[action]](id,body,actor);
     if(['review','submit'].includes(action))await ctx.audit(req,session,`workflow.running-${action}`,id);
     return ctx.json(res,200,{ok:true,result});
    }
    return ctx.json(res,405,{ok:false,message:'请求方式无效'});
   }
   async function validateOwners(body){if(!body?.coOwners?.length)return body;const directory=ctx.getDirectory?await ctx.getDirectory():[];if(!Array.isArray(body.coOwners)||body.coOwners.some(id=>!directory.some(a=>(a.accountId||a.username)===id&&isAccountActive(a)&&(authority?a.organization?.verified:hasPermission(a,'events')))))throw Object.assign(new Error('请选择目录中的有效负责人'),{statusCode:400});return body;}
   const ownersMatch=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/owners$/);
   if(ownersMatch&&req.method==='GET')return ctx.json(res,200,{ok:true,...await w.getOwners(decodeURIComponent(ownersMatch[1]))});
   if(ownersMatch&&req.method==='PATCH'){
     const id=decodeURIComponent(ownersMatch[1]);
     const body=await ctx.readJson(req);await validateOwners({...body,coOwners:[...(body.coOwners||[]),...(body.primary?[body.primary]:[])]});
     await w.setOwners(id,body,ctx.actor(session));
     await ctx.audit(req,session,'workflow.events.owners',id);
     return ctx.json(res,200,{ok:true});
   }
   const members=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/members$/);
   if(req.method==='GET'&&members)return ctx.json(res,200,{ok:true,...await w.members(decodeURIComponent(members[1]),url.searchParams.get('month'))});
   const attendanceDetail=url.pathname.match(/^\/api\/volunteer\/workflow\/registrations\/([^/]+)\/attendance-detail$/);
   if(req.method==='GET'&&attendanceDetail)return ctx.json(res,200,{ok:true,...await w.attendanceDetail(decodeURIComponent(attendanceDetail[1]))});
   if(req.method==='GET'&&url.pathname==='/api/volunteer/workflow'){const data=await w.overview();if(ctx.approvalRouting)data.events=await ctx.approvalRouting.describe(data.events,ctx.actor(session),session.role);return ctx.json(res,200,{ok:true,...data,testOnly:w.mode!=='production'});}
   const reviewMatch=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/(hours-review|hours-export|attendance-batch|hours-approve|hours-edit)$/);
   if(reviewMatch){
     const id=decodeURIComponent(reviewMatch[1]),action=reviewMatch[2];
     if(req.method==='GET'&&action==='hours-review')return ctx.json(res,200,{ok:true,...await w.reviewDraft(id,url.searchParams.get('month'))});
     if(['GET','HEAD'].includes(req.method)&&action==='hours-export'){
       const draft=await w.exportDraft(id,url.searchParams.get('month'));
       if(req.method==='HEAD'){
         res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
         return res.end();
       }
       await ctx.audit(req,session,'workflow.hours.export',id);
       return sendHoursWorkbook(res,draft,`${draft.eventName}-志愿时长录入表.xlsx`);
     }
     if(req.method==='POST'&&['attendance-batch','hours-approve','hours-edit'].includes(action)){
       const body=await ctx.readJson(req);
       if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['items',...(action==='attendance-batch'?[]:['month'])].includes(key)))return ctx.json(res,400,{ok:false,message:'批量操作字段无效'});
       const result=action==='attendance-batch'?await w.attendanceBatch(id,body.items,ctx.actor(session)):await w[action==='hours-edit'?'editReview':'approveBatch'](id,body.items,ctx.actor(session),session.role,body.month);
       await ctx.audit(req,session,`workflow.${action}`,id);
       return ctx.json(res,200,{ok:true,...result});
     }
   }
   const returnMatch=url.pathname.match(/^\/api\/volunteer\/workflow\/hours\/([^/]+)\/return$/);
   if(req.method==='POST'&&returnMatch){
     const body=await ctx.readJson(req),id=decodeURIComponent(returnMatch[1]);
     await w.returnHours(id,ctx.actor(session),session.role,body.reason,body.expectedDigest);
     await ctx.audit(req,session,'workflow.hours.return',id);return ctx.json(res,200,{ok:true});
   }
   const positions=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/positions$/);
   if(req.method==='GET'&&positions)return ctx.json(res,200,{ok:true,positions:await w.positions(decodeURIComponent(positions[1]))});
   if(req.method==='POST'&&url.pathname==='/api/volunteer/workflow/registrations/batch'){
     const body=await ctx.readJson(req),ids=body?.ids;
     if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length||!['confirm','leave-approve','leave-reject','checkin','checkin-review'].includes(body.action))return ctx.json(res,400,{ok:false,message:'请选择同一活动的有效报名，单次最多100条'});
     const leaveDecision=['leave-approve','leave-reject'].includes(body.action);
     if(leaveDecision&&(typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>500))return ctx.json(res,400,{ok:false,message:'请填写不超过500字的请假处理说明'});
     const data=await w.overview(),rows=ids.map(id=>data.registrations.find(r=>r._id===id));
     const scopes=rows.map(r=>{const event=data.events.find(e=>e['活动ID']===r?.['活动ID']);return event?activityProjectKey(event):null;});
     if(rows.some(r=>!r)||scopes.some(scope=>!scope)||new Set(scopes).size!==1)return ctx.json(res,400,{ok:false,message:'批量操作必须属于同一活动项目'});
     const results=[],actor=ctx.actor(session);
     for(const id of ids){try{const result=body.action==='confirm'?await w.confirm(id):leaveDecision?await w.decideLeave(id,body.action==='leave-approve',body.reason):body.action==='checkin'?await w.checkin(id,actor,'管理员批量核验现场到场'):await w.checkinAndReview(id,actor,body);await ctx.audit(req,session,`workflow.registrations.${body.action}`,id);results.push({id,ok:true,result:result||null});}catch(error){if(!error.statusCode)throw error;results.push({id,ok:false,message:error.message});}}
     const mailPending=(body.action==='confirm'||leaveDecision)&&notifyDecisions(ctx,results.filter(item=>item.ok).map(item=>({kind:leaveDecision?'leave':'confirm',id:item.id,...(leaveDecision?item.result?.notificationDecision:{})})));
     return ctx.json(res,200,{ok:true,results,...(mailPending?{mailPending:true}:{})});
   }
   const download=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/export.xlsx$/);
   if(download&&['GET','HEAD'].includes(req.method)){const id=decodeURIComponent(download[1]),draft=await w.exportDraft(id,url.searchParams.get('month'));if(req.method==='HEAD'){res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Cache-Control':'no-store'});return res.end();}await ctx.audit(req,session,'workflow.hours.export',id);return sendHoursWorkbook(res,draft,`${draft.eventName}-志愿时长录入表.xlsx`);}
   const exportMatch=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/export-preview$/);
   if(req.method==='GET'&&exportMatch)return ctx.json(res,200,{ok:true,...await w.exportDraft(decodeURIComponent(exportMatch[1]),url.searchParams.get('month'))});
   const photoMatch=url.pathname.match(/^\/api\/volunteer\/workflow\/registrations\/([^/]+)\/photo$/);
   if(photoMatch&&req.method==='GET'){const data=await w.read();const row=data.registrations.find(r=>r._id===decodeURIComponent(photoMatch[1]));if(!row)return ctx.json(res,404,{ok:false,message:'报名不存在'});return sendPhoto(res,row['签到照片ID']);}
   const actor=ctx.actor(session);
   const reopenRegistration=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/reopen-registration$/);
   if(reopenRegistration&&req.method==='POST'){
     const body=await ctx.readJson(req),id=decodeURIComponent(reopenRegistration[1]);
     if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='reason'))return ctx.json(res,400,{ok:false,message:'回退字段无效'});
     const result=await w.reopenRegistration(id,{actor,reason:body.reason});
     await ctx.audit(req,session,'workflow.events.reopen-registration',id,{reason:result.reason});return ctx.json(res,200,{ok:true,result});
   }
   const schedule=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/schedule$/);
   if(schedule&&req.method==='POST'){
     const body=await ctx.readJson(req),id=decodeURIComponent(schedule[1]);
     if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='publishAt')||!Object.hasOwn(body,'publishAt')||body.publishAt!==null&&typeof body.publishAt!=='string')return ctx.json(res,400,{ok:false,message:'请选择有效的定时发布时间'});
     const result=await w.schedulePublication(id,body.publishAt,actor);
     await ctx.audit(req,session,'workflow.events.schedule',id);return ctx.json(res,200,{ok:true,result:result||null});
   }
   const workspaceContent=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/(workspace-content|workspace-preview|workspace-resubmit)$/);
   if(workspaceContent){
     if(!ctx.getWorkspaceBridge)return ctx.json(res,503,{ok:false,message:'新版活动编辑尚未开放'});
     const bridge=await ctx.getWorkspaceBridge(session,authority),id=decodeURIComponent(workspaceContent[1]),action=workspaceContent[2];
     if(req.method==='GET'&&action==='workspace-content')return ctx.json(res,200,{ok:true,result:await bridge.content(id)});
     const body=await ctx.readJson(req),keys=action==='workspace-content'?['content','expectedVersion','token']:['token'];
     if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!keys.includes(key))||keys.some(key=>body[key]===undefined))return ctx.json(res,400,{ok:false,message:'活动编辑字段无效'});
     let result;
     if(req.method==='PATCH'&&action==='workspace-content')result=await bridge.save(id,body,actor);
     else if(req.method==='POST'&&action==='workspace-preview')result=await w.confirmWorkspacePreview(id,body,actor);
     else if(req.method==='POST'&&action==='workspace-resubmit')result=await w.resubmitWorkspace(id,body,actor);
     else return ctx.json(res,405,{ok:false,message:'操作不支持'});
     if(action==='workspace-resubmit')ctx.queueApprovalReminders?.();await ctx.audit(req,session,`workflow.events.${action}`,id);return ctx.json(res,200,{ok:true,result});
   }
   const configurePositions=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/configure-positions$/);
   if(configurePositions&&req.method==='POST'){
     const id=decodeURIComponent(configurePositions[1]),result=await w.configurePositions(id,await ctx.readJson(req),actor);
     await ctx.audit(req,session,'workflow.events.configure-positions',id);return ctx.json(res,200,{ok:true,result});
   }
   const returnApproval=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/return-approval$/);
   if(returnApproval&&req.method==='POST'){
     const id=decodeURIComponent(returnApproval[1]),body=await ctx.readJson(req);
     await w.returnApproval(id,actor,session.role,body.reason,body.token);
     await ctx.audit(req,session,'workflow.events.return-approval',id,{reason:body.reason});return ctx.json(res,200,{ok:true});
   }
   const settings=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/registration-settings$/);
   if(settings&&req.method==='PATCH'){const result=await w.ordinarySettings(decodeURIComponent(settings[1]),await ctx.readJson(req),actor);await ctx.audit(req,session,'workflow.group.registration-settings',result.groupId);return ctx.json(res,200,{ok:true,result});}
   if(req.method==='GET'&&url.pathname==='/api/volunteer/workflow/sources'){let managed=[];const warnings=[];if(ctx.getManagedSources)try{managed=await ctx.getManagedSources();}catch{warnings.push('活动项目表暂时无法读取；志愿服务表中的活动仍可配置。');}return ctx.json(res,200,{ok:true,sources:await w.sources(managed),warnings});}
   if(req.method==='POST'&&url.pathname==='/api/volunteer/workflow/adopt'){const body=await ctx.readJson(req);const managed=body.key?.startsWith('managed:')&&ctx.getManagedSources?await ctx.getManagedSources():[];const row=await w.adopt(body.key,await validateOwners(body.config),actor,managed);await ctx.audit(req,session,'workflow.source.adopt',row._id);return ctx.json(res,201,{ok:true,result:row});}
   const noticeMatch=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/notice$/);
   if(req.method==='PATCH'&&noticeMatch){const body=await ctx.readJson(req);await w.editNotice(decodeURIComponent(noticeMatch[1]),body.text,actor,{publishAt:body.publishAt});await ctx.audit(req,session,'workflow.events.notice',decodeURIComponent(noticeMatch[1]));return ctx.json(res,200,{ok:true});}
   const editMatch=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)$/);
   if(req.method==='PATCH'&&editMatch){await w.edit(decodeURIComponent(editMatch[1]),await validateOwners(await ctx.readJson(req)),actor);await ctx.audit(req,session,'workflow.events.edit',decodeURIComponent(editMatch[1]));return ctx.json(res,200,{ok:true});}

   if(req.method==='POST'&&url.pathname==='/api/volunteer/workflow/blood-roster'){const result=await w.prepareBloodWeek(await ctx.readJson(req),actor);await ctx.audit(req,session,'workflow.blood.prepare',String(result.count));return ctx.json(res,201,{ok:true,result});}
   if(req.method==='POST'&&url.pathname==='/api/volunteer/workflow/events'){const row=await w.create(await validateOwners(await ctx.readJson(req)),actor);if(row['状态']==='待审核')ctx.queueApprovalReminders?.();return ctx.json(res,201,{ok:true,result:row});}
  const match=url.pathname.match(/^\/api\/volunteer\/workflow\/(events|registrations|hours)\/([^/]+)\/(approve|publish|confirm|checkin-review|checkin-ticket|checkin|review|post|stop|submit|archive|restore|close|finish|reject|revoke-confirmation|leave-approve|leave-reject)$/);
  if(match&&req.method==='POST'){const [,kind,encoded,action]=match,id=decodeURIComponent(encoded);const body=await ctx.readJson(req);let result,decision=null;
    if(kind==='registrations'&&action==='checkin-ticket'){result=await w.issueCheckinTicket(id,actor);await ctx.audit(req,session,'workflow.registrations.checkin-ticket',id);return ctx.json(res,200,{ok:true,result});}
     if(kind==='events'&&action==='approve')result=await w.approve(id,actor,session.role,body.token);
     else if(kind==='events'&&action==='close'){
       if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='scope')||body.scope!==undefined&&!['event','project'].includes(body.scope))return ctx.json(res,400,{ok:false,message:'结束范围无效'});
       result=await w.close(id,{scope:body.scope,actor:ctx.actor(session)});
     }
     else if(kind==='events'&&['submit','archive','restore','finish'].includes(action))result=await w[action](id);
     else if(kind==='events'&&action==='stop')result=await w.stop(id,body.reason);
     else if(kind==='events'&&action==='publish')result=await w.publish(id,{publishAt:null,actor});
     else if(kind==='registrations'&&['confirm','reject','revoke-confirmation'].includes(action)){
       const data=await w.read(),row=data.registrations.find(r=>r._id===id),event=data.events.find(e=>e['活动ID']===row?.['活动ID']);
       if(!event)return ctx.json(res,404,{ok:false,message:'报名不存在'});
       if(body.token||rosterReview(event)||JSON.parse(event['报名页配置']||'{}').approval?.mode==='workspace-regional'){
         result=await w.stageRoster(event._id,[id],action==='confirm'?'confirm':action==='reject'?'reject':'reset',body.reason,body.token,{immediate:action==='confirm',actor});
         if((action==='confirm'||result.immediate)&&ctx.queueRegistrationNotifications)result.mailPending=true;
         else if(action==='confirm'||result.immediate)try{
           result.mail=await w.deliverRoster(event._id,{send:ctx.sendResultMail||(()=>Promise.resolve({ok:false})),statuses:ctx.getResultMailStatus});
           if(result.mail.remaining||result.mail.failedCount||result.mail.unknown?.length)result.mailPending=true;
         }catch{result.mailPending=true;}
       }
       else if(action==='revoke-confirmation')return ctx.json(res,409,{ok:false,message:'请从名单确认工作台进行调整。'});
       else{result=action==='confirm'?await w.confirm(id):await w.reject(id,body.reason);decision=action;}
     }
     else if(kind==='registrations'&&['leave-approve','leave-reject'].includes(action)){result=await w.decideLeave(id,action==='leave-approve',body.reason);decision='leave';}
     else if(kind==='registrations'&&action==='checkin-review')result=await w.checkinAndReview(id,actor,body);
     else if(kind==='registrations'&&action==='checkin'){if(!body.ticket)return ctx.json(res,400,{ok:false,message:'现场签到需要服务端签发的凭证'});result=await w.checkinByTicket(body.ticket,actor,body.note,id);}
     else if(kind==='registrations'&&action==='review')result=await w.reviewHours(id,actor,body);
     else if(kind==='hours'&&action==='approve')result=await w.approveHours(id,actor,session.role);
     else if(kind==='hours'&&action==='post')result=await w.post(id);
     else return ctx.json(res,404,{ok:false,message:'操作不存在'});
     await ctx.audit(req,session,`workflow.${kind}.${action}`,id);
     if(kind==='events'&&action==='submit')ctx.queueApprovalReminders?.();
     if(decision&&notifyDecisions(ctx,[{kind:decision,id,...(decision==='leave'?result?.notificationDecision:decision==='reject'?{reason:body.reason}:{})}]))result={...(result&&typeof result==='object'?result:{}),mailPending:true};
     return ctx.json(res,200,{ok:true,result:result||null});
   }
 }
 return ctx.json(res,404,{ok:false,message:'流程接口不存在'});
}
