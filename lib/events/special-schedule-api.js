import {scheduledSession} from '../../public/app/shared/schedule-board-layout.js';
import {workflowConfig} from './blood-roster.js';

/** Fresh console authority is established by the parent router before this read. */
export async function specialScheduleRoutes(req,res,url,ctx,w,authority){
 const match=url.pathname.match(/^\/api\/volunteer\/workflow\/events\/([^/]+)\/schedule-total$/);
 if(!match)return false;
 if(req.method!=='GET')return ctx.json(res,405,{ok:false,message:'项目总表仅供查看'});
 const id=decodeURIComponent(match[1]),event=authority?.assertEvent(id);
 if(!event||!scheduledSession(event))throw Object.assign(new Error('仅排班项目可以查看跨周总表'),{statusCode:409});
 const rootId=workflowConfig(event).special.rootId,data=await w.read();
 const events=data.events.filter(e=>scheduledSession(e)&&workflowConfig(e).special.rootId===rootId);
 for(const item of events)authority.assertEvent(item._id);
 const byId=new Map(events.map(e=>[e['活动ID'],e]));
 const rows=data.registrations.filter(r=>byId.has(r['活动ID'])).map(r=>{
  const e=byId.get(r['活动ID']),entries=data.ledger.filter(l=>l['报名行ID']===r._id);
  return {id:r._id,date:r['报名日期'],slot:r['报名时段'],location:e['地点'],name:r['姓名'],studentId:r['学号'],status:r['报名状态'],hoursStatus:entries.length>1?'需核对':entries[0]?.['状态']||'未录入',serviceHours:entries[0]?.['服务时长']??null,archived:Boolean(workflowConfig(e).bloodWeekArchive)};
 }).sort((a,b)=>a.date.localeCompare(b.date)||a.location.localeCompare(b.location,'zh-CN')||a.slot.localeCompare(b.slot)||a.studentId.localeCompare(b.studentId));
 return ctx.json(res,200,{ok:true,rows,sessionCount:events.length,participantCount:new Set(rows.map(r=>r.studentId)).size});
}
