import {registryMetadata,registryType} from './special-registry.js';
import {workflowParticipant} from './participant.js';
import {missingProfileFields} from '../../public/app/shared/profile-completeness.js';
import {normalizeCompletionRegistration,normalizeProvinceRegistration,registryOpenStatus,registryDisplayStatus} from '../../public/app/shared/special-activity.js';
import {submitAttendancePhoto} from './attendance-submission.js';
import {sendPhoto} from './attendance-photo.js';
import {isAccountActive} from '../permissions.js';
const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode});
const exact=(body,keys)=>{if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k)))throw fail(400,'登记字段无效，个人资料由账号自动获取');return body;};
const publicEvent=event=>({id:event._id,name:event['活动名称'],status:registryDisplayStatus(event),location:event['地点'],notice:event['通知草稿'],type:registryType(event)});
/** Parent router has already established session, fresh authority, CSRF and same origin. */
export async function specialRegistryRoutes(req,res,url,ctx,w,session,authority){
 const admin=url.pathname.startsWith('/api/volunteer/');
 if(admin&&url.pathname==='/api/volunteer/workflow/special-registries'&&req.method==='POST'){
  const account=await ctx.getAccount(session);
  if(account?.role!=='super_admin'||account.emailVerified!==true||!isAccountActive(account))throw fail(403,'仅已验证且启用的超管可以启用长期登记项目');
  const result=await w.enableRegistry(exact(await ctx.readJson(req),['v','type','dailyCapacity']),ctx.actor(session));await ctx.audit(req,session,'workflow.registry.enable',result.id);return ctx.json(res,201,{ok:true,result});
 }
 if(admin&&url.pathname==='/api/volunteer/workflow/recurring-duty'){
  const account=await ctx.getAccount(session);
  if(account?.role!=='super_admin'||account.emailVerified!==true||!isAccountActive(account))throw fail(403,'仅已验证且启用的超管可以维护常态值班');
  if(req.method==='GET')return ctx.json(res,200,{ok:true,result:await w.recurringDutyStatus()});
  if(req.method==='POST'){const result=await w.configureRecurringDuty(exact(await ctx.readJson(req),['enabled']),ctx.actor(session));await ctx.audit(req,session,'workflow.recurring-duty.configure','province-publicity-duty');return ctx.json(res,200,{ok:true,result});}
  return ctx.json(res,405,{ok:false,message:'不支持此值班操作'});
 }
 const match=url.pathname.match(/^\/api\/(portal|volunteer)\/workflow\/events\/([^/]+)\/(registry|registry-certificate|registry-decisions|registry-end|registry-export.xlsx)$/);
 if(match){
  const id=decodeURIComponent(match[2]),action=match[3];let account;
  if(!admin){account=workflowParticipant(await ctx.getAccount(session));if(!account?.accountId)throw fail(403,'请先验证校园邮箱');}
  if(action==='registry'&&req.method==='GET'){
   const data=await w.registryList(id,account);authority?.assertEvent(data.event._id);
   const rows=data.rows.map(row=>({_id:row._id,code:row['报名ID'],date:row['报名日期'],name:row['姓名'],studentId:row['学号'],department:row['部门']||row['院系'],email:row['邮箱'],campus:row['校区'],status:row['报名状态'],time:row['报名时段'],position:row['岗位'],registry:row.registry,hasHours:row['志愿时长']!==''&&row['志愿时长']!=null}));
   return ctx.json(res,200,{ok:true,event:publicEvent(data.event),rows,...(!admin?{participant:{realName:account.realName,studentId:account.studentId,email:account.email,department:account.division||account.department||'',campus:account.campus||'',missing:missingProfileFields(account)}}:{})});
  }
  if(!admin&&['registry','registry-certificate'].includes(action)&&req.method==='POST'){
   const missing=missingProfileFields(account);if(missing.length)return ctx.json(res,400,{ok:false,code:'profile_incomplete',missing,message:'请先在会员中心补全：'+missing.join('、')});
   let result;
   if(action==='registry')result=await w.registryRegister(id,exact(await ctx.readJson(req),['date','requestId']),account);
   else{
    const data=await w.registryList(id,account);if(!registryOpenStatus(data.event['状态'])||!['province-service','component-donation'].includes(data.type))throw fail(409,'本项目未开放完成登记');
    if([...url.searchParams.keys()].some(k=>!(data.type==='component-donation'?['date','duration','quantity','requestId']:['date','start','end','location','requestId']).includes(k)||url.searchParams.getAll(k).length!==1))throw fail(400,'登记字段无效');
    const input=Object.fromEntries(url.searchParams);(data.type==='component-donation'?normalizeCompletionRegistration:normalizeProvinceRegistration)({...input,photoId:'00000000-0000-4000-8000-000000000000'},w.currentTime());
    result=await submitAttendancePhoto(req,{context:{eventId:data.event['活动ID'],eventName:data.event['活动名称'],name:account.realName,studentId:account.studentId,date:input.date,registrationCode:input.requestId},submit:photoId=>w.registryRegister(id,{...input,photoId},account)});
   }
   await ctx.audit(req,session,'workflow.registry.submit',result._id);return ctx.json(res,201,{ok:true,result:{id:result._id,code:result['报名ID']},message:'登记已提交，等待核验；核验通过后仍需时长终审。'});
  }
  if(admin&&action==='registry-decisions'&&req.method==='POST'){
   const body=exact(await ctx.readJson(req),['items','decision','reason']),result=await w.registryDecide(id,body.items,body.decision,body.reason,ctx.actor(session));await ctx.audit(req,session,'workflow.registry.decide',id,{decision:body.decision,count:body.items?.length});return ctx.json(res,200,{ok:true,result});
  }
  if(admin&&action==='registry-end'&&req.method==='POST'){
   const body=exact(await ctx.readJson(req),['reason']),result=await w.endRegistry(id,ctx.actor(session),body.reason);await ctx.audit(req,session,'workflow.registry.end',id);return ctx.json(res,200,{ok:true,result});
  }
  if(admin&&action==='registry-export.xlsx'&&req.method==='GET'){
   const data=await w.registryList(id);authority?.assertEvent(data.event._id);
   const {default:ExcelJS}=await import('exceljs'),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('登记记录');
   sheet.columns=[{header:'服务日期',key:'date',width:14},...(data.type==='province-service'?[{header:'服务时间',key:'time',width:18},{header:'岗位',key:'location',width:24}]:[]),{header:'姓名',key:'name',width:12},{header:'学号',key:'studentId',width:20},{header:'部门',key:'department',width:22},{header:'邮箱',key:'email',width:32},{header:'校区',key:'campus',width:12},...(data.type==='component-donation'?[{header:'献血量',key:'quantity',width:12}]:[]),{header:'核验状态',key:'state',width:14}];
   for(const row of data.rows){const meta=row.registry;sheet.addRow({date:row['报名日期'],time:meta?.start?meta.start+'–'+meta.end:row['报名时段'],location:meta?.location||row['岗位']||row['地点'],name:row['姓名'],studentId:String(row['学号']),department:row['部门']||row['院系'],email:row['邮箱'],campus:row['校区'],duration:meta?.duration,quantity:meta?.quantity,state:meta?.state==='verified'?'已核验':meta?.state==='returned'?'已退回':'待核验'});}
   sheet.getRow(1).font={bold:true};sheet.getColumn('studentId').numFmt='@';
   const buffer=await book.xlsx.writeBuffer();res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':"attachment; filename=registry.xlsx; filename*=UTF-8''"+encodeURIComponent(data.event['活动名称']+'登记记录.xlsx'),'Cache-Control':'no-store'});res.end(buffer);return;
  }
  return ctx.json(res,405,{ok:false,message:'不支持此登记操作'});
 }
 const photo=url.pathname.match(/^\/api\/(portal|volunteer)\/workflow\/registrations\/([^/]+)\/registry-certificate$/);
 if(photo&&req.method==='GET'){
  let row;if(admin)row=(await w.read()).registrations.find(r=>r._id===decodeURIComponent(photo[2]));else row=await w.ownRegistration(decodeURIComponent(photo[2]),workflowParticipant(await ctx.getAccount(session)));
  const meta=registryMetadata(row);if(!meta?.photoId)throw fail(404,'没有可查看的登记凭证');return sendPhoto(res,meta.photoId);
 }
 return false;
}
