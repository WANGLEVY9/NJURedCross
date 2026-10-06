/** Console mutations + private student view. No credentials or raw tables on public routes. */
import { workflowEventApproved } from './workflow.js';
import { registrationResult, workflowConfig } from './blood-roster.js';
import { storePhoto,removePhoto,sendPhoto } from './attendance-photo.js';
import { workflowParticipant } from './participant.js';
import { sendHoursWorkbook } from './hours-workbook.js';
export async function workflowRoutes(req,res,url,ctx){
 const admin=url.pathname.startsWith('/api/volunteer/workflow');
 const student=url.pathname.startsWith('/api/portal/workflow');
 const publicList=url.pathname==='/api/public/workflow/events';
 if(!admin&&!student&&!publicList)return false;
 if(publicList&&req.method!=='GET')return ctx.json(res,405,{ok:false,message:'仅支持读取'});
 const session=admin?ctx.requireConsoleAccess(req,res,'events'):student?ctx.requirePortalSession(req,res):null;
 if((admin||student)&&!session)return;
 const mutating=!['GET','HEAD'].includes(req.method);
 if(mutating){
   if(!ctx.requireCsrf(req,res,session))return;
   if(req.headers.origin){let trusted=false;try{trusted=new URL(req.headers.origin).host===req.headers.host;}catch{}if(!trusted)return ctx.json(res,403,{ok:false,code:'origin_forbidden',message:'请求来源不受信任。'});}
 }
 const w=await ctx.getWorkflow();
 if(publicList&&req.method==='GET'){const data=await w.publicRead();return ctx.json(res,200,{ok:true,events:data.events.filter(row=>!row.sourceSuperseded&&row['状态']==='报名中'&&workflowEventApproved(row)).map(row=>({id:row._id,name:row['活动名称'],date:row['报名日期'],slot:row['报名时段'],position:row['岗位'],location:row['地点'],capacity:Number(row['容量']),recommended:workflowConfig(row).recommended||null,remaining:Math.max(0,Number(row['容量'])-Number(workflowConfig(row).sourceOccupied||0)-data.registrations.filter(r=>[row['活动ID'],...(workflowConfig(row).sourceActivityIds||[])].includes(r['活动ID'])&&['待筛选','已确认','已签到'].includes(r['报名状态'])).length),work:row['工作内容']||'',notice:row['通知草稿'],blood:workflowConfig(row).blood||null}))});}
 if(student){const account=workflowParticipant(await ctx.getAccount(session));if(!account?.accountId)return ctx.json(res,403,{ok:false,message:'请先完成校园邮箱账号验证。'});
   if(req.method==='GET'&&url.pathname==='/api/portal/workflow/me'){const data=await w.read();const own=data.registrations.filter(row=>row['账号ID']===account.accountId);const ownEvents=new Set(own.map(row=>row['活动ID']));return ctx.json(res,200,{ok:true,participant:{realName:account.realName||'',email:account.email||'',campus:account.campus||''},registrations:own.map(row=>({eventId:data.events.find(e=>workflowConfig(e).sourceActivityIds?.includes(row['活动ID']))?._id||data.events.find(e=>e['活动ID']===row['活动ID'])?._id||'',code:row['报名ID'],date:row['报名日期'],slot:row['报名时段'],position:row['岗位'],status:row['报名状态'],entryStatus:row['录入状态'],result:registrationResult(row),leaveStatus:row['请假状态']||'',reason:row['处理说明']||'',leaveReason:row['请假原因']||'',attendanceSubmitted:Boolean(row['签到照片ID']),eventName:data.events.find(e=>e['活动ID']===row['活动ID'])?.['活动名称']||'',location:data.events.find(e=>e['活动ID']===row['活动ID'])?.['地点']||'',eventStatus:data.events.find(e=>e['活动ID']===row['活动ID'])?.['状态']||'',stopReason:data.events.find(e=>e['活动ID']===row['活动ID'])?.['停点说明']||''})),ledger:data.ledger.filter(row=>row['账号ID']===account.accountId).map(row=>({status:row['状态'],serviceHours:Number(row['服务时长']),trainingHours:Number(row['培训时长']),travelHours:Number(row['交通时长'])})),profile:(()=>{const p=data.profiles.find(row=>row['账号ID']===account.accountId);return p?{serviceHours:Number(p['志愿时长']),trainingHours:Number(p['培训时长']),travelHours:Number(p['交通时长'])}:null;})(),events:data.events.filter(row=>ownEvents.has(row['活动ID'])).map(row=>({activityId:row['活动ID'],name:row['活动名称']}))});}
   if(req.method==='GET'&&url.pathname==='/api/portal/workflow/wishlist')return ctx.json(res,200,{ok:true,wishlist:await (await ctx.getWishlist()).own(account)});
   const wish=url.pathname.match(/^\/api\/portal\/workflow\/events\/([^/]+)\/wishlist$/);
   if(wish&&['POST','DELETE'].includes(req.method)){const service=await ctx.getWishlist();await service[req.method==='POST'?'subscribe':'unsubscribe'](decodeURIComponent(wish[1]),account);return ctx.json(res,200,{ok:true});}
   const match=url.pathname.match(/^\/api\/portal\/workflow\/events\/([^/]+)\/register$/);
   if(req.method==='POST'&&match){const body=await ctx.readJson(req);if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['replacement','campus'].includes(key))||(body.replacement!==undefined&&typeof body.replacement!=='boolean')||(body.campus!==undefined&&!['','鼓楼','仙林','浦口','苏州','其他'].includes(body.campus)))return ctx.json(res,400,{ok:false,message:'报名资料由已验证账号自动获取，请勿提交身份覆盖字段。'});const result=await w.register(decodeURIComponent(match[1]),account,body);await ctx.audit(req,session,'workflow.registration.create',result._id);return ctx.json(res,201,{ok:true,result:{code:result['报名ID'],status:'待确认'},message:'已提交报名，等待名单确认。'});}
   const action=url.pathname.match(/^\/api\/portal\/workflow\/registrations\/([^/]+)\/(leave|attendance|photo)$/);
   if(action){const code=decodeURIComponent(action[1]);const row=await w.ownRegistration(code,account);
     if(req.method==='GET'&&action[2]==='photo')return sendPhoto(res,row['签到照片ID']);
     if(req.method==='POST'&&action[2]==='leave'){const body=await ctx.readJson(req);await w.requestLeave(code,account,body.reason);return ctx.json(res,200,{ok:true,message:'请假已提交，等待审批。'});}
     if(req.method==='POST'&&action[2]==='attendance'){if(row['报名状态']!=='已确认'||row['签到照片ID']||row['请假状态']==='待审批')return ctx.json(res,409,{ok:false,message:'当前报名不能提交签到。'});const photo=await storePhoto(req);try{const result=await w.submitAttendance(code,account,photo);return ctx.json(res,200,{ok:true,result});}catch(error){await removePhoto(photo);throw error;}}
   }
   return ctx.json(res,404,{ok:false,message:'流程接口不存在'});
 }
 if(admin){
   if(req.method==='GET'&&url.pathname==='/api/volunteer/workflow')return ctx.json(res,200,{ok:true,...await w.overview(),testOnly:w.mode!=='production'});
   const reviewMatch=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/(hours-review|hours-export|attendance-batch|hours-approve)$/);
   if(reviewMatch){
     const id=decodeURIComponent(reviewMatch[1]),action=reviewMatch[2];
     if(req.method==='GET'&&action==='hours-review')return ctx.json(res,200,{ok:true,...await w.reviewDraft(id)});
     if(['GET','HEAD'].includes(req.method)&&action==='hours-export'){
       const draft=await w.exportDraft(id);
       if(req.method==='HEAD'){
         res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
         return res.end();
       }
       await ctx.audit(req,session,'workflow.hours.export',id);
       return sendHoursWorkbook(res,draft,`${draft.eventName}-志愿时长录入表.xlsx`);
     }
     if(req.method==='POST'&&['attendance-batch','hours-approve'].includes(action)){
       const body=await ctx.readJson(req);
       if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='items'))return ctx.json(res,400,{ok:false,message:'批量操作字段无效'});
       const result=action==='attendance-batch'?await w.attendanceBatch(id,body.items,ctx.actor(session)):await w.approveBatch(id,body.items,ctx.actor(session),session.role);
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
     const body=await ctx.readJson(req),ids=body.ids;
     if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length||!['confirm','checkin-review'].includes(body.action))return ctx.json(res,400,{ok:false,message:'请选择同一活动的有效报名，单次最多100条'});
     const data=await w.overview(),rows=ids.map(id=>data.registrations.find(r=>r._id===id));
     if(rows.some(r=>!r)||new Set(rows.map(r=>r['活动ID'])).size!==1)return ctx.json(res,400,{ok:false,message:'批量操作必须属于同一活动'});
     const results=[],actor=ctx.actor(session);
     for(const id of ids){try{const result=body.action==='confirm'?await w.confirm(id):await w.checkinAndReview(id,actor,body);await ctx.audit(req,session,`workflow.registrations.${body.action}`,id);results.push({id,ok:true,result:result||null});}catch(error){if(!error.statusCode)throw error;results.push({id,ok:false,message:error.message});}}
     return ctx.json(res,200,{ok:true,results});
   }
   const download=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/export.xlsx$/);
   if(download&&['GET','HEAD'].includes(req.method)){const id=decodeURIComponent(download[1]),draft=await w.exportDraft(id);if(req.method==='HEAD'){res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Cache-Control':'no-store'});return res.end();}await ctx.audit(req,session,'workflow.hours.export',id);return sendHoursWorkbook(res,draft,`${draft.eventName}-志愿时长录入表.xlsx`);}
   const exportMatch=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/export-preview$/);
   if(req.method==='GET'&&exportMatch)return ctx.json(res,200,{ok:true,...await w.exportDraft(decodeURIComponent(exportMatch[1]))});
   const photoMatch=url.pathname.match(/^\/api\/volunteer\/workflow\/registrations\/([^/]+)\/photo$/);
   if(photoMatch&&req.method==='GET'){const data=await w.read();const row=data.registrations.find(r=>r._id===decodeURIComponent(photoMatch[1]));if(!row)return ctx.json(res,404,{ok:false,message:'报名不存在'});return sendPhoto(res,row['签到照片ID']);}
   const actor=ctx.actor(session);
   if(req.method==='GET'&&url.pathname==='/api/volunteer/workflow/sources'){let managed=[];const warnings=[];if(ctx.getManagedSources)try{managed=await ctx.getManagedSources();}catch{warnings.push('活动项目表暂时无法读取；志愿服务表中的活动仍可配置。');}return ctx.json(res,200,{ok:true,sources:await w.sources(managed),warnings});}
   if(req.method==='POST'&&url.pathname==='/api/volunteer/workflow/adopt'){const body=await ctx.readJson(req);const managed=body.key?.startsWith('managed:')&&ctx.getManagedSources?await ctx.getManagedSources():[];const row=await w.adopt(body.key,body.config,actor,managed);await ctx.audit(req,session,'workflow.source.adopt',row._id);return ctx.json(res,201,{ok:true,result:row});}
   const noticeMatch=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/notice$/);
   if(req.method==='PATCH'&&noticeMatch){await w.editNotice(decodeURIComponent(noticeMatch[1]),(await ctx.readJson(req)).text,actor);await ctx.audit(req,session,'workflow.events.notice',decodeURIComponent(noticeMatch[1]));return ctx.json(res,200,{ok:true});}
   const editMatch=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)$/);
   if(req.method==='PATCH'&&editMatch){await w.edit(decodeURIComponent(editMatch[1]),await ctx.readJson(req),actor);await ctx.audit(req,session,'workflow.events.edit',decodeURIComponent(editMatch[1]));return ctx.json(res,200,{ok:true});}

   if(req.method==='POST'&&url.pathname==='/api/volunteer/workflow/blood-roster'){const result=await w.prepareBloodWeek(await ctx.readJson(req),actor);await ctx.audit(req,session,'workflow.blood.prepare',String(result.count));return ctx.json(res,201,{ok:true,result});}
   if(req.method==='POST'&&url.pathname==='/api/volunteer/workflow/events'){const row=await w.create(await ctx.readJson(req),actor);return ctx.json(res,201,{ok:true,result:row});}
   const match=url.pathname.match(/^\/api\/volunteer\/workflow\/(events|registrations|hours)\/([^/]+)\/(approve|publish|confirm|checkin-review|checkin|review|post|stop|submit|archive|restore|close|reject|leave-approve|leave-reject)$/);
   if(match&&req.method==='POST'){const [,kind,encoded,action]=match,id=decodeURIComponent(encoded);const body=await ctx.readJson(req);let result;
     if(kind==='events'&&action==='approve')result=await w.approve(id,actor,session.role);
     else if(kind==='events'&&['submit','archive','restore','close'].includes(action))result=await w[action](id);
     else if(kind==='events'&&action==='stop')result=await w.stop(id,body.reason);
     else if(kind==='events'&&action==='publish')result=await w.publish(id);
     else if(kind==='registrations'&&action==='confirm')result=await w.confirm(id);
     else if(kind==='registrations'&&action==='reject')result=await w.reject(id,body.reason);
     else if(kind==='registrations'&&['leave-approve','leave-reject'].includes(action))result=await w.decideLeave(id,action==='leave-approve',body.reason);
     else if(kind==='registrations'&&action==='checkin-review')result=await w.checkinAndReview(id,actor,body);
     else if(kind==='registrations'&&action==='checkin')result=await w.checkin(id,actor,body.note);
     else if(kind==='registrations'&&action==='review')result=await w.reviewHours(id,actor,body);
     else if(kind==='hours'&&action==='approve')result=await w.approveHours(id,actor,session.role);
     else if(kind==='hours'&&action==='post')result=await w.post(id);
     else return ctx.json(res,404,{ok:false,message:'操作不存在'});
     await ctx.audit(req,session,`workflow.${kind}.${action}`,id);
     return ctx.json(res,200,{ok:true,result:result||null});
   }
 }
 return ctx.json(res,404,{ok:false,message:'流程接口不存在'});
}
