import {registryDisplayStatus,registryOpenStatus} from '../../public/app/shared/special-activity.js';
import {scheduledSession} from '../../public/app/shared/schedule-board-layout.js';
import {flexibleCapacity,activityRegistrationLimit} from '../../public/app/shared/activity-capacity.js';
import { createRegistrationCounter } from './registration-counts.js';
import {registrationOpen} from '../../public/app/shared/activity-management.js';
import { workflowEventApproved } from './workflow.js';
import { workflowConfig } from './blood-roster.js';
import {ordinaryConfig,ordinaryRegistrationOpen} from './ordinary-groups.js';
import {activityParentId,activityProjectId} from '../../public/app/shared/activity-projects.js';

/**
 * 可以投稿的活动状态：从刚建好的草稿一路写到活动总结，全程都能挂稿。
 *
 * 分两档看待（见 PRE_RELEASE_STATUSES）：前三个是**还没开放报名**的状态，
 * 后三个是活动已对外发布后的状态。
 */
export const SUBMITTABLE_ACTIVITY_STATUSES = Object.freeze(['草稿', '待审核', '可发布', '报名中', '进行中', '已结束']);

/**
 * 还没开放报名的三个状态。
 *
 * 这些行在数据上必然「未批准」——`eventDraft()` 写入时 批准版本=''、申请版本=1，
 * 而 `edit` / `editNotice` 会清空批准并把状态打回草稿。所以对它们套
 * `workflowEventApproved()` 等于全挡，一条也进不了候选；真正的把关在别处
 * （活动名、组织类别、`sourceSuperseded`、组合报名）。
 */
const PRE_RELEASE_STATUSES = Object.freeze(['草稿', '待审核', '可发布']);

/** Closed registration must not hide an approved running or completed activity. */
function publiclyListedWorkflowEvent(row, now) {
  const config=workflowConfig(row);
  if (row.sourceSuperseded || !workflowEventApproved(row) || config.bookingMode === 'grouped') return false;
  if(config.blood)return registrationOpen(row,now);
  if (['进行中','已结束'].includes(row['状态'])) return true;
  if (row['状态'] !== '报名中') return false;
  // A scheduled publication must not appear before its configured time, including
  // ordinary groups whose registration control is already published.
  if(config.publishAt&&(!Number.isFinite(Date.parse(config.publishAt))||Date.parse(config.publishAt)>now))return false;
  return ordinaryConfig(row) ? Boolean(row.registrationControl?.published) : registrationOpen(row,now);
}

export function publiclyListedWorkflowEvents(events, now=Date.now()) {
  const plans=new Map(events.filter(row=>workflowConfig(row).positionPlan).map(row=>[row['活动ID'],workflowConfig(row).positionPlan]));
  return events.filter(row=>{
    const plan=plans.get(activityParentId(row));
    // Removed positions are marked ended too; only the current plan is public.
    return (!plan || plan.eventIds?.includes(row['活动ID'])) && publiclyListedWorkflowEvent(row,now);
  });
}

function groupStatus(items) {
  if (items.some(item=>item.status==='报名中')) return items.some(item=>item.registrationOpen)?'报名中':'报名暂停';
  return items.some(item=>item.status==='进行中')?'进行中':'已结束';
}

