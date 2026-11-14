import {createHash} from 'node:crypto';
import {projectEvents} from '../../public/app/shared/activity-projects.js';
import {workflowConfig} from './blood-roster.js';
const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode,code:'workspace_removal_conflict'});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Removal retains the parent, child jobs and every participation record. */
export function createWorkspaceRemoval({read,write,update,WF,authorizeRead,authorizeChair,authorizeProject,persistSourceRemoval,persistSourceRestoration,purgeRecords,now=()=>Date.now()}){
 async function context(id,actor){
  const data=await read(id),matches=data.events.filter(row=>row._id===id);
  if(matches.length!==1)throw fail(matches.length?409:404,'活动不存在或标识重复');
  const event=matches[0],c=workflowConfig(event);
  if(c.parentActivityId)throw fail(409,'请从项目活动操作');
  const receipt=c.workspaceRemoval,phase=receipt?.phase||event['状态'];
  const chairOnly=['待审核','可发布'].includes(phase)||phase==='报名中'&&Date.parse(c.publishAt)>now()||c.runningReview?.status==='submitted';
  const completed=phase==='已结束';
  const events=projectEvents(data.events,event);
  let canRemove=true;
  if(authorizeProject)canRemove=(await authorizeProject(events,actor,{chairOnly,chairEvent:event})).canRemove===true;
  else{
   for(const target of events)await authorizeRead(target,actor);
   try{if(chairOnly)await authorizeChair(event,actor);}catch(error){if(error.statusCode!==403)throw error;canRemove=false;}
  }
  const sourceManaged=events.some(row=>workflowConfig(row).source?.kind==='generated_blood');
  // 2026-11-14：唯一还拦住取消的是「本周已导出归档」——那是不可逆凭证，
  // 删掉会把学生的志愿时长一起抹掉。「已经有人报名」不再拦：活动办不成就该能取消，
  // 报名痕迹由 purgeRecords 一并清除（见 lib/events/activity-purge.js）。
  const exported=Boolean(c.bloodWeekArchive);
  const supported=['草稿','待审核','可发布','报名中','进行中','停点'].includes(phase);
  const reason=receipt?'活动已结束或移除，请刷新目录':completed?'活动已结束':!supported?`当前状态“${phase||'未填写'}”不支持此操作`:exported?'本周时长已导出归档，不能取消活动':!canRemove?'当前阶段须由对应二级审核人或平台总权限管理员处理':sourceManaged&&!persistSourceRemoval?'来源活动结束状态存储尚未就绪':'';
  const ids=new Set(events.flatMap(row=>[row['活动ID'],...(workflowConfig(row).sourceActivityIds||[])]));
  const token=hash([events,...['registrations','checkins','ledger'].map(key=>(data[key]||[]).filter(row=>ids.has(row['活动ID'])))]);
  // 确认弹窗要先把「会删掉多少东西」摆出来，取消是不可逆的。
  const purgeCounts=receipt||sourceManaged?null:{
    registrations:(data.registrations||[]).filter(row=>ids.has(row['活动ID'])).length,
    checkins:(data.checkins||[]).filter(row=>ids.has(row['活动ID'])).length,
    ledger:(data.ledger||[]).filter(row=>ids.has(row['活动ID'])).length,
  };
  // 取消恒为「删除」。旧实现只要名下有一条报名，动作就被降级成「提前结束」，
  // 负责人看到按钮从「删除活动」变成「结束活动」，等于活动办不成也删不掉。
  // 来源活动（献血车排班）只能「结束」——它的报名来自底表，
  // 删了下次同步又会重新投影出来，所以动作固定为 end。
  const action=receipt?.action||(sourceManaged?'end':'delete');
  const canRestore=canRemove&&receipt?.action==='end'&&['草稿','待审核','可发布','报名中','进行中','停点'].includes(receipt.phase)&&c.finalHours?.status!=='exported'&&!c.bloodWeekArchive&&(!sourceManaged||Boolean(persistSourceRestoration));
  return {event,c,token,phase,action,reason,sourceManaged,canRestore,events,activityIds:ids,purgeCounts,canRemove:canRemove&&(!sourceManaged||Boolean(persistSourceRemoval))&&!completed&&!exported&&!receipt&&supported};
 }
 /**
  * 清理痕迹并回写凭据。
  *
  * 只有「取消（delete）」才删记录；「提前结束（end）」必须原样保留，
  * 否则恢复出来的活动是个没有报名的空壳。来源活动（献血车排班）也不删：
  * 底表还在，下次同步会把报名重新投影出来，删了反而制造不一致。
  */
 async function settlePurge(ctx,mode,actor){
  if(mode!=='delete'||ctx.sourceManaged||typeof purgeRecords!=='function')return null;
  // 不回写凭据：取消活动每次多写一次就是多一次跨境往返，
  // 而 purged 只是回执统计。重试时重新算（记录已清空 → 全 0）同样安全。
  return purgeRecords({events:ctx.events,activityIds:ctx.activityIds,actor});
 }
 return {
  workspaceRestoration:async(id,actor)=>{const ctx=await context(id,actor);return {token:ctx.token,canRestore:Boolean(ctx.canRestore),phase:ctx.phase,reason:ctx.canRestore?'':'仅可恢复有原阶段记录且未完成最终导出归档的提前结束活动'};},
  restoreWorkspace:(id,body,actor)=>write(async()=>{
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['token','requestId'].includes(key))||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token)||typeof body.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId))throw fail(400,'恢复请求无效');
   const ctx=await context(id,actor),last=ctx.c.workspaceRestoration;
   if(!ctx.c.workspaceRemoval&&last?.requestId===body.requestId&&last.actor===actor&&last.token===body.token){if(last.chairOnly)await authorizeChair(ctx.event,actor);return {id,restored:true,phase:last.phase};}
   if(!ctx.canRestore)throw fail(403,'当前账号或活动不能恢复；最终导出归档不支持此操作');
   if(ctx.token!==body.token)throw fail(409,'活动或参与记录已变化，请刷新后核对');
   const receipt=ctx.c.workspaceRemoval;
   const restoration={actor,requestId:body.requestId,token:body.token,phase:receipt.phase,chairOnly:receipt.chairOnly===true,at:new Date(now()).toISOString()};
   delete ctx.c.workspaceRemoval;ctx.c.workspaceRestoration=restoration;
   if(ctx.sourceManaged)await persistSourceRestoration(ctx.event,receipt,restoration);
   else await update(WF.events,ctx.event,{状态:receipt.phase,报名页配置:JSON.stringify(ctx.c)});
   return {id,restored:true,phase:receipt.phase};
  }),
  workspaceRemoval:async(id,actor)=>{const ctx=await context(id,actor);return {token:ctx.token,action:ctx.action,canRemove:ctx.canRemove,reason:ctx.reason,sourceManaged:ctx.sourceManaged,purgeCounts:ctx.purgeCounts,removed:Boolean(ctx.c.workspaceRemoval)};},
  removeWorkspace:(id,body,actor)=>write(async()=>{
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['token','requestId','reason','mode'].includes(key))||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token)||typeof body.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId)||typeof body.reason!=='string'||body.reason.length>500)throw fail(400,'删除或结束请求无效');
   // delete＝取消活动并清除该活动全部参与记录；end＝只提前结束，保留记录且可恢复。
   const ctx=await context(id,actor),receipt=ctx.c.workspaceRemoval;
   // 来源活动（献血车排班）没有「删除」语义，恒按 end 处理。
   const mode=body.mode===undefined||ctx.sourceManaged?(ctx.sourceManaged?'end':'delete'):body.mode;
   if(!['delete','end'].includes(mode))throw fail(400,'删除方式无效');
   if(receipt){
    // Authorization is rechecked even when reconciling a committed request.
    if(receipt.chairOnly)await authorizeChair(ctx.event,actor);
    if(receipt.actor!==actor||receipt.requestId!==body.requestId||receipt.token!==body.token||receipt.reason!==body.reason.trim()||receipt.action!==mode)throw fail(409,'活动已移除，请刷新列表');
    // 上一次可能已经落库、清理却中断：这里补齐，删行本身幂等。
    const purged=receipt.purged??await settlePurge(ctx,mode,actor);
    return {id,removed:true,action:receipt.action,purged};
   }
   if(!ctx.canRemove)throw fail(403,'当前账号或阶段不能删除或提前结束活动');
   if(ctx.token!==body.token)throw fail(409,'活动或参与记录已变化，请刷新后核对');
   const chairOnly=['待审核','可发布'].includes(ctx.phase)||ctx.phase==='报名中'&&Date.parse(ctx.c.publishAt)>now()||ctx.c.runningReview?.status==='submitted';
   ctx.c.workspaceRemoval={actor,requestId:body.requestId,token:body.token,reason:body.reason.trim(),phase:ctx.phase,action:mode,chairOnly,at:new Date(now()).toISOString()};
   if(ctx.sourceManaged)await persistSourceRemoval(ctx.event,ctx.c.workspaceRemoval);
   else await update(WF.events,ctx.event,{状态:'已归档',归档前状态:ctx.phase,报名页配置:JSON.stringify(ctx.c)});
   // 先落状态、后清痕迹：token 把参与记录算进去了，若先删再写，
   // 「写入失败后重试」会因为记录已经没了而永远对不上 token，活动就卡在半路。
   // 反过来的代价只是状态已归档、记录晚一步清掉，重试走上面的 receipt 分支即可补上。
   const purged=await settlePurge(ctx,mode,actor);
   return {id,removed:true,action:mode,purged};
  }),
 };
}
