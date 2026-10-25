import {createHash} from 'node:crypto';
import {projectEvents} from '../../public/app/shared/activity-projects.js';
import {workflowConfig} from './blood-roster.js';
const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode,code:'workspace_removal_conflict'});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Removal retains the parent, child jobs and every participation record. */
export function createWorkspaceRemoval({read,write,update,WF,authorizeRead,authorizeChair,now=()=>Date.now()}){
 async function context(id,actor){
  const data=await read(),matches=data.events.filter(row=>row._id===id);
  if(matches.length!==1)throw fail(matches.length?409:404,'活动不存在或标识重复');
  const event=matches[0],c=workflowConfig(event);
  if(!c.workspaceSubmission||c.parentActivityId)throw fail(409,'请从新版项目活动操作');
  await authorizeRead(event,actor);
  const receipt=c.workspaceRemoval,phase=receipt?.phase||event['状态'];
  const chairOnly=['待审核','可发布'].includes(phase)||phase==='报名中'&&Date.parse(c.publishAt)>now()||c.runningReview?.status==='submitted';
  let canRemove=true;try{if(chairOnly)await authorizeChair(event,actor);}catch(error){if(error.statusCode!==403)throw error;canRemove=false;}
  const completed=phase==='已结束'||c.finalHours?.status==='exported';
  const events=projectEvents(data.events,event),ids=new Set(events.map(row=>row['活动ID']));
  const token=hash([events,...['registrations','checkins','ledger'].map(key=>(data[key]||[]).filter(row=>ids.has(row['活动ID'])))]);
  const action=receipt?.action||(['草稿','待审核','可发布'].includes(phase)||phase==='报名中'&&Date.parse(c.publishAt)>now()?'delete':'end');
  return {event,c,token,phase,action,canRemove:canRemove&&!completed&&!receipt&&['草稿','待审核','可发布','报名中','进行中','停点'].includes(phase)};
 }
 return {
  workspaceRemoval:async(id,actor)=>{const ctx=await context(id,actor);return {token:ctx.token,action:ctx.action,canRemove:ctx.canRemove,removed:Boolean(ctx.c.workspaceRemoval)};},
  removeWorkspace:(id,body,actor)=>write(async()=>{
   if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['token','requestId','reason'].includes(key))||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token)||typeof body.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(body.requestId)||typeof body.reason!=='string'||body.reason.length>500)throw fail(400,'删除或结束请求无效');
   const ctx=await context(id,actor),receipt=ctx.c.workspaceRemoval;
   if(receipt){
    // Authorization is rechecked even when reconciling a committed request.
    if(receipt.chairOnly)await authorizeChair(ctx.event,actor);
    if(receipt.actor!==actor||receipt.requestId!==body.requestId||receipt.token!==body.token||receipt.reason!==body.reason.trim())throw fail(409,'活动已移除，请刷新列表');
    return {id,removed:true,action:receipt.action};
   }
   if(!ctx.canRemove)throw fail(403,'当前账号或阶段不能删除或提前结束活动');
   if(ctx.token!==body.token)throw fail(409,'活动或参与记录已变化，请刷新后核对');
   const chairOnly=['待审核','可发布'].includes(ctx.phase)||ctx.phase==='报名中'&&Date.parse(ctx.c.publishAt)>now()||ctx.c.runningReview?.status==='submitted';
   ctx.c.workspaceRemoval={actor,requestId:body.requestId,token:body.token,reason:body.reason.trim(),phase:ctx.phase,action:ctx.action,chairOnly,at:new Date(now()).toISOString()};
   await update(WF.events,ctx.event,{状态:'已归档',归档前状态:ctx.phase,报名页配置:JSON.stringify(ctx.c)});
   return {id,removed:true,action:ctx.action};
  }),
 };
}