/** Project published workflow activities into the shared anonymous catalogue. */
export function projectWorkflowEvents(events, registrations, now=Date.now()) {
  let countRegistrations;
  const projected=publiclyListedWorkflowEvents(events,now).map(row => {
    const config = workflowConfig(row);
    countRegistrations ||= createRegistrationCounter(registrations);
    const { confirmed, pending } = countRegistrations([row['活动ID'], ...(config.sourceActivityIds || [])]);
    const capacity = Number(row['容量']) || 0;
    const remaining = Math.max(0, capacity - confirmed - Number(config.sourceOccupied||0) - pending);
    return {
      eventId: `workflow:${row._id}`, workflowId: row._id,
      ...(['province-service','component-donation'].includes(config.special?.type)?{registryType:config.special.type,longTerm:true}:{}),
      name: row['活动名称'], type: row['活动类别'], status: registryDisplayStatus(row),
      center: row['组织类别'] || config.center || '', region: row['活动地区'] || config.region || '',
      description: row['工作内容'] || '', notice: row['通知草稿'] || '',
      startAt: config.ordinary?.start || config.blood?.start || config.window?.start || `${row['报名日期']}T00:00:00+08:00`,
      endAt: config.ordinary?.end || config.blood?.end || config.window?.end || null, schedule: config.window?row['报名时段']:`${row['报名日期']} ${row['报名时段']}`,
      registrationEnd: row.registrationControl?.deadline||null, campus: config.ordinary?.campus||'', location: row['地点'] || '',
      capacity, confirmed, waitlisted: 0, pending, remaining, full: confirmed+pending+Number(config.sourceOccupied||0)>=(flexibleCapacity(config.flexibleCapacity)>0?activityRegistrationLimit(row,config):Number(config.registrationLimit??capacity)),
      ...(flexibleCapacity(config.flexibleCapacity)>0?{flexibleRegistration:true}:{}),
      sessions: [], registrationMode: config.ordinary&&!flexibleCapacity(config.flexibleCapacity)?'direct':'review', blood: config.blood||null,
      registrationOpen:['province-service','component-donation'].includes(config.special?.type)?registryOpenStatus(row['状态']):row['状态']==='报名中' && (config.ordinary?ordinaryRegistrationOpen(row,now):registrationOpen(row,now)),
      ...(activityProjectId(row)?{groupId:config.recurringDuty?'recurring:PROVINCE-PUBLICITY-DUTY':activityProjectId(row),groupName:row.registrationControl?.groupName}:{}),
      ...(config.recurringDuty?{recurringDuty:true,longTerm:true}:{}),
      ...(scheduledSession(row)?{scheduled:true}:{}),
    };
  });
  const output=[],groups=new Map();
  for(const item of projected){if(!item.groupId){output.push(item);continue;}const group=groups.get(item.groupId);if(group)group.push(item);else groups.set(item.groupId,[item]);}
  for(const [groupId,items]of groups){items.sort((a,b)=>a.startAt.localeCompare(b.startAt)||a.location.localeCompare(b.location));const first=items[0];output.push({...first,name:first.groupName||first.name,groupId,...(items.some(x=>x.flexibleRegistration)?{flexibleRegistration:true}:{}),capacity:items.reduce((n,x)=>n+x.capacity,0),remaining:items.reduce((n,x)=>n+x.remaining,0),confirmed:items.reduce((n,x)=>n+x.confirmed,0),pending:items.reduce((n,x)=>n+x.pending,0),full:items.every(x=>x.full),registrationOpen:items.some(x=>x.registrationOpen),status:groupStatus(items),endAt:items.reduce((end,x)=>x.endAt>end?x.endAt:end,first.endAt),location:[...new Set(items.map(x=>x.location))].join(' / '),campus:[...new Set(items.map(x=>x.campus))].join(' / '),schedule:`${first.startAt.slice(0,10)} — ${items.at(-1).startAt.slice(0,10)}`,sessions:items.map(x=>({sessionId:x.workflowId,startAt:x.startAt,endAt:x.endAt,location:x.location,capacity:x.capacity,remaining:x.remaining,full:x.full}))});}
  return output;
}

/**
 * 可投稿的活动 —— 投稿侧活动字典的跨库来源。
 *
 * 与广场可见性刻意不同：广场用 publiclyListedWorkflowEvent 那套规则，报名一关
 * （献血车类 registrationOpen=false）活动就从列表消失；但投稿是**从筹备写到总结**
 * 的一条线，活动还在草稿阶段就要能挂预热稿，所以这里完全不套 registrationOpen，
 * 只要求「状态在 SUBMITTABLE_ACTIVITY_STATUSES 内 + 未被替代 + 非组合报名」，
 * 其中已开放报名的三档额外要求批准摘要有效。
 *
 * 2026-10-27 定案：进行中的活动也可以投稿（现场通讯边办边投）。
 * 2026-11-12 再放宽：**报名中的活动也能投稿**（预热稿要提前写，影像也要能先归档）。
 * 2026-11-12 当日续：**草稿 / 待审核 / 可发布也放行**——活动刚建好就能挂稿，
 * 送审时不会从下拉里消失。这三档不看批准摘要（数据上必然未批准，见 PRE_RELEASE_STATUSES），
 * 已归档仍然排除。
 *
 * 返回 [{ name, center, status }]，center 取「组织类别」（广场上显示的那个部门来源），
 * 由调用方再经 ACTIVITY_CATEGORY_TO_CENTER 翻译成归档部门。
 */
export function finishedSubmissionActivities(events = []) {
  const out = [];
  const seen = new Set();
  for (const row of events) {
    if (!row || row.sourceSuperseded) continue;
    const status = String(row['状态'] || '').trim();
    if (!SUBMITTABLE_ACTIVITY_STATUSES.includes(status)) continue;
    // 已发布的三档必须带有效批准摘要，避免改过字段却没重新送审的活动混在候选里。
    if (!PRE_RELEASE_STATUSES.includes(status) && !workflowEventApproved(row)) continue;
    const config = workflowConfig(row);
    if (config.bookingMode === 'grouped') continue;
    const name = String(row['活动名称'] || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, center: String(row['组织类别'] || config.center || '').trim(), status });
  }
  return out;
}
