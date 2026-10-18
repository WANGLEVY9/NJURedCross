import {normalizeWorkspaceDraft} from '../../public/app/shared/activity-workspace.js';
import {shanghaiInstant} from '../../public/app/shared/activity-window.js';
import {approvalCategory} from './approval-routing.js';
import {activityKind} from '../../public/app/shared/activity-taxonomy.js';
const fail=message=>Object.assign(new Error(message),{statusCode:409,code:'workspace_event_copy_invalid'});
const text=value=>value==null?'':String(value);
/** Whitelist business configuration only. No registration, approval or ledger state. */
export function workspaceContentFromEvent(event){
 let c;try{c=JSON.parse(event['报名页配置']||'{}');if(!c||typeof c!=='object'||Array.isArray(c))throw Error('config');}catch{throw fail('原活动配置无法读取，请先核对');}
 const regions=[event['活动地区'],c.region].filter(Boolean).map(value=>['南京地区','南京活动'].includes(value)?'nanjing':['苏州地区','苏州活动'].includes(value)?'suzhou':null);
 if(!regions.length||regions.includes(null)||new Set(regions).size!==1)throw fail('原活动地区缺失或不一致，请先核对');
 if(c.center&&activityKind({center:c.center})!==approvalCategory(event))throw fail('原活动中心配置不一致，请先核对');
 if(c.ordinary?.groupId)throw fail('请选择完整活动项目复制，不能只复制其中一个独立班次');
 const mode=c.bookingMode||'unified',plan=c.positionDraft||c.positionPlan;
 if(!['unified','grouped'].includes(mode))throw fail('原活动报名方式无法识别');
 if(mode==='grouped'&&(!Array.isArray(plan?.positions)||!plan.positions.length))throw fail('原活动缺少完整岗位配置，不能仅复制基本信息');
 const window=c.window||c.ordinary||c.blood||{},slot=/^(\d{2}:\d{2})\s*[-—]\s*(\d{2}:\d{2})$/.exec(c.slot||event['报名时段']||'');
 const start=shanghaiInstant(window.start||`${c.date||event['报名日期']}T${c.startTime||slot?.[1]||''}`),end=shanghaiInstant(window.end||`${c.date||event['报名日期']}T${c.endTime||slot?.[2]||''}`);
 if(!start||!end||end.timestamp<=start.timestamp)throw fail('原活动缺少可识别的起止时间，请先核对');
 if(start.local.slice(17)!=='00'||end.local.slice(17)!=='00')throw fail('原活动包含秒级时间，请先核对后转换为分钟');
 const content={name:text(event['活动名称']),region:regions[0],category:approvalCategory(event),responsibleId:text(event['负责人账号ID']),description:text(c.workspaceDescription??c.description??c.content),bookingMode:mode,date:start?.local.slice(0,10)||text(event['报名日期']),endDate:end?.local.slice(0,10)||text(event['报名日期']),start:start?.local.slice(11,16)||'',end:end?.local.slice(11,16)||'',deadline:text(plan?.deadline||c.registrationDeadline||c.deadline||c.ordinary?.deadline),location:text(event['地点']),capacity:text(event['容量']),serviceHours:text(event['服务时长']),trainingHours:text(event['培训时长']),travelHours:text(event['交通时长']),work:text(event['工作内容']),notice:'',positions:[]};
 const cutoff=shanghaiInstant(content.deadline);if(cutoff){if(cutoff.local.slice(17)!=='00')throw fail('原报名截止包含秒级时间，请先核对');content.deadline=cutoff.local.slice(0,16);}
 if(mode==='grouped')content.positions=plan.positions.map((p,index)=>{
  const from=shanghaiInstant(p.start),to=shanghaiInstant(p.end);
  // The new editor supports per-day position slots; reject unsupported overnight jobs rather than truncate them.
  if(!from||!to||from.local.slice(0,10)!==to.local.slice(0,10)||to.timestamp<=from.timestamp)throw fail('原岗位跨日或时间无效，请先核对岗位安排');
  if(from.local.slice(17)!=='00'||to.local.slice(17)!=='00')throw fail('原岗位包含秒级时间，请先核对后转换为分钟');
  return {id:`source-${index}`,name:text(p.name),date:from.local.slice(0,10),start:from.local.slice(11,16),end:to.local.slice(11,16),campus:text(p.campus),location:text(p.location),capacity:text(p.capacity),serviceHours:text(p.serviceHours??c.service??event['服务时长']),trainingHours:text(p.trainingHours??c.training??event['培训时长']),travelHours:text(p.travelHours??c.travel??event['交通时长']),work:text(p.work||p.content||event['工作内容'])};
 });
 return normalizeWorkspaceDraft(content);
}
