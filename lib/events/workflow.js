import {registrationLeavePolicy} from '../../public/app/shared/registration-leave.js';
import {invalidateDisplayReads} from '../http/display-reads.js';
import {createActivityLifecycleStore} from './activity-lifecycle-store.js';
import {workspaceBeforeStart,planWorkspaceLiveEdit,workspaceEditDigest} from './workspace-live-edit.js';
import { createActivityChangeWorkflow } from './activity-change-workflow.js';
import {createWorkspaceRemoval} from './workspace-removal.js';
import {workspaceContentFromEvent} from './workspace-event-copy.js';
import {createRunningReview} from './running-review.js';
import {createFinalHours} from './final-hours.js';
import {normalizeWorkspaceDraft,workspaceNotice} from '../../public/app/shared/activity-workspace.js';
/**
 * 志愿活动流程：六张独立表（WORKFLOW_SCHEMA）上的活动生命周期状态机。
 *
 * 活动  草稿 → 待审核 → 可发布 → 报名中 → 停点（仅献血车）/ 已结束
 *                ↑ 编辑任一字段            ↓ 归档进回收站，可还原
 * 报名  待筛选 → 已确认 → 已签到 ；拒绝落到 未入选，请假落到 已请假
 * 时长  待批准 → 已批准 → 已入账
 *
 * 四条贯穿全局的不变量：
 *
 *   · 批准按摘要校验。`workflowEventApproved()` 要求活动行的 `批准摘要` 等于
 *     当前字段重算出的 `workflowApprovalHash`；`edit` / `editNotice` 会清空批准
 *     并把状态打回草稿，因此改过字段的活动必须重新送审才能继续发布或报名。
 *   · 时长入账幂等。明细行以 `幂等键` 唯一的 `SERVICE:<报名行ID>` 写入，重复
 *     提交覆盖同一行；汇总表每次按全部明细绝对重算，半途失败的重试不会加成。
 *   · 写入前重读。NJUTable 没有跨客户端的原子条件更新，占名额与入账都先重读
 *     目标行、写完再校验一次；`safety.js` 的串行队列负责消除本进程内的并发。
 *   · 时长只能来自已核验的签到。入账前 `ledgerEvidenceMatches()` 复核来源摘要，
 *     源记录或候选时长一旦改变就停止入账；核对人不能批准自己的时长核对。
 *
 * 试点表与旧历史表隔离，旧增量脚本不消费这六张表。
 */

import {scopedRows} from './scoped-read.js';
import {createHoursSubmissionStore} from './hours-submission-store.js';
import {supportsHoursSubmission} from '../../public/app/shared/hours-submission.js';
import {createHoursSubmission} from './hours-submission.js';
import {activityProjectKey,legacyBloodMonthKey,projectEvents,bloodWeekStart,bloodWeekEnd,bloodWeekLabel,bloodWeekName,bloodWeekKey} from '../../public/app/shared/activity-projects.js';
import {ACTIVITY_CENTERS,serviceDuration,noticeTemplate,syncNoticeSchedule,registrationOpen} from '../../public/app/shared/activity-management.js';
import {activityKind} from '../../public/app/shared/activity-taxonomy.js';
import {activityWindow,positionWithinActivity,shanghaiInstant} from '../../public/app/shared/activity-window.js';
import {projectPositions,assertProjectPositions,expandProjectCapacity,normalizePositions} from './project-positions.js';
import {eventResponsibleIds} from '../../public/app/shared/activity-responsibility.js';
import {REGISTRATION_TABLE,normalizeRegistration,createRegistrationWriter,registrationDetails} from './registration-schema.js';
import {syncRegistrationLinks} from './registration-links.js';
import {rosterReview,publishedRosterRow} from '../../public/app/shared/roster-review.js';
import {createRosterReview,rosterToken} from './roster-review.js';
import {ORDINARY_GROUP_TABLE,ORDINARY_GROUP_COLUMNS,ordinaryConfig,sessionWindow,ordinaryRegistrationOpen,validateOrdinarySession,attachOrdinaryControls} from './ordinary-groups.js';
import { syncBloodBooking,assertBloodBookingSchema,missingBloodBookingColumns } from './blood-booking.js';
import { sourceText, bloodSourceOccupied, generatedBloodEvents } from './blood-source.js';
import { BLOOD_WEEK_DEFAULTS } from './blood-week-store.js';
import { planBloodWeek, bloodWeekInventory, appendBloodWeekRows, nextWeekdayInstant, shanghaiParts, bloodSourceRowDate } from './blood-week-automation.js';
import { displayRead } from '../http/display-reads.js';
import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { sourceActivities } from './catalog.js';
import { ACTIVITY_TEMPLATES } from '../../public/app/shared/activity-templates.js';
import { reviewDetails, reviewDigest, assertReviewedLedger, reviewWorkbookRows } from './hours-review.js';
import { memberContext, attendanceContext } from './service-context.js';
import { createMutationQueue } from './safety.js';
import { readPagedRows } from '../http/paged-rows.js';
import { bloodRosterDrafts, workflowConfig, BLOOD_POINTS, BLOOD_SHIFTS, rosterTimes } from './blood-roster.js';
import { mapConcurrent } from '../http/map-concurrent.js';
import { readProfileCandidatesByIds } from '../identity/profile-query.js';
export { TEST_WORKFLOW_BASE } from './workflow-mode.js';
export const WORKFLOW_SCHEMA = [
  { name: '网站活动流程表', columns: ['活动ID','活动名称','活动类别','负责人账号ID','申请版本','批准版本','批准摘要','审批人','审批时间','状态','报名日期','报名时段','岗位','容量','服务时长','培训时长','交通时长','地点','工作内容','通知草稿','报名页配置','准备状态','创建时间','停点说明','归档前状态'] },
  { name: '网站活动报名总表', columns: ['活动名称','活动类别','报名ID','活动ID','账号ID','学号','姓名','邮箱','院系','报名日期','报名时段','岗位','报名状态','是否报名成功','志愿时长','录入状态','签到行ID','创建时间','请假状态','请假原因','请假申请时间','处理说明','签到照片ID','签到提交时间','报名类型','校区','岗位源行ID','岗位同步状态'] },
  { name: '网站活动签到表', columns: ['签到ID','报名行ID','活动ID','账号ID','学号','姓名','活动时间','核验人','核验说明'] },
  { name: '网站服务时长明细表', columns: ['幂等键','报名行ID','签到行ID','活动ID','账号ID','学号','姓名','规则版本','服务时长','培训时长','交通时长','状态','核对人','批准人','批准时间','来源摘要','入账时间','工作内容','核对摘要','退回原因','具体工作地点','正式工作日期','备注','修订人','修订时间'] },
  { name: '网站志愿时长汇总表', columns: ['账号ID','学号','姓名','服务时长','培训时长','交通时长','明细摘要','更新时间'] },
  { name: '网站个人主页表', columns: ['账号ID','学号','姓名','邮箱','志愿时长','培训时长','交通时长','明细摘要','更新时间'] },
];
export const WF = Object.freeze(Object.fromEntries(['events','registrations','checkins','ledger','summaries','profiles'].map((key,index)=>[key,WORKFLOW_SCHEMA[index].name])));
const fail = (statusCode, message, code = 'workflow_conflict') => Object.assign(new Error(message), { statusCode, code });
const str = value => typeof value === 'string' ? value.trim() : '';
function number(value, label, { positive = false, integer = false } = {}) {
  if (!['number','string'].includes(typeof value) || String(value).trim() === '') throw fail(400, `${label}格式无效`);
  const n=Number(value);if(!Number.isFinite(n)||n<0||(positive&&n===0)||(integer&&!Number.isInteger(n))||n>100000)throw fail(400,`${label}超出有效范围`);return n;
}
function required(value,label){const v=str(value);if(!v||v.length>500)throw fail(400,`${label}不能为空或过长`);return v;}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const workflowApprovalHash = row => digest(['活动ID','活动名称','活动类别','负责人账号ID','申请版本','报名日期','报名时段','岗位','容量','服务时长','培训时长','交通时长','地点','工作内容','通知草稿','报名页配置','准备状态'].map(key=>{
  if(key==='报名页配置'&&(rosterReview(row)||workflowConfig(row).workspacePreview||workflowConfig(row).runningReview||workflowConfig(row).finalHours||workflowConfig(row).workspaceRemoval||workflowConfig(row).registrationContact)){const config=workflowConfig(row);delete config.rosterReview;delete config.workspacePreview;delete config.runningReview;delete config.finalHours;delete config.workspaceRemoval;delete config.registrationContact;return JSON.stringify(config);}
  return row[key]||'';
}));
export const workflowEventApproved = row => row['批准版本']===row['申请版本']&&row['批准摘要']===workflowApprovalHash(row);
const at = () => new Date().toISOString();
const value = object => Object.fromEntries(Object.entries(object).map(([key,item])=>[key,String(item??'')]));
/** 签到凭证：服务端签名的无状态一次性凭证，随机、限时、并且绑定活动+报名行。核验时验签即可确认"确由本服务签发且上下文未被篡改"。 */
const CHECKIN_TICKET_PREFIX = 'WCT-';
function signCheckinTicket(secret, payload){const body=Buffer.from(JSON.stringify(payload),'utf8').toString('base64url');const mac=createHmac('sha256',secret).update(body).digest('base64url');return `${CHECKIN_TICKET_PREFIX}${body}.${mac}`;}
function verifyCheckinTicket(secret,token){
 const raw=str(token);if(!raw.startsWith(CHECKIN_TICKET_PREFIX))return null;
 const parts=raw.slice(CHECKIN_TICKET_PREFIX.length).split('.');if(parts.length!==2)return null;
 const [body,mac]=parts;if(!body||!mac)return null;
 const expected=createHmac('sha256',secret).update(body).digest('base64url');
 if(mac.length!==expected.length||!timingSafeEqual(Buffer.from(mac),Buffer.from(expected)))return null;
 try{const payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));return payload&&typeof payload==='object'?payload:null;}catch{return null;}
}
/**
 * 只读展示投影的共享窗口。管理端在模块之间往返时往往只差几秒，5 秒窗口会让
 * 每次返回都重新回源（每张表 0.5–2 秒）；写入不在展示上下文内，仍直读权威源，
 * 且写后按表立即失效，因此放宽窗口不会影响写入判定或已保存数据的可见性。
 */
export const managementReadMs = () => {
  const raw = Number(process.env.PLATFORM_MANAGEMENT_READ_MS);
  return Number.isSafeInteger(raw) && raw >= 0 ? raw : 30_000;
};
export async function workflowRows(base, table, ttlMs = managementReadMs()) {
  // 0 表示每次都回源，不进入展示缓存。
  if (!ttlMs) return loadWorkflowRows(base, table);
  return displayRead(base, JSON.stringify(['workflowRows', table]), () => loadWorkflowRows(base, table), ttlMs, [table]);
}
async function loadWorkflowRows(base, table) {
  const rows=await readPagedRows(base, table, { pageSize:1000, maxRows: 100000, requireComplete: true });
  return table===REGISTRATION_TABLE?rows.map(normalizeRegistration):rows;
}
function one(rows,predicate,label,{optional=false}={}){const found=rows.filter(predicate);if(found.length>1)throw fail(409,`${label}出现重复，需对账`);if(!found.length&&!optional)throw fail(404,`${label}不存在`);return found[0];}
/** 有效报名 = 仍占着名额、因此不能重复报名也不能被释放的记录。已请假 / 未入选 / 已驳回属于已释放的历史，不再占位。 */
const occupiesSlot = r => ['待筛选','已确认','已签到'].includes(r['报名状态']);
function snapshot(event,row,checkin,{stableCapacity=false}={}){return digest([event['活动ID'],event['申请版本'],event['批准版本'],event['服务时长'],event['培训时长'],event['交通时长'],event['报名日期'],event['报名时段'],event['岗位'],stableCapacity?'generated-capacity-independent':event['容量'],event['地点'],event['工作内容'],row['账号ID'],row['学号'],row['姓名'],row['报名日期'],row['报名时段'],row['岗位'],row['报名状态'],row['是否报名成功'],checkin._id,checkin['报名行ID'],checkin['学号'],checkin['账号ID'],checkin['核验人'],checkin['核验说明'],checkin['活动时间'],...(workflowConfig(event).blood?[row['签到照片ID'],row['签到提交时间']]:[])]);}
const serviceSourceDigest=source=>source.stableSourceHash?`v4:${source.stableSourceHash}`:`v3:${source.sourceHash}`;
export function createWorkflow(base,{assertWritable=()=>{},assertHoursWritable=()=>{},onStep=async()=>{},prepareLeaveDecision=async()=>{},places=null,now=()=>Date.now(),bloodSourceTable=null,mode='test',checkinSecret='workflow-checkin-fallback-secret',approvalRouting=null,hoursSubmissionStore=createHoursSubmissionStore(),activityChangeStore=null,activityLifecycleStore=createActivityLifecycleStore(),bloodWeekStore=null,onSourceLifecycleChanged=()=>{}}={}) {
  const serial=createMutationQueue();
  const registrationWriter=createRegistrationWriter(base);
  // 签发密钥：生产由调用方注入（见 server.js）；未注入时使用固定回退，仅保证本地/测试可用。
  // 说明：签名使用本进程稳定的密钥，凭证因此只在签发它的服务端内可验签。
  // 表结构极少变化，但每次关联同步都取一次会把写入放大成 N 次跨境往返。
  let metadataSnapshot={at:0,promise:null};
  async function registrationMetadata(){
   const stamp=Date.now();
   if(metadataSnapshot.promise&&stamp-metadataSnapshot.at<60_000)return metadataSnapshot.promise;
   const promise=registrationWriter.metadata();
   metadataSnapshot={at:stamp,promise};
   promise.catch(()=>{if(metadataSnapshot.promise===promise)metadataSnapshot={at:0,promise:null};});
   return promise;
  }
  async function syncLinks(row,data){
   try{
    const metadata=await registrationMetadata();
    if(!metadata?.tables?.find(t=>t.name===WF.registrations)?.columns?.some(c=>c.name==='关联状态'))return;
    const loaded=data||Object.fromEntries(await Promise.all(['events','checkins','ledger','profiles'].map(async key=>[key,await workflowRows(base,WF[key])])));
    return syncRegistrationLinks(base,metadata,row,loaded);
   }catch{
    try{await update(WF.registrations,row,{关联状态:'关联待核对'});}catch{/* Do not report a durable booking as failed because navigation links were unavailable. */}
    return '关联待核对';
   }
  }
  // 投影依赖活动表、献血车源表、普通活动项目表和（非目录投影时的）报名总表。
  const eventRowTables=catalogOnly=>[WF.events,bloodSourceTable,ORDINARY_GROUP_TABLE,...(catalogOnly?[]:[WF.registrations])].filter(Boolean);
  async function eventRows(catalogOnly=false,withHours=true){
   const ttlMs=managementReadMs();
   // 0 表示每次都回源，不进入展示缓存。
    const events=await (ttlMs?displayRead(base,JSON.stringify(['workflowEvents',catalogOnly]),()=>loadEventRows(catalogOnly),ttlMs,eventRowTables(catalogOnly)):loadEventRows(catalogOnly));
    return withHours?hoursSubmission.projectHoursState(events):events;
  }
  const sourceRegistrationKey=event=>JSON.stringify(['blood-session',bloodSourceTable,workflowConfig(event).source.key]);
  /** 周次自动化的管理员配置；未接入状态存储时使用内置默认值。 */
  const bloodWeekSettings=()=>bloodWeekStore?bloodWeekStore.settings():BLOOD_WEEK_DEFAULTS;
  async function loadEventRows(catalogOnly,websiteOverride,storedOverride){
    // 每行只解析一次报名页配置：这个投影是全站最热的路径，逐遍重新解析会放大成 O(n) 倍的开销。
    const attach=async rows=>{
      const configs=rows.map(workflowConfig);
      const ended=new Set(rows.filter((row,index)=>configs[index].finalHours?.status==='exported').map(row=>row['活动ID']));
      const removed=new Set(rows.flatMap((row,index)=>configs[index].workspaceRemoval?projectEvents(rows,row).map(target=>target['活动ID']):[]));
      rows=rows.map((row,index)=>{const config=configs[index];return removed.has(row['活动ID'])||removed.has(config.parentActivityId)?{...row,状态:'已归档'}:ended.has(config.parentActivityId)?{...row,状态:'已结束'}:row;});
      return rows.some(ordinaryConfig)?attachOrdinaryControls(rows,await workflowRows(base,ORDINARY_GROUP_TABLE)):rows;
    };
    if(!bloodSourceTable)return attach(storedOverride||await workflowRows(base,WF.events));
    const [stored,sourceRows,websiteRows]=await Promise.all([storedOverride||workflowRows(base,WF.events),workflowRows(base,bloodSourceTable,30_000),catalogOnly?[]:websiteOverride||workflowRows(base,WF.registrations)]);
    const ownedCodes=new Set(websiteRows.filter(r=>['待筛选','已确认','已签到'].includes(r['报名状态'])).map(r=>r['报名ID']));
    const generated=generatedBloodEvents(sourceRows,now(),ownedCodes);
    const legacyByKey=new Map();for(const e of stored){const key=workflowConfig(e).blood?.key;if(key){const ids=legacyByKey.get(key)||[];ids.push(e['活动ID']);legacyByKey.set(key,ids);}}
    const bloodKeys=new Set();
    for(const row of generated){const c=workflowConfig(row),key=activityProjectKey(row),receipt=activityLifecycleStore.get(key);bloodKeys.add(c.blood.key);
     // 周次分组的报名开关优先；没有周次决策时继承改版前的月度默认开关。
     let projectControl=activityLifecycleStore.registration(key,{enabled:null,revision:0});
     if(projectControl.enabled===null)projectControl=activityLifecycleStore.registration(legacyBloodMonthKey(row)||key,{enabled:true,revision:0});
     c.sourceProjectRegistration=projectControl;c.sourceRegistration=activityLifecycleStore.registration(sourceRegistrationKey(row),{enabled:c.sourceProjectRegistration.enabled,revision:0});if(!c.sourceRegistration.enabled&&row['状态']==='报名中')row['状态']='进行中';
     // 周次定时发布：到达管理员配置的时间点前，活动广场不展示该周场次。
     const scheduled=bloodWeekStore?.schedule(key)?.publishAt;
     if(scheduled){c.publishAt=scheduled;c.weekName=bloodWeekName(bloodWeekStart(row['报名日期']));row['通知草稿']=syncNoticeSchedule(row['通知草稿'],c.publishAt);}
     if(receipt){c.workspaceRemoval=receipt;row['状态']='已归档';}const contact=activityLifecycleStore.contact(key);if(contact)c.registrationContact=contact;c.source.table=bloodSourceTable;c.sourceActivityIds=legacyByKey.get(c.blood.key)||[];row['报名页配置']=JSON.stringify(c);row['批准摘要']=workflowApprovalHash(row);}
    return attach([...stored.map(row=>bloodKeys.has(workflowConfig(row).blood?.key)?{...row,sourceSuperseded:true}:row),...generated]);
  }
  async function syncPosition(event,row,state='待审核'){if(mode!=='production'||workflowConfig(event).source?.kind!=='generated_blood')return;const sourceId=await syncBloodBooking(base,bloodSourceTable,event,row,state);await update(WF.registrations,row,{岗位源行ID:sourceId||row['岗位源行ID']||'',岗位同步状态:state==='可报名'?'已释放':'已同步'});}
  async function read(){const sets=await Promise.all(Object.entries(WF).map(([key,name])=>key==='events'?eventRows():workflowRows(base,name)));return Object.fromEntries(Object.keys(WF).map((key,index)=>[key,sets[index]]));}
  // Display snapshots only need three tables. Mutation evidence still uses fresh read().
  async function overview(){const keys=['events','registrations','ledger'];const sets=await Promise.all(keys.map(key=>key==='events'?eventRows():workflowRows(base,WF[key])));const data=Object.fromEntries(keys.map((key,index)=>[key,sets[index]]));data.ledger=data.ledger.map(row=>({...row,核对摘要:row['核对摘要']||reviewDigest(row)}));return data;}
  async function catalog(authorityEvents){
    // Occupancy is not part of the explorer contract. Do not read registrations.
    const events=authorityEvents?await loadEventRows(true,undefined,authorityEvents):await eventRows(true);
    return {lazyDetails:true,events:(await hoursSubmission.projectHoursState(events)).map(row=>{
      const c=workflowConfig(row);
      return {...Object.fromEntries(['_id','活动ID','活动名称','活动类别','组织类别','活动地区','负责人账号ID','申请版本','状态','报名日期','报名时段','地点','容量','服务时长','培训时长','交通时长','工作内容','通知草稿','岗位','sourceSuperseded','registrationControl'].map(k=>[k,row[k]])),...(row.hoursSubmission?{hoursSubmission:{phase:row.hoursSubmission.phase,revision:row.hoursSubmission.revision}}:{}),报名页配置:JSON.stringify({ordinary:c.ordinary,blood:c.blood,bookingMode:c.bookingMode,positionPlan:c.positionPlan?{groupId:c.positionPlan.groupId}:undefined,source:c.source?{key:c.source.key,kind:c.source.kind}:undefined,sourceRegistration:c.sourceRegistration,sourceProjectRegistration:c.sourceProjectRegistration,description:c.workspaceDescription||c.description,deadline:c.registrationDeadline||c.deadline,endDate:c.endDate,center:c.center,region:c.region,approval:c.approval,lastEditor:c.lastEditor,parentActivityId:c.parentActivityId,publishAt:c.publishAt,workspaceSubmission:c.workspaceSubmission?{origin:true}:undefined,runningReview:c.runningReview?.status==='submitted'?{status:'submitted'}:undefined})};
    })};
  }
  async function removalEvidence(id){
    const all=await eventRows(true),event=one(all,row=>row._id===id,'活动'),events=projectEvents(all,event);
    const ids=[...new Set(events.flatMap(row=>[row['活动ID'],...(workflowConfig(row).sourceActivityIds||[])]))];
    const keys=['registrations','checkins','ledger'],sets=await Promise.all(keys.map(key=>scopedRows(base,WF[key],ids)));
    return {events,...Object.fromEntries(keys.map((key,index)=>[key,sets[index]]))};
  }
  async function detail(id,authorityEvents){
    const stored=authorityEvents?.find(e=>e._id===id||e['活动ID']===id);
    // An ordinary activity never depends on the entire blood-van source table.
    // Keep fresh permission evidence, but read only this project's controls.
    const ordinaryOnly=stored&&!workflowConfig(stored).blood&&!workflowConfig(stored).source?.kind;
    const all=ordinaryOnly?(authorityEvents.some(ordinaryConfig)?attachOrdinaryControls(authorityEvents,await workflowRows(base,ORDINARY_GROUP_TABLE)):authorityEvents):authorityEvents?await loadEventRows(true,undefined,authorityEvents):await eventRows(true),event=one(all,e=>e._id===id||e['活动ID']===id,'活动');
    let events=projectEvents(all,event);const ids=[...new Set(events.flatMap(e=>[e['活动ID'],...(workflowConfig(e).sourceActivityIds||[])]))];
    const [registrations,ledger]=await Promise.all([scopedRows(base,WF.registrations,ids),scopedRows(base,WF.ledger,ids)]);
    if(bloodSourceTable&&events.some(e=>workflowConfig(e).blood))events=projectEvents(await loadEventRows(false,registrations,authorityEvents),event);
    const normalized=registrations.map(normalizeRegistration);
    return {events:(await hoursSubmission.projectHoursState(events)).map(e=>({...e,positionToken:workflowApprovalHash(e),rosterToken:rosterToken(e,normalized)})),registrations:normalized,ledger:ledger.map(r=>({...r,核对摘要:r['核对摘要']||reviewDigest(r)}))};
  }
  async function write(task){await assertWritable();return serial(task);}
  async function writeHours(task){return write(async()=>{await assertHoursWritable();return task();});}
  async function append(table,row){const encoded=await registrationWriter.encodeTable(table,row);const result=await base.appendRow(table,encoded);if(!result?._id)throw fail(502,'流程写入结果不完整，请刷新对账后重试');return {...(table===WF.registrations?normalizeRegistration(encoded):encoded),_id:result._id};}
  const update=async(table,row,patch)=>{if(table===WF.events&&workflowConfig(row).source?.kind==='generated_blood')throw fail(409,'献血车班次由排班表维护，请在 NJUTable 调整');return base.updateRow(table,row._id,await registrationWriter.encodeTable(table,patch));};
  /**
   * 多行同表写入：SDK 提供批量接口时一次提交，否则逐行写入。
   *
   * 批量提交失败由调用方决定如何重试——这些补丁是幂等的，逐行重试不会重复
   * 累加，同时还能给出"已处理 X / Y"这样的精确定位。
   */
  async function updateRows(table,rows,patchOf,{batchSize=100}={}){
   if(!rows.length)return;
   if(rows.length>1&&typeof base.batchUpdateRows==='function'){
    const updates=[];
    for(const row of rows)updates.push({row_id:row._id,row:await registrationWriter.encodeTable(table,patchOf(row))});
    for(let start=0;start<updates.length;start+=batchSize){
     const result=await base.batchUpdateRows(table,updates.slice(start,start+batchSize));
     if(result&&Array.isArray(result.failed)&&result.failed.length)throw Error('partial batch update');
    }
    return;
   }
   for(const row of rows)await update(table,row,patchOf(row));
  }
  async function eventBy(id){return one(await eventRows(),row=>row._id===id||row['活动ID']===id,'活动');}
  /** 现场签发一次性的签到凭证：随机、限时，绑定活动+报名行。 */
  async function issueCheckinTicket(id,actor){
    const data=await read(),row=one(data.registrations,r=>r._id===id,'报名');
    if(row['报名状态']!=='已确认')throw fail(409,'仅已确认名单可以签发签到凭证');
    const exp=now()+30*60_000;const ticket=signCheckinTicket(checkinSecret,{reg:row._id,act:row['活动ID'],exp});
    return {ticket,expiresAt:new Date(exp).toISOString(),注册行:row._id,活动ID:row['活动ID']};
  }
  /** 现场核验：凭证确由本服务签发、未过期，且绑定的活动与报名行一致；随后按凭证定位签到。 */
  async function verifyCheckin(ticket,actor,note,expectedRegistration){
    const payload=verifyCheckinTicket(checkinSecret,ticket);
    if(!payload)throw fail(403,'签到凭证无效，请现场签发后核验');
    if(expectedRegistration!==undefined&&payload.reg!==expectedRegistration)throw fail(403,'签到凭证与所选报名不匹配');
    if(now()>payload.exp)throw fail(409,'签到凭证已过期，请重新签发');
    const data=await read(),row=one(data.registrations,r=>r._id===payload.reg,'报名');
    if(payload.act!==row['活动ID'])throw fail(403,'签到凭证与活动不匹配');
    return checkinRow(payload.reg,actor,note,data);
  }
  async function checkinRow(id,actor,note,loaded){
    const data=loaded||await read(),row=one(data.registrations,r=>r._id===id,'报名');
    const currentEvent=one(data.events,e=>e['活动ID']===row['活动ID'],'活动');
    if(projectEvents(data.events,currentEvent).some(event=>workflowConfig(event).runningReview?.status==='submitted'))throw fail(409,'时长已提交审核，不能更改签到');
    if(row['请假状态']==='待审批')throw fail(409,'请先处理请假申请');
    if(row['报名状态']==='已签到')return one(data.checkins,c=>c._id===row['签到行ID']&&c['报名行ID']===id,'签到');
    if(row['报名状态']!=='已确认')throw fail(409,'仅已确认名单可以签到');
    const event=one(data.events,e=>e['活动ID']===row['活动ID'],'活动');
    const hoursState=await hoursSubmission.assertHoursUnlocked(event);
    if(hoursState.absences?.[id])throw fail(409,'已标记缺席，请先取消缺席再核验到场');
    if(rosterReview(event)?.phase==='publishing'||rosterReview(event)?.drafts?.[row._id])throw fail(409,'名单正在调整或提交');
    if(ordinaryConfig(event)&&now()<Date.parse(ordinaryConfig(event).start))throw fail(409,'班次尚未开始，不能核验到场');
    if(!workflowEventApproved(event)||!['报名中','进行中','已结束'].includes(event['状态']))throw fail(409,'活动审批或开放状态已改变');
    if(workflowConfig(event).blood&&(!row['签到照片ID']||!row['签到提交时间']))throw fail(409,'献血车签到需先提交带日期时间的现场照片');
    const why=str(note)||'管理员确认现场到场';
    if(why.length>500)throw fail(400,'签到说明不能超过500字');
    const existing=one(data.checkins,r=>r['报名行ID']===id,'签到',{optional:true});
    const check=existing||await append(WF.checkins,{签到ID:`WC-${randomUUID()}`,报名行ID:id,活动ID:row['活动ID'],账号ID:row['账号ID'],学号:row['学号'],姓名:row['姓名'],活动时间:at(),核验人:actor,核验说明:why});
    if(!existing)data.checkins.push(check);
    const patch={报名状态:'已签到',签到行ID:check._id};await update(WF.registrations,row,patch);Object.assign(row,patch);
    await syncLinks(row,data);
    return check;
  }
  async function recordHours(id,actor,input={},loaded){
    const source=await evidence(id,loaded),{data,registration:r,event:e,checkin:c}=source;
    if(projectEvents(data.events,e).some(event=>workflowConfig(event).workspaceSubmission))throw fail(409,'请在新版进行中页面完成负责人初审');
    if(ordinaryConfig(e)?.hoursPending)throw fail(409,'本活动时长规则尚未确定，不能录入、批准或入账');
    const key=`SERVICE:${r._id}`,existing=one(data.ledger,row=>row['幂等键']===key,'时长明细',{optional:true});
    const editing=Object.keys(input).some(key=>key!=='expectedDigest');
    if(editing||!existing)await hoursSubmission.assertHoursUnlocked(e);
    if(existing){
      assertReviewedLedger(existing,source);
      if(!editing)return existing;
      if(!['待批准','已退回'].includes(existing['状态']))throw fail(409,'已审核时长不能修改');
      if(input.expectedDigest!==(existing['核对摘要']||reviewDigest(existing)))throw fail(409,'时长已被更新，请刷新后再修改');
    }
    const row={...(existing||{}),幂等键:key,报名行ID:r._id,签到行ID:c._id,活动ID:r['活动ID'],账号ID:r['账号ID'],学号:r['学号'],姓名:r['姓名'],规则版本:e['申请版本'],
      ...reviewDetails({...e,报名日期:r['报名日期'],报名时段:r['报名时段']},input),状态:'待批准',核对人:actor,来源摘要:serviceSourceDigest(source),批准人:'',批准时间:'',退回原因:'',修订人:actor,修订时间:at()};
    row['核对摘要']=reviewDigest(row);
    if(existing){await update(WF.ledger,existing,row);Object.assign(existing,row);return existing;}
    const saved=await append(WF.ledger,row);data.ledger.push(saved);await syncLinks(r,data);return saved;
  }
  async function approveEntry(id,actor,role,expectedDigest,loaded){
    const data=loaded||await read(),row=one(data.ledger,r=>r._id===id,'时长明细');
    await assertHoursReviewer(data.events.find(event=>event['活动ID']===row['活动ID']),actor);
    if(row['状态']!=='待批准')throw fail(409,'时长不在待批准状态');
    if((row['核对人']===actor||row['账号ID']===actor)&&role!=='super_admin')throw fail(403,'核对人不能批准自己的时长核对');
    if(expectedDigest!==undefined&&expectedDigest!==(row['核对摘要']||reviewDigest(row)))throw fail(409,'时长已被修改，请重新查看后审核');
    assertReviewedLedger(row,await evidence(row['报名行ID'],data));
    const patch={状态:'已批准',批准人:actor,批准时间:at()};await update(WF.ledger,row,patch);Object.assign(row,patch);return row;
  }
  function scopeEvents(data,event,month){
    const group=ordinaryConfig(event)?.groupId;
    if(group&&!month)return data.events.filter(e=>ordinaryConfig(e)?.groupId===group);
    if(!month)return projectEvents(data.events,event);
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!workflowConfig(event).blood)throw fail(400,'按月汇总仅适用于献血车，请选择有效月份');
    return data.events.filter(e=>workflowConfig(e).blood&&String(e['报名日期']).slice(0,7)===month);
  }
  async function batch(eventId,items,kind,operation,month){
    if(!Array.isArray(items)||!items.length||items.length>200)throw fail(400,'每批请选择1～200条记录');
    const data=await read(),event=one(data.events,e=>e._id===eventId||e['活动ID']===eventId,'活动');
    const ids=new Set(),allowed=new Set(scopeEvents(data,event,month).map(e=>e['活动ID']));
    for(const item of items){
      if(!item||typeof item!=='object'||Array.isArray(item)||typeof item.id!=='string'||ids.has(item.id))throw fail(400,'所选记录无效或重复');ids.add(item.id);
      const row=one(data[kind],r=>r._id===item.id,'所选记录');if(!allowed.has(row['活动ID']))throw fail(409,'不能混入其他活动或月份的记录');
    }
    const results=[];
    for(const item of items){try{const row=await operation(item,data);results.push({id:item.id,ok:true,result:row});}catch(error){results.push({id:item.id,ok:false,message:error.message,status:error.statusCode||502});}}
    return {results,succeeded:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length};
  }
  async function exportHours(id,includePending=false,month){
    const data=await read(),event=one(data.events,row=>row._id===id||row['活动ID']===id,'活动');
    const events=scopeEvents(data,event,month),allowed=new Set(events.map(e=>e['活动ID']));
    const entries=data.ledger.filter(row=>allowed.has(row['活动ID'])&&(includePending?['待批准','已退回','已批准','已入账']:['已批准','已入账']).includes(row['状态']));
    const keys=new Set();
    for(const entry of entries){if(keys.has(entry['幂等键']))throw fail(409,'重复明细，停止导出');keys.add(entry['幂等键']);assertReviewedLedger(entry,await evidence(entry['报名行ID'],data));}
    if(!includePending&&!entries.length)throw fail(409,'没有已批准的时长明细');
    const registrations=data.registrations.filter(r=>entries.some(l=>l['报名行ID']===r._id));
    const workbook=reviewWorkbookRows(event,entries,registrations,{events,monthly:Boolean(month),includeZero:includePending});
    if(!includePending&&!workbook.rows.length)throw fail(409,'没有服务时长大于0的已通过记录');
    return {...workbook,eventName:month?`${month}献血车志愿服务`:event['活动名称'],source:WF.registrations,writes:false,month:month||'',
      registrations,events,
      warnings:[],entries:entries.map(row=>({...row,核对摘要:row['核对摘要']||reviewDigest(row)})),
      pending:entries.filter(row=>['待批准','已退回'].includes(row['状态'])).length};
  }
  async function evidence(id,loaded){const data=loaded||await read();const registration=one(data.registrations,row=>row._id===id,'报名');const event=one(data.events,row=>row['活动ID']===registration['活动ID'],'活动');const checkin=one(data.checkins,row=>row._id===registration['签到行ID']&&row['报名行ID']===id,'签到');
    if(ordinaryConfig(event)?.hoursPending)throw fail(409,'本活动时长规则待确定，禁止审核、入账或导出时长');
    if(registration['是否报名成功']!=='true'||registration['报名状态']!=='已签到'||!checkin['核验人']||!checkin['核验说明']||checkin['学号']!==registration['学号']||checkin['账号ID']!==registration['账号ID']||checkin['活动ID']!==event['活动ID']||!workflowEventApproved(event))throw fail(409,'名单、审批或签到证据不一致');
    if(workflowConfig(event).blood&&(!registration['签到照片ID']||!registration['签到提交时间']))throw fail(409,'献血车签到照片证据缺失');
    return {data,registration,event,checkin,sourceHash:snapshot(event,registration,checkin),...(workflowConfig(event).source?.kind==='generated_blood'?{stableSourceHash:snapshot(event,registration,checkin,{stableCapacity:true})}:{})};
  }
  async function mirror(accountId){
    const data=await read();const rows=data.ledger.filter(row=>row['账号ID']===accountId&&['已批准','已入账'].includes(row['状态']));
    if(!rows.length)throw fail(409,'没有已批准时长');
    for(const row of rows)assertReviewedLedger(row,await evidence(row['报名行ID'],data));
    const ids=new Set();const identities=new Set();
    for(const row of rows){if(ids.has(row['幂等键']))throw fail(409,'重复时长明细，停止对账');ids.add(row['幂等键']);identities.add(JSON.stringify([row['学号'],row['姓名']]));}
    if(identities.size!==1)throw fail(409,'时长明细身份冲突');
    const sum=key=>number(rows.filter(row=>number(row['服务时长'],'服务时长')>0).reduce((total,row)=>total+number(row[key],key),0),`累计${key}`);
    const hours=sum('服务时长'),training=sum('培训时长'),travel=sum('交通时长');
    const checksum=digest(rows.map(row=>[row['幂等键'],row['服务时长'],row['培训时长'],row['交通时长']]).sort((a,b)=>a[0].localeCompare(b[0])));
    const first=rows[0],registration=one(data.registrations,row=>row._id===first['报名行ID'],'报名');
    const common={账号ID:accountId,学号:first['学号'],姓名:first['姓名'],培训时长:training,交通时长:travel,明细摘要:checksum,更新时间:at()};
    // Absolute recomputation: a half-success retry writes the same totals, never +hours.
    for(const [table,existing,patch,step] of [[WF.summaries,data.summaries,{...common,服务时长:hours},'summary'],[WF.profiles,data.profiles,{...common,邮箱:registration['邮箱'],志愿时长:hours},'profile']]){
      const target=one(existing,row=>row['账号ID']===accountId,'时长镜像',{optional:true});
      if(target){if(target['学号']!==first['学号']||target['姓名']!==first['姓名'])throw fail(409,'时长镜像身份冲突');await update(table,target,patch);}
      // 新建的镜像行要回到本次快照里，后续按快照计算关联链接才不会漏掉它。
      else existing.push(await append(table,patch));
      await onStep(step);
    }
    // 复用本次入账已加载的整库快照：否则每入账一条都会再读四张表。
    for(const row of rows){if(row['状态']!=='已入账')await update(WF.ledger,row,{状态:'已入账',入账时间:at()});const r=one(data.registrations,item=>item._id===row['报名行ID'],'报名');await update(WF.registrations,r,{录入状态:'网站已入账',志愿时长:row['服务时长']});await syncLinks(r,data);await onStep('registration');}
    return {accountId,serviceHours:hours,trainingHours:training,travelHours:travel,ledgerCount:rows.length,checksum};
  }
  function prepare(body,{defaultPosition=true}={}){
      if(body.window!==undefined){
        const window=activityWindow(body.window?.start,body.window?.end);
        if(!window||body.ordinary||body.blood||body.templateId==='blood_vehicle')throw fail(400,'活动起止时间无效');
        body={...body,date:window.start.slice(0,10),slot:`${window.start.slice(0,19).replace('T',' ')} — ${window.end.slice(0,19).replace('T',' ')}`,startTime:undefined,endTime:undefined,window:{start:window.start,end:window.end}};
      }
      const title=required(body.name,'活动名称'),date=required(body.date,'报名日期');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date)throw fail(400,'日期格式无效');
      const ordinary=body.ordinary?validateOrdinarySession(body.ordinary,date):null;
      const config={name:title,date,slot:required(body.slot,'时段'),position:str(body.position)||(defaultPosition&&!ordinary&&!body.blood&&body.bookingMode!=='grouped'?'默认服务岗':''),capacity:number(body.capacity,'容量',{positive:true,integer:true}),service:ordinary?.hoursPending?0:number(body.serviceHours,'服务时长',{positive:true}),training:ordinary?.hoursPending?0:number(body.trainingHours??1,'培训时长'),travel:ordinary?.hoursPending?0:number(body.travelHours??1,'交通时长'),location:required(body.location,'地点'),work:required(body.work,'工作内容')};
      if(ordinary)config.ordinary=ordinary;
      if(body.window)config.window=body.window;
      if(body.bookingMode!==undefined){if(!['unified','grouped'].includes(body.bookingMode)||body.bookingMode==='grouped'&&(!body.window||ordinary))throw fail(400,'报名方式或活动时间范围无效');config.bookingMode=body.bookingMode;}
      if(body.registrationLimit!==undefined)config.registrationLimit=number(body.registrationLimit,'报名上限',{positive:true,integer:true});
      if(config.registrationLimit<config.capacity||ordinary&&config.registrationLimit&&config.registrationLimit!==config.capacity)throw fail(400,'报名上限不符合录取规则');
      config.region=body.region||'南京活动';if(!['南京活动','苏州活动'].includes(config.region))throw fail(400,'活动类型无效');
      config.center=str(body.center);if(config.center)config.center=activityKind({center:config.center});if(config.center&&!ACTIVITY_CENTERS.includes(config.center))throw fail(400,'活动中心无效');
      config.team=str(body.team);config.content=str(body.content)||config.work;
      config.benefits=str(body.benefits)||'丰富的志愿时长';config.requirements=str(body.requirements)||'按时到岗，服从活动安排';
      if([config.team,config.content,config.benefits,config.requirements,config.position].some(v=>v.length>500))throw fail(400,'活动字段不能超过500字');
      if(body.startTime||body.endTime){const duration=serviceDuration(body.startTime,body.endTime);if(!duration||ordinary)throw fail(400,'请选择有效的整点或半点时段');config.startTime=body.startTime;config.endTime=body.endTime;config.slot=`${body.startTime}-${body.endTime}`;config.service=duration;}
      config.coOwners=body.coOwners??[];if(!Array.isArray(config.coOwners)||config.coOwners.length>20||config.coOwners.some(v=>typeof v!=='string'||!v||v.length>100))throw fail(400,'补充负责人无效');config.coOwners=[...new Set(config.coOwners)];
      if(body.reviewerIds!==undefined){if(!Array.isArray(body.reviewerIds)||body.reviewerIds.length>50||body.reviewerIds.some(id=>typeof id!=='string'||!id||id.length>100))throw fail(400,'审核人选择无效');config.reviewerIds=[...new Set(body.reviewerIds)];}
      if(body.publishAt){const time=body.publishAt,instant=shanghaiInstant(time),start=config.window?.start||ordinary?.start||body.blood?.start||`${date}T${config.startTime||(/^(\d{2}:\d{2})/.exec(config.slot)?.[1])||'00:00'}:00+08:00`;if(typeof time!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?\+08:00$/.test(time)||!instant||instant.timestamp>=Date.parse(start))throw fail(400,'报名开始时间须为活动开始前的北京时间');config.publishAt=time;}
      const template=ACTIVITY_TEMPLATES.find(t=>t.id===(body.templateId||'general'));if(!template)throw fail(400,'活动模板不存在');
      config.templateId=template.id;
      if(body.recommended!==undefined&&body.recommended!==''){config.recommended=number(body.recommended,'推荐人数',{positive:true,integer:true});if(config.recommended>config.capacity)throw fail(400,'推荐人数不能超过报名上限');}
      if(body.blood)config.blood=body.blood;
      else if(template.id==='blood_vehicle'){
        if(!BLOOD_POINTS.includes(config.location)||!BLOOD_SHIFTS.includes(config.slot))throw fail(400,'献血车点位或班次不符合现有模板');
        const week=number(body.week,'周次',{positive:true,integer:true});config.blood={mode:'blood_vehicle',week,key:`${date}|${config.location}|${config.slot}`,...rosterTimes(date,config.slot)};
      }
      if(body.source)config.source=body.source;
      return {活动名称:title,活动类别:config.blood?'献血车志愿服务':required(body.category||template.category,'类别'),组织类别:config.center||'未分类',活动地区:config.region==='苏州活动'?'苏州地区':'南京地区',报名日期:date,报名时段:config.slot,岗位:config.position,容量:config.capacity,服务时长:config.service,培训时长:config.training,交通时长:config.travel,地点:config.location,工作内容:config.work,通知草稿:noticeTemplate(config),报名页配置:JSON.stringify(config),准备状态:'已准备'};
  }
  function assertPrepared(event){
    const c=workflowConfig(event);if(event['准备状态']!=='已准备'||!c||typeof c!=='object')throw fail(409,'请先完善活动配置');
    if(c.blood){const expected=rosterTimes(event['报名日期'],event['报名时段']);if(!BLOOD_POINTS.includes(event['地点'])||!BLOOD_SHIFTS.includes(event['报名时段'])||c.blood.mode!=='blood_vehicle'||c.blood.start!==expected.start||c.blood.end!==expected.end||c.blood.key!==`${event['报名日期']}|${event['地点']}|${event['报名时段']}`)throw fail(409,'献血车班次配置不一致');}
    const pairs={name:'活动名称',date:'报名日期',slot:'报名时段',position:'岗位',capacity:'容量',service:'服务时长',training:'培训时长',travel:'交通时长',location:'地点',work:'工作内容'};
    if(Object.entries(pairs).some(([key,column])=>String(c[key]??'')!==String(event[column]??'')))throw fail(409,'表格配置与报名配置不一致，请重新编辑保存');
    const prepared=prepare({...c,serviceHours:c.service,trainingHours:c.training,travelHours:c.travel,startTime:c.ordinary?undefined:c.startTime,endTime:c.ordinary?undefined:c.endTime},{defaultPosition:false});
    if(Object.values(pairs).some(column=>String(prepared[column]??'')!==String(event[column]??'')))throw fail(409,'活动时间或配置已改变，请重新编辑后提交');
  }
  async function assignApproval(event){
    if(!approvalRouting)return event;
    const config=workflowConfig(event);config.approval=await approvalRouting.assign(event);delete config.approvalReturn;
    return {...event,报名页配置:JSON.stringify(config)};
  }
  async function createEvent(body,actor){const prepared=prepare(body);const blood=workflowConfig(prepared).blood;if(blood&&(await workflowRows(base,WF.events)).some(e=>workflowConfig(e).blood?.key===blood.key))throw fail(409,'该日期点位班次已存在，请编辑原班次或先从回收站恢复');await registrationWriter.encode({报名时段:prepared['报名时段'],岗位:prepared['岗位']});const draft=eventDraft(prepared,body,actor);return append(WF.events,body.submit===false?draft:await assignApproval(draft));}
  function eventDraft(prepared,body,actor){return {...prepared,活动ID:`WF-${randomUUID()}`,负责人账号ID:actor,申请版本:1,批准版本:'',状态:body.submit===false?'草稿':'待审核',创建时间:at()};}
  async function sources(managed=[]){const meta=await base.getMetadata();const tables=new Set(meta.tables.map(t=>t.name));const rows=await Promise.all(['活动报名总表','登记审批'].map(t=>tables.has(t)?workflowRows(base,t):[]));return sourceActivities(rows[0],rows[1],managed);}
  const projectService=projectPositions({eventBy,rows:table=>workflowRows(base,table),append,update,prepare,approved:workflowEventApproved,approvalHash:workflowApprovalHash,eventsTable:WF.events,registrationsTable:WF.registrations,now});
  // 按字段建索引；写入上下文里的整表读会真实回源，循环里每读一次都是一次跨境往返。
  function indexRows(rows,keyOf){const index=new Map();for(const row of rows){const key=keyOf(row);if(key===undefined||key===null||key==='')continue;const bucket=index.get(key);if(bucket)bucket.push(row);else index.set(key,[row]);}return index;}
  function pickOne(index,key,label){const matches=index.get(key)||[];if(matches.length>1)throw fail(409,`${label}出现重复，需对账`);if(!matches.length)throw fail(404,`${label}不存在`);return matches[0];}
  async function applyWorkspaceLiveEdit(event,receipt){
    const plan=receipt.plan,groupIds=[...new Set([plan.previousGroupId,plan.group?.id].filter(Boolean))];
    // 三张表各读一次，之后所有条目都走内存索引。
    const [groupRows,eventRowsAll,registrationRows]=await Promise.all([workflowRows(base,ORDINARY_GROUP_TABLE),workflowRows(base,WF.events),workflowRows(base,WF.registrations)]);
    const groupsById=indexRows(groupRows,row=>row['活动组ID']),eventsByActivityId=indexRows(eventRowsAll,row=>row['活动ID']),eventsById=indexRows(eventRowsAll,row=>row._id),registrationsById=indexRows(registrationRows,row=>row._id);
    // 新建的项目行不在此前读到的快照里，直接复用写入结果，避免为了补写再读一次整表。
    let groupRow=null;
    for(const id of groupIds){const rows=groupsById.get(id)||[];if(rows.length>1)throw fail(409,'活动项目记录重复，请核对');
     if(rows[0]){await update(ORDINARY_GROUP_TABLE,rows[0],{报名开关:'关闭'});if(plan.group?.id===id)groupRow=rows[0];}
     else if(plan.group?.id===id)groupRow=await append(ORDINARY_GROUP_TABLE,{活动组ID:id,...plan.group.patch,状态:'草稿',报名开关:'关闭'});}
    for(const item of plan.jobs){const matches=eventsByActivityId.get(item.row['活动ID'])||[];if(matches.length>1)throw fail(409,'岗位记录重复，请核对');if(matches.length)await update(WF.events,matches[0],item.row);else await append(WF.events,{...item.row,创建时间:at()});}
    for(const item of plan.registrationPatches){await update(WF.registrations,pickOne(registrationsById,item.id,'报名'),item.patch);}
    for(const item of plan.removed){await update(WF.events,pickOne(eventsById,item.id,'岗位'),item.patch);}
    const config=JSON.parse(plan.parentPatch['报名页配置']);config.workspaceEdit={...receipt,status:'finishing'};
    const patch={...plan.parentPatch,报名页配置:JSON.stringify(config)};patch['批准摘要']=workflowApprovalHash({...event,...patch});await update(WF.events,event,patch);
    if(plan.group){const group=groupRow||pickOne(groupsById,plan.group.id,'活动项目');await update(ORDINARY_GROUP_TABLE,group,plan.group.patch);}
    config.workspaceEdit={status:'complete',actor:receipt.actor,token:receipt.token,digest:receipt.digest,expectedVersion:receipt.expectedVersion};
    patch['报名页配置']=JSON.stringify(config);patch['批准摘要']=workflowApprovalHash({...event,...patch});await update(WF.events,event,patch);
    return {id:event._id,version:Number(patch['申请版本'])};
  }
  const hoursSubmission=createHoursSubmission({store:hoursSubmissionStore,read,write,now,strictReview:mode==='production',assertReviewer:async(event,actor)=>{if(approvalRouting)await approvalRouting.assertReviewer(event,actor);},evidence:async(id,data)=>{
    const source=await evidence(id,data);return {...source,assertEntry:entry=>assertReviewedLedger(entry,source)};
  }});
  async function assertHoursReviewer(event,actor){
    if(!event)throw fail(409,'时长对应的活动不存在');
    if(!supportsHoursSubmission(event))return;
    await hoursSubmission.assertHoursReviewable(event);
    if(approvalRouting)await approvalRouting.assertReviewer(event,actor);
  }
  async function validatePublicationTime(row,publishAt){
    const instant=typeof publishAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(publishAt)&&shanghaiInstant(publishAt);
    if(!instant||instant.timestamp<=now())throw fail(400,'定时发布时间须为未来的北京时间，精确到秒');
    const c=workflowConfig(row),plan=assertProjectPositions(row);
    const start=c.window?.start||sessionWindow(row)?.start||`${row['报名日期']}T${c.startTime||(/^(\d{2}:\d{2})/.exec(c.slot)?.[1])||'00:00'}:00+08:00`;
    const limits=[start,...(plan?.positions||[]).map(p=>p.start)];
    if(plan)limits.push(plan.deadline);
    // Materializing a ready draft replaces the group's old deadline too.
    const groupId=c.ordinary?.groupId||(row['状态']==='可发布'&&c.positionDraft?undefined:c.positionPlan?.groupId);
    if(groupId){const groups=(await workflowRows(base,ORDINARY_GROUP_TABLE)).filter(g=>g['活动组ID']===groupId);if(groups.length!==1)throw fail(409,'活动项目记录不完整');limits.push(groups[0]['报名截止']);}
    if(limits.some(limit=>!Number.isFinite(Date.parse(limit))||instant.timestamp>=Date.parse(limit)))throw fail(400,'定时发布须早于活动、岗位开始及报名截止');
  }
  async function authorizeRegistration(row,actor){
    if(workflowConfig(row).approval?.mode!=='workspace-regional')return;
    if(!approvalRouting?.assertRegistrar)throw fail(503,'地区报名管理权限服务尚未就绪');
    await approvalRouting.assertRegistrar(row,actor);
  }
  async function assertPublisher(row,actor){
    if(workflowConfig(row).approval?.mode==='workspace-regional'&&!approvalRouting?.assertPublisher)throw fail(503,'地区发布权限服务尚未就绪');
    if(approvalRouting?.assertPublisher)await approvalRouting.assertPublisher(row,actor);
  }
  async function publishEvent(id,{publishAt,actor}={}){
    const row=await eventBy(id),c=workflowConfig(row);
    await assertPublisher(row,actor);
    if(c.parentActivityId)throw fail(409,'请从项目统一发布岗位');
    if(!['可发布','报名中'].includes(row['状态'])||!workflowEventApproved(row)||row['准备状态']!=='已准备')throw fail(409,'申请未获批或准备未完成');
    assertPrepared(row);
    if(publishAt!==undefined&&publishAt!==null){
      if(row['状态']!=='可发布'&&!(Date.parse(c.publishAt)>now())){
        // An interrupted grouped publish can leave the parent open while its
        // durable group barrier remains closed. Permit that recovery only.
        const groups=c.bookingMode==='grouped'&&c.positionPlan?.groupId?(await workflowRows(base,ORDINARY_GROUP_TABLE)).filter(g=>g['活动组ID']===c.positionPlan.groupId):[];
        if(groups.length!==1||groups[0]['状态']!=='草稿'||groups[0]['报名开关']!=='关闭')throw fail(409,'已开放报名的活动不能改为未来定时发布');
      }
      await validatePublicationTime(row,publishAt);
    }
    if(c.bookingMode==='grouped')return projectService.publish(id,{publishAt});
    if(publishAt===null)delete c.publishAt;else if(publishAt!==undefined)c.publishAt=publishAt;
    if(c.publicationNotice&&!c.publicationNotice.publishedAt)c.publicationNotice.publishedAt=at();
    const patch={状态:'报名中',报名页配置:JSON.stringify(c),通知草稿:syncNoticeSchedule(row['通知草稿'],c.publishAt)};patch['批准摘要']=workflowApprovalHash({...row,...patch});
    await update(WF.events,row,patch);
    return {count:1,publishAt:c.publishAt||null};
  }
  const activityChanges=activityChangeStore?createActivityChangeWorkflow({
    store:activityChangeStore,transaction:write,loadRows:table=>loadWorkflowRows(base,table),tables:WF,
    prepare,assertPrepared,approvalHash:workflowApprovalHash,isApproved:workflowEventApproved,approvalRouting,
    updateEvent:(event,patch)=>update(WF.events,event,patch),
  }):null;
  /** 周次自动化：底表生成、发布时间配置与后台定时执行（见 blood-week-automation.js）。 */
  async function generateBloodWeek({monday=null,templateMonday=null,publishAt,weeksAhead,actor='',automatic=false}={}){
   if(!bloodSourceTable)throw fail(409,'当前环境未接入自动排班底表');
   const settings=bloodWeekSettings();
   // 生成前后都直读底表，不命中展示缓存，避免把同一周次写两遍。
   const rows=await workflowRows(base,bloodSourceTable,0);
   const plan=planBloodWeek({rows,now:now(),monday,templateMonday,weeksAhead});
   if(plan.existing)throw Object.assign(fail(409,`底表已有 ${plan.label} 的 ${plan.existing} 行排班，请先核对后再生成`),{code:'blood_week_exists'});
   if(!plan.positions.length)throw fail(409,'模板周次没有可复制的岗位');
   let scheduled=null;
   if(publishAt===null||publishAt===false)scheduled=null;
   else if(publishAt!==undefined){
    if(typeof publishAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(publishAt)||!(shanghaiInstant(publishAt)?.timestamp>now()))throw fail(400,'发布时间须为未来的北京时间，精确到秒');
    scheduled=publishAt;
   }
   else scheduled=settings.autoPublish?nextWeekdayInstant({from:now(),weekday:settings.publishWeekday,hour:settings.publishHour,minute:settings.publishMinute}):null;
   const written=await appendBloodWeekRows(base,bloodSourceTable,plan.positions);
   const after=await workflowRows(base,bloodSourceTable,0);
   const count=after.filter(row=>bloodWeekStart(bloodSourceRowDate(row))===plan.monday).length;
   if(count<plan.positions.length)throw fail(502,'排班写入未确认，请刷新核对后再试');
   if(bloodWeekStore){
    if(scheduled)bloodWeekStore.setSchedule(plan.key,scheduled,actor,automatic?'auto':'manual');
    bloodWeekStore.markRun(`week:${plan.monday}`,{weekKey:plan.key,rows:written.appended,status:'created',actor,at:at()});
   }
   invalidateDisplayReads([bloodSourceTable,WF.events]);
   onSourceLifecycleChanged();
   return {monday:plan.monday,sunday:plan.sunday,label:plan.label,name:plan.name,week:plan.week,key:plan.key,templateMonday:plan.template.monday,templateLabel:plan.template.label,templateWeek:plan.template.week,rows:written.appended,sessionCount:count,publishAt:scheduled};
  }
  async function bloodWeekStatus(){
   if(!bloodSourceTable)throw fail(409,'当前环境未接入自动排班底表');
   const settings=bloodWeekSettings();
   const [sourceRows,events]=await Promise.all([workflowRows(base,bloodSourceTable),eventRows(true)]);
   const byWeek=new Map();
   for(const row of events.filter(item=>workflowConfig(item).source?.kind==='generated_blood')){
    const key=activityProjectKey(row),monday=bloodWeekStart(row['报名日期']);
    const item=byWeek.get(key)||{key,monday,sunday:bloodWeekEnd(monday),sessions:0,capacity:0,openSessions:0};
    item.sessions+=1;item.capacity+=Number(row['容量']||0);
    if(workflowConfig(row).sourceRegistration?.enabled!==false)item.openSessions+=1;
    byWeek.set(key,item);
   }
   const weeks=[...byWeek.values()].map(item=>({...item,label:bloodWeekLabel(item.monday),name:bloodWeekName(item.monday),publishAt:bloodWeekStore?.schedule(item.key)?.publishAt||null})).sort((a,b)=>a.monday.localeCompare(b.monday));
   let next=null;
   try{
    const plan=planBloodWeek({rows:sourceRows,now:now()});
    next={monday:plan.monday,sunday:plan.sunday,label:plan.label,name:plan.name,week:plan.week,templateMonday:plan.template.monday,templateLabel:plan.template.label,templateWeek:plan.template.week,positionCount:plan.positions.length,exists:Boolean(plan.existing)};
   }catch(error){next={error:error.message};}
   return {sourceTable:bloodSourceTable,settings,weeks,next,recentRuns:bloodWeekStore?bloodWeekStore.runs(5):[],availableWeeks:bloodWeekInventory(sourceRows).map(week=>({monday:week.monday,label:week.label,week:week.week,rows:week.rows.length})),generatedAt:at()};
  }
  /** 后台定时入口：只在配置的时间点到达且本周未执行过时才写入；失败不标记完成。 */
  async function runBloodWeekAutomation({actor='njutable-automation'}={}){
   if(!bloodSourceTable||!bloodWeekStore)return {ran:false,reason:'not-configured'};
   const settings=bloodWeekSettings();
   if(!settings.autoGenerate)return {ran:false,reason:'disabled'};
   const current=now(),parts=shanghaiParts(current);
   if(parts.weekday!==settings.generateWeekday)return {ran:false,reason:'not-scheduled'};
   if(parts.hour<settings.generateHour||parts.hour===settings.generateHour&&parts.minute<settings.generateMinute)return {ran:false,reason:'too-early'};
   const runKey=`${bloodWeekStart(parts.date)}:generate`;
   if(bloodWeekStore.run(runKey))return {ran:false,reason:'already-run'};
   try{
    const result=await generateBloodWeek({actor,automatic:true});
    bloodWeekStore.markRun(runKey,{weekKey:result.key||'',rows:result.rows,status:'created',actor,at:at()});
    return {ran:true,result};
   }catch(error){
    // 该周次已存在视为本周已完成；其他错误留给下一个周期重试。
    if(error?.code==='blood_week_exists'){bloodWeekStore.markRun(runKey,{weekKey:'',rows:0,status:'exists',actor,at:at()});return {ran:false,reason:'exists'};}
    throw error;
   }
  }
  return {
    ...Object.fromEntries(Object.entries(hoursSubmission).filter(([name])=>!['projectHoursState','assertHoursUnlocked','assertHoursReviewable'].includes(name))),
    activityChanges,
    configurePositions:(id,body,actor)=>write(()=>projectService.configure(id,body,actor)),
    publishProject:(id,options)=>write(()=>publishEvent(id,options)),
    schedulePublication:(id,publishAt,actor)=>write(async()=>{
      if(publishAt!==null){if(publishAt===undefined)throw fail(400,'请填写定时发布时间');return publishEvent(id,{publishAt,actor});}
      const row=await eventBy(id),c=workflowConfig(row);
      await assertPublisher(row,actor);
      if(c.parentActivityId)throw fail(409,'请从项目统一撤销岗位定时发布');
      if(!['可发布','报名中'].includes(row['状态'])||!workflowEventApproved(row)||!(Date.parse(c.publishAt)>now()))throw fail(409,'当前活动没有可撤销的未来定时发布');
      if(c.bookingMode==='grouped')return projectService.cancelSchedule(id);
      delete c.publishAt;const patch={状态:'可发布',报名页配置:JSON.stringify(c),通知草稿:syncNoticeSchedule(row['通知草稿'],'')};patch['批准摘要']=workflowApprovalHash({...row,...patch});await update(WF.events,row,patch);
      return {count:1,publishAt:null};
    }),
    setSourceRegistration: (id,{enabled,revision,actor,scope='project',ids}={})=>write(async()=>{
      if(typeof enabled!=='boolean'||!Number.isSafeInteger(revision)||revision<0||!['event','project','selection'].includes(scope))throw fail(400,'报名开关参数无效');
      const all=await loadEventRows(true),event=one(all,row=>row._id===id,'活动');
      if(workflowConfig(event).source?.kind!=='generated_blood')throw fail(409,'仅底表同步献血车项目使用此报名开关');
      // A selection batch is an explicit operator choice, so every target is
      // re-read from the live projection instead of trusting stale client keys.
      const generated=rows=>rows.filter(row=>workflowConfig(row).source?.kind==='generated_blood');
      let targets=generated(scope==='event'?[event]:projectEvents(all,event));
      if(scope==='selection'){
        if(!Array.isArray(ids)||!ids.length||ids.length>500)throw fail(400,'请先选择要调整的场次');
        const wanted=new Set(ids.map(value=>String(value)));
        if(wanted.size!==ids.length)throw fail(400,'所选场次重复，请刷新后重新选择');
        targets=generated(all.filter(row=>wanted.has(String(row._id))));
        if(targets.length!==wanted.size)throw fail(409,'所选场次包含不属于献血车排班的班次，请刷新后重新选择');
      }
      if(!approvalRouting?.authorizeRemovalProject)throw fail(503,'地区权限服务尚未就绪');
      await approvalRouting.authorizeRemovalProject(targets,actor);
      if(targets.some(row=>workflowConfig(row).workspaceRemoval))throw fail(409,'活动已结束，不能调整报名');
      if(enabled&&!targets.some(row=>['报名中','进行中'].includes(row['状态'])))throw fail(409,'所选范围已无可开放的班次，请检查底表日期和停点状态');
      const projectKey=activityProjectKey(event),projectControl=activityLifecycleStore.registration(projectKey);
      const control=scope==='selection'
        ? activityLifecycleStore.setRegistrationMany(targets.map(sourceRegistrationKey),{enabled,actor,at:at()})
        : activityLifecycleStore.setRegistration(scope==='event'?sourceRegistrationKey(event):projectKey,{enabled,revision,actor,at:at(),defaultEnabled:projectControl.enabled,targets:scope==='project'?targets.map(sourceRegistrationKey):[]});
      invalidateDisplayReads([WF.events,bloodSourceTable]);
      onSourceLifecycleChanged();
      return {count:targets.length,scope,...control};
    }),
    ...createRosterReview({read,write,update,WF,approved:workflowEventApproved,authorizeRegistration}),
    ...createWorkspaceRemoval({read:removalEvidence,write,update,WF,now,
      authorizeProject:approvalRouting?.authorizeRemovalProject?(events,actor,options)=>approvalRouting.authorizeRemovalProject(events,actor,options):undefined,
      persistSourceRemoval:(event,receipt)=>{activityLifecycleStore.save(activityProjectKey(event),receipt);invalidateDisplayReads([WF.events,bloodSourceTable]);onSourceLifecycleChanged();},
      authorizeRead:async(event,actor)=>{const authorize=approvalRouting?.assertRemovalManager||approvalRouting?.assertRegistrar;if(!authorize)throw fail(503,'地区权限服务尚未就绪');await authorize(event,actor);},
      authorizeChair:async(event,actor)=>{if(!approvalRouting?.assertRemovalReviewer)throw fail(503,'地区主席团权限服务尚未就绪');await approvalRouting.assertRemovalReviewer(event,actor);},
    }),
    ...createFinalHours({read,write,update,WF,approved:workflowEventApproved,now,
      authorizeRead:async(event,actor)=>{if(!approvalRouting?.assertRegistrar)throw fail(503,'地区权限服务尚未就绪');await approvalRouting.assertRegistrar(event,actor);},
      authorizeReview:async(event,actor)=>{if(!approvalRouting?.assertHoursReviewer)throw fail(503,'地区时长审核权限尚未就绪');await approvalRouting.assertHoursReviewer(event,actor);},
      recipient:async event=>{if(!approvalRouting?.hoursRecipient)throw fail(503,'负责人邮箱尚未接入');return approvalRouting.hoursRecipient(event);},
    }),
    ...createRunningReview({read,write,update,WF,approved:workflowEventApproved,secret:checkinSecret,now,authorize:async(event,actor)=>{
      if(!approvalRouting?.assertHoursRecorder)throw fail(503,'负责人初审权限服务尚未就绪');
      await approvalRouting.assertHoursRecorder(event,actor);
    }}),
    createOrdinaryGroup:(body,actor)=>write(async()=>{
      const groupId=required(body.groupId,'活动组ID'),name=required(body.name,'活动名称');
      if(!/^[A-Za-z0-9_-]{1,100}$/.test(groupId)||!Array.isArray(body.sessions)||!body.sessions.length||body.sessions.length>200)throw fail(400,'活动组或班次数量无效');
      const deadline=required(body.registrationEnd,'报名截止');if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+08:00$/.test(deadline)||!Number.isFinite(Date.parse(deadline)))throw fail(400,'截止时间无效');
      const drafts=body.sessions.map(s=>prepare({...s,name,work:body.work,category:body.category||'志愿服务',center:body.center,region:body.region,ordinary:{groupId,start:s.startAt,end:s.endAt,campus:s.campus,hoursPending:true}}));
      if(drafts.some(s=>Date.parse(JSON.parse(s['报名页配置']).ordinary.start)<=Date.parse(deadline)))throw fail(400,'统一报名截止必须早于所有班次开始');
      const keys=drafts.map(s=>`${s['报名日期']}|${s['地点']}|${s['报名时段']}`);if(new Set(keys).size!==keys.length)throw fail(409,'出现重复班次');
      const groups=await workflowRows(base,ORDINARY_GROUP_TABLE),existing=groups.filter(g=>g['活动组ID']===groupId);
      if(existing.length)throw fail(409,'活动组已存在，请核验，不重复创建');
      const metadata=await base.getMetadata(),table=metadata.tables.find(t=>t.name===ORDINARY_GROUP_TABLE);
      if(ORDINARY_GROUP_COLUMNS.some(c=>!table?.columns?.some(x=>x.name===c&&x.type==='text')))throw fail(503,'普通活动项目表结构未准备好');
      for(const prepared of drafts)await registrationWriter.encode({报名时段:prepared['报名时段'],岗位:prepared['岗位']});
      const parent=await append(ORDINARY_GROUP_TABLE,{活动组ID:groupId,活动名称:name,组织类别:drafts[0]['组织类别'],活动地区:drafts[0]['活动地区'],负责人账号ID:actor,班次数:drafts.length,报名截止:deadline,报名开关:'关闭',状态:'草稿',修改人:actor,更新时间:at()});
      const events=[];for(const prepared of drafts)events.push(await append(WF.events,eventDraft(prepared,{submit:false},actor)));
      return {parent,events};
    }),
    ordinarySettings:(id,body,actor)=>write(async()=>{
      const event=await eventBy(id),config=ordinaryConfig(event);if(!config)throw fail(400,'该活动不是普通多班次活动');
      if(!body||Object.keys(body).some(k=>!['deadline','enabled'].includes(k))||typeof body.enabled!=='boolean')throw fail(400,'报名设置无效');
      const deadline=required(body.deadline,'统一截止时间');if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+08:00$/.test(deadline)||!Number.isFinite(Date.parse(deadline)))throw fail(400,'截止时间无效');
      const events=(await eventRows()).filter(e=>ordinaryConfig(e)?.groupId===config.groupId);
      const future=events.filter(e=>now()<Date.parse(ordinaryConfig(e).start));
      if(body.enabled&&(Date.parse(deadline)<=now()||!future.length||events.some(e=>e['状态']!=='报名中'||!workflowEventApproved(e))||future.some(e=>Date.parse(deadline)>=Date.parse(ordinaryConfig(e).start))))throw fail(409,'班次未完整发布或截止时间不合规，不能开放报名');
      const group=one(await workflowRows(base,ORDINARY_GROUP_TABLE),g=>g['活动组ID']===config.groupId,'普通活动项目');
      if(['已结束','进行中'].includes(group['状态']))throw fail(409,'活动已截止报名或已结束，不能修改报名设置');
      if(body.enabled&&events.length!==Number(group['班次数']))throw fail(409,'项目班次不完整，禁止开放');
      await update(ORDINARY_GROUP_TABLE,group,{报名截止:deadline,报名开关:body.enabled?'开放':'关闭',状态:body.enabled||group['状态']==='已发布'?'已发布':'草稿',修改人:actor,更新时间:at()});return {groupId:config.groupId,deadline,enabled:body.enabled,count:events.length};
    }),
    read,
    catalog,detail,
    members: async (id,month) => {
      const event=await eventBy(id),events=scopeEvents({events:await eventRows()},event,month),allowed=new Set(events.map(e=>e['活动ID']));
      // 只取本项目的报名行，不再为一次成员名单读整张报名总表。
      const [registrations,metadata]=await Promise.all([scopedRows(base,WF.registrations,[...allowed]),base.getMetadata()]);
      if(!metadata.tables.some(t=>t.name==='个人主页（编辑版）'))return {people:memberContext(registrations,[]),warning:'未找到成员资料表，红会身份暂标为待确认。'};
      const ids=[...new Set(registrations.map(r=>r['学号']).filter(id=>/^\d{6,20}$/.test(id)))];
      const profiles=[];
      if(base.query){for(let start=0;start<ids.length;start+=100){const selected=ids.slice(start,start+100).map(id=>`'${id}'`).join(',');const found=await base.query(`SELECT 学号,姓名,部门,急救证 FROM \`个人主页（编辑版）\` WHERE 学号 IN (${selected})`);if(!Array.isArray(found))throw fail(502,'成员资料暂不可用');profiles.push(...found);}}
      else profiles.push(...await workflowRows(base,'个人主页（编辑版）'));
      return {people:memberContext(registrations,profiles)};
    },
    attendanceDetail: async id => {
      const data=await read(),registration=one(data.registrations,r=>r._id===id,'报名'),event=one(data.events,e=>e['活动ID']===registration['活动ID'],'活动');
      let legacyRegistrations=[],legacyCheckins=[],warning='';
      try{
        const metadata=await base.getMetadata(),tables=new Set(metadata.tables.map(t=>t.name));
        if(tables.has('活动报名总表')&&tables.has('活动签到')){
          if(base.query&&/^\d{6,20}$/.test(registration['学号'])){
            const sid=registration['学号'];
            [legacyRegistrations,legacyCheckins]=await Promise.all(['活动报名总表','活动签到'].map(table=>base.query(`SELECT * FROM \`${table}\` WHERE 学号 = '${sid}'`)));
            if(!Array.isArray(legacyRegistrations)||!Array.isArray(legacyCheckins))throw Error('Invalid source rows');
          }else [legacyRegistrations,legacyCheckins]=await Promise.all(['活动报名总表','活动签到'].map(table=>workflowRows(base,table)));
        }else warning='旧签到表未配置；下方仅显示网站签到记录。';
      }catch{legacyRegistrations=[];legacyCheckins=[];warning='旧签到表暂时读取失败；下方仅显示网站签到记录。';}
      const detail=attendanceContext(registration,event,data.checkins,legacyRegistrations,legacyCheckins);
      if(warning)detail.warnings.push(warning);
      return detail;
    },
    memberRead: async () => {
      const keys=['events','registrations','ledger','profiles'];
      const sets=await Promise.all(keys.map(key=>key==='events'?eventRows(false,false):workflowRows(base,WF[key])));
      return Object.fromEntries(keys.map((key,index)=>[key,sets[index]]));
    },
    publicRead: async () => {
      const [events, registrations] = await Promise.all([eventRows(false,false), workflowRows(base, WF.registrations)]);
      return { events, registrations };
    },
    overview:async()=>{const data=await overview();return {...data,events:data.events.map(e=>({...e,positionToken:workflowApprovalHash(e),rosterToken:rosterToken(e,data.registrations)}))};},
    bloodWeekStatus,
    generateBloodWeek:body=>write(()=>generateBloodWeek(body||{})),
    bloodWeekSettings:(body,actor='')=>write(async()=>{
      if(!bloodSourceTable)throw fail(409,'当前环境未接入自动排班底表');
      if(!bloodWeekStore)throw fail(503,'献血车排班自动化尚未就绪');
      if(!body||typeof body!=='object'||Array.isArray(body))throw fail(400,'自动排班设置无效');
      const settings=bloodWeekStore.saveSettings(body,actor);
      return {settings};
    }),
    bloodWeekPublish:({monday=null,publishAt=null,actor=''}={})=>write(async()=>{
      if(!bloodSourceTable)throw fail(409,'当前环境未接入自动排班底表');
      if(!bloodWeekStore)throw fail(503,'献血车排班自动化尚未就绪');
      const start=bloodWeekStart(String(monday||''));
      if(start!==String(monday||''))throw fail(400,'请选择有效的周次起始日（周一）');
      const key=bloodWeekKey(start);
      if(publishAt===null||publishAt===''||publishAt===false)bloodWeekStore.clearSchedule(key);
      else{
       if(typeof publishAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(publishAt)||!(shanghaiInstant(publishAt)?.timestamp>now()))throw fail(400,'发布时间须为未来的北京时间，精确到秒');
       bloodWeekStore.setSchedule(key,publishAt,actor,'manual');
      }
      invalidateDisplayReads([bloodSourceTable,WF.events]);
      onSourceLifecycleChanged();
      return {monday:start,label:bloodWeekLabel(start),publishAt:bloodWeekStore.schedule(key)?.publishAt||null};
    }),
    runBloodWeekAutomation,
    bloodScheduleSource:async()=>{
      if(!bloodSourceTable)throw fail(409,'当前环境未接入自动排班底表');
      const templateTable='市血液献血车排班表（模板表）';
      const metadata=await base.getMetadata();
      const templateAvailable=metadata.tables?.some(table=>table.name===templateTable)===true;
      const templateRows=templateAvailable?(await workflowRows(base,templateTable)).map(row=>Object.fromEntries(['序号','点位','活动时间'].map(key=>[key,sourceText(row[key])]))):[];
      const events=(await eventRows(true)).filter(row=>workflowConfig(row).source?.kind==='generated_blood');
      const missingBookingColumns=missingBloodBookingColumns(metadata,bloodSourceTable);
      return {mode:'source-generated',sourceTable:bloodSourceTable,templateTable,templateAvailable,templateRows,bookingReady:missingBookingColumns.length===0,missingBookingColumns,sessionCount:events.length,capacity:events.reduce((sum,row)=>sum+Number(row['容量']||0),0),writes:false};
    },
    positions:async id=>{
      const event=await eventBy(id);if(!bloodSourceTable||workflowConfig(event).source?.kind!=='generated_blood')return [];
      const rows=(await workflowRows(base,bloodSourceTable)).filter(r=>String(r['日期']||'').slice(0,10)===event['报名日期']&&r['点位']===event['地点']&&r['活动时间']===event['报名时段']);
      // 一次批量取回本班次全部学号的资料，不再逐岗位查询。
      const profiles=new Map();
      if(typeof base.query==='function'){
        const studentIds=rows.map(r=>sourceText(r['学号'])||sourceText(r['学号2'])).filter(id=>/^\d{6,20}$/.test(id));
        for(const [key,matches] of await readProfileCandidatesByIds(base,studentIds))profiles.set(key,matches);
      }
      return mapConcurrent(rows, 4, async (r, index) => {
        let profile={...r,姓名:sourceText(r['姓名'])||sourceText(r['姓名2'])||sourceText(r['报名人']),学号:sourceText(r['学号'])||sourceText(r['学号2'])};const studentId=profile['学号'];
        if (
          typeof base.query === 'function'
          && /^\d{6,20}$/.test(studentId)
        ) {
          const matches = profiles.get(studentId) || [];

          if (
            matches.length === 1
            && sourceText(matches[0]['姓名']) === profile['姓名']
          ) {
            profile = { ...profile, ...matches[0] };
          }
        }
        return {position:index+1,status:['停点','已停点'].includes(r['报名结果'])?'停点':bloodSourceOccupied(r)?sourceText(r['报名结果'])||'已占用':'可报名',profile:Object.fromEntries(['姓名','学号','邮箱','手机号','院系','年级','校区','性别','所属部门','急救资质','总志愿时长'].map(key=>[key,sourceText(profile[key])]))};
      });
    },
    sources,
    adopt: (sourceKey,body,actor,managed=[])=>write(async()=>{
      if(body.blood||body.source)throw fail(400,'不能覆盖来源关联');
      const source=one(await sources(managed),r=>r.key===sourceKey,'源活动');
      const existing=one(await workflowRows(base,WF.events),e=>workflowConfig(e).source?.key===sourceKey,'源活动映射',{optional:true});if(existing)return existing;
      return createEvent({...body,source:{key:source.key,table:source.table,id:source.sourceId,hash:source.sourceHash},submit:false},actor);
    }),
    getOwners: async id=>{const event=await eventBy(id),scope=projectEvents(await eventRows(),event);return {primary:event['负责人账号ID'],coOwners:workflowConfig(event).coOwners||[],token:scope.length===1?workflowApprovalHash(event):digest(scope.map(e=>[e._id,workflowApprovalHash(e)]).sort()),count:scope.length};},
    setOwners: (id,body,actor)=>write(async()=>{
      const selected=await eventBy(id),scope=projectEvents(await eventRows(),selected);
      if(!body||Object.keys(body).some(key=>!['coOwners','token','primary'].includes(key))||!Array.isArray(body.coOwners)||body.coOwners.length>20||new Set(body.coOwners).size!==body.coOwners.length||body.coOwners.some(value=>typeof value!=='string'||!value||value.length>100)||body.primary!==undefined&&(typeof body.primary!=='string'||!body.primary||body.primary.length>100))throw fail(400,'负责人配置无效');
      const token=scope.length===1?workflowApprovalHash(selected):digest(scope.map(e=>[e._id,workflowApprovalHash(e)]).sort());
      if(body.token!==token)throw fail(409,'活动已更新，请刷新后调整负责人');
      const changes=scope.map(event=>{const config=workflowConfig(event);
      if(config.source?.kind==='generated_blood'||event['状态']==='已归档')throw fail(409,'当前活动不支持调整负责人');
      const wasApproved=workflowEventApproved(event);
      if(['可发布','报名中','进行中','已结束','停点'].includes(event['状态'])&&!wasApproved)throw fail(409,'活动批准信息不一致，请先核对');
      const primary=body.primary||selected['负责人账号ID'];
      config.coOwners=body.coOwners.filter(owner=>owner!==primary);
      config.ownerChange={actor:required(actor,'修改人'),at:at()};
      const patch={负责人账号ID:primary,报名页配置:JSON.stringify(config)};
      // Delegation changes do not alter approved event content or hour evidence.
      // Re-sign only a previously valid approval, never repair an invalid one.
      if(wasApproved)patch['批准摘要']=workflowApprovalHash({...event,...patch});
      return {event,patch};});
      for(const {event,patch}of changes)await update(WF.events,event,patch);
      const groupId=workflowConfig(selected).ordinary?.groupId||workflowConfig(selected).positionPlan?.groupId;
      if(groupId){const group=one(await workflowRows(base,ORDINARY_GROUP_TABLE),g=>g['活动组ID']===groupId,'普通活动项目');await update(ORDINARY_GROUP_TABLE,group,{负责人账号ID:body.primary||selected['负责人账号ID'],修改人:actor,更新时间:at()});}
    }),
    edit: (id,body,actor)=>write(async()=>{const data=await read(),event=one(data.events,e=>e._id===id||e['活动ID']===id,'活动');if(workflowConfig(event).workspaceSubmission)throw fail(409,'请从新版活动信息修改入口操作');
      if(workflowConfig(event).positionPlan||workflowConfig(event).parentActivityId)throw fail(409,'已配置岗位的项目不能改写批准范围');
      if(['报名中','进行中','已结束','停点','已归档'].includes(event['状态'])||data.registrations.some(r=>r['活动ID']===event['活动ID']))throw fail(409,'已有参与记录或已发布的活动不能改写配置');
      if(body.blood||body.source)throw fail(400,'不能覆盖来源或排班关联');
      const old=workflowConfig(event),prepared=prepare({...body,source:old.source,ordinary:old.ordinary});
      if(old.blood&&JSON.parse(prepared['报名页配置']).blood?.key!==old.blood.key)throw fail(409,'班次日期点位不能修改，请新建班次');
      const preparedConfig=workflowConfig(prepared);let capacityChange;
      if(old.positionDraft){
        if(preparedConfig.bookingMode!=='grouped'||old.positionDraft.positions.some(p=>!positionWithinActivity(p,preparedConfig.window))||!activityWindow(old.positionDraft.deadline,preparedConfig.window?.start))throw fail(409,'已有岗位安排与新活动范围不一致，请先调整岗位');
        const expanded=expandProjectCapacity(event,preparedConfig,old.positionDraft.positions.reduce((n,p)=>n+Number(p.capacity),0));
        capacityChange=expanded.capacityChange;prepared['容量']=String(preparedConfig.capacity);prepared['通知草稿']=expanded.notice;
        preparedConfig.positionDraft={...old.positionDraft,capacityChange};
      }
      if(old.approvalReturn)preparedConfig.approvalReturn=old.approvalReturn;if(old.noticeCustomized){prepared['通知草稿']=event['通知草稿'];preparedConfig.noticeCustomized=true;}preparedConfig.lastEditor=required(actor,'变更提交者');prepared['报名页配置']=JSON.stringify(preparedConfig);
      await update(WF.events,event,{...prepared,申请版本:Number(event['申请版本']||0)+1,批准版本:'',批准摘要:'',审批人:'',审批时间:'',状态:'草稿'});
      return capacityChange;
    }),
    editNotice: (id,text,actor,{publishAt}={})=>write(async()=>{
      const event=await eventBy(id);if(workflowConfig(event).workspaceSubmission)throw fail(409,'请从新版活动信息修改入口操作');if(!['草稿','待审核','可发布'].includes(event['状态']))throw fail(409,'仅未发布活动可以编辑通知');
      if(workflowConfig(event).positionPlan||workflowConfig(event).parentActivityId)throw fail(409,'岗位已按批准内容生成，不能单独改写通知');
      const content=str(text);if(!content||content.length>5000)throw fail(400,'通知不能为空或超过5000字');
      const config=workflowConfig(event);delete config.approval;
      if(publishAt!==undefined){
        if(typeof publishAt!=='string')throw fail(400,'报名开始时间格式无效');
        // Validate the proposed schedule before writing either the text or the configuration.
        const checked=workflowConfig(prepare({...config,publishAt,serviceHours:config.service,trainingHours:config.training,travelHours:config.travel}));
        if(checked.publishAt)config.publishAt=checked.publishAt;else delete config.publishAt;
      }
      config.lastEditor=required(actor,'通知提交者');config.noticeCustomized=true;
      await update(WF.events,event,{通知草稿:content,报名页配置:JSON.stringify(config),申请版本:Number(event['申请版本']||0)+1,批准版本:'',批准摘要:'',审批人:'',审批时间:'',状态:'草稿'});
    }),
    submit: id=>write(async()=>{const event=await eventBy(id);if(workflowConfig(event).workspaceSubmission)throw fail(409,'请从新版活动预览后重新提交');if(!['草稿','待配置'].includes(event['状态'])||event['准备状态']!=='已准备'||!event['报名页配置'])throw fail(409,'请先补全活动配置并保存');assertPrepared(event);const assigned=await assignApproval(event);await update(WF.events,event,{报名页配置:assigned['报名页配置'],状态:'待审核'});}),
    archive: id=>write(async()=>{const data=await read(),event=one(data.events,e=>e._id===id||e['活动ID']===id,'活动');if(workflowConfig(event).workspaceSubmission)throw fail(409,'新版活动请使用工作区删除或结束操作');if(workflowConfig(event).positionPlan||workflowConfig(event).parentActivityId)throw fail(409,'已生成岗位的项目请使用结束活动，保留项目与岗位关系');if(data.registrations.some(r=>r['活动ID']===event['活动ID'])||data.ledger.some(r=>r['活动ID']===event['活动ID']))throw fail(409,'已有参与记录，不能删除；请结束活动并保留记录');if(event['状态']==='已归档')throw fail(409,'已在回收站');await update(WF.events,event,{归档前状态:event['状态'],状态:'已归档'});}),
    restore: id=>write(async()=>{const event=await eventBy(id);if(workflowConfig(event).workspaceSubmission||workflowConfig(event).workspaceRemoval||workflowConfig(event).parentActivityId&&(await eventRows()).some(parent=>parent['活动ID']===workflowConfig(event).parentActivityId&&workflowConfig(parent).workspaceSubmission))throw fail(409,'新版活动不能通过旧版回收站恢复');if(event['状态']!=='已归档')throw fail(409,'活动不在回收站');await update(WF.events,event,{状态:['可发布','报名中','进行中'].includes(event['归档前状态'])&&workflowEventApproved(event)?event['归档前状态']:'草稿'});}),
    // 报名截止：关闭新报名但保留现场签到与时长录入，活动进入「进行中」。
    close: (id,{scope='event',actor}={})=>write(async()=>{
      if(!['event','project'].includes(scope))throw fail(400,'报名截止范围无效');
      const event=await eventBy(id),config=workflowConfig(event);
      if(config.source?.kind==='generated_blood')throw fail(409,'献血车班次由 NJUTable 排班表维护');
      const groupId=config.positionPlan?.groupId||(scope==='project'?config.ordinary?.groupId:null);
      const targets=groupId?projectEvents(await eventRows(),event):[event];
      if(config.approval?.mode==='workspace-regional'){
        for(const target of targets)await authorizeRegistration(target,actor);
        const ids=new Set(targets.flatMap(target=>[target['活动ID'],...(workflowConfig(target).sourceActivityIds||[])]));
        const registrations=(await read()).registrations.filter(row=>ids.has(row['活动ID']));
        if(registrations.some(row=>row['请假状态']==='待审批'||!['已确认','已签到','未入选','已请假'].includes(row['报名状态'])))throw fail(409,'请先将所有有效报名标记为报名成功或报名失败，并处理请假申请');
      }
      if(targets.some(e=>rosterReview(e)?.phase==='publishing'))throw fail(409,'请先完成名单提交');
      if(!targets.some(e=>['报名中','停点'].includes(e['状态'])))throw fail(409,'仅报名中或停点活动可以截止报名');
      if(groupId){
        const group=one(await workflowRows(base,ORDINARY_GROUP_TABLE),g=>g['活动组ID']===groupId,'普通活动项目');
        // Close the shared gate first; a partial transport failure must not reopen bookings.
        await update(ORDINARY_GROUP_TABLE,group,{报名开关:'关闭',状态:'进行中',更新时间:at()});
      }
      for(const target of targets.filter(e=>['报名中','停点'].includes(e['状态'])))await update(WF.events,target,{状态:'进行中'});
    }),
    reopenRegistration: (id,{actor,reason}={})=>write(async()=>{
      const data=await read(),event=one(data.events,e=>e._id===id,'活动'),config=workflowConfig(event);
      if(config.approval?.mode!=='workspace-regional')throw fail(409,'当前活动尚未启用报名回退');
      const explanation=required(reason,'回退原因');if(explanation.length>500)throw fail(400,'回退原因不能超过500字');
      if(config.runningReview?.entries?.length||config.runningReview?.status==='submitted')throw fail(409,'已有时长初审，不能回退报名');
      const groupId=config.positionPlan?.groupId||config.ordinary?.groupId;
      const targets=groupId?projectEvents(data.events,event):[event];
      for(const target of targets){
        if(workflowConfig(target).approval?.mode!=='workspace-regional')throw fail(409,'项目报名策略不一致');
        await authorizeRegistration(target,actor);
        if(target['状态']!=='进行中'||!workflowEventApproved(target)||rosterReview(target)?.phase==='publishing')throw fail(409,'仅已批准且未提交时长的进行中活动可返回报名中');
        const c=workflowConfig(target),start=c.window?.start||sessionWindow(target)?.start;
        if(!start||!Number.isFinite(Date.parse(start))||Date.parse(start)<=now())throw fail(409,'活动已开始或开始时间不明确，不能重新开放报名');
      }
      const ids=new Set(targets.flatMap(target=>[target['活动ID'],...(workflowConfig(target).sourceActivityIds||[])]));
      const registrations=data.registrations.filter(row=>ids.has(row['活动ID']));
      const registrationIds=new Set(registrations.map(row=>row._id));
      if(data.ledger.some(row=>ids.has(row['活动ID'])||registrationIds.has(row['报名行ID']))||data.checkins.some(row=>ids.has(row['活动ID'])||registrationIds.has(row['报名行ID']))||registrations.some(row=>row['报名状态']==='已签到'||row['签到照片ID']||row['签到行ID']))throw fail(409,'已有签到或时长记录，不能返回报名中');
      let group;
      if(groupId){group=one(await workflowRows(base,ORDINARY_GROUP_TABLE),g=>g['活动组ID']===groupId,'普通活动项目');if(Date.parse(group['报名截止'])<=now()||!Number.isFinite(Date.parse(group['报名截止'])))throw fail(409,'原报名截止时间已过，请先核对项目安排');}
      for(const target of targets)await update(WF.events,target,{状态:'报名中'});
      // Reopen the shared gate last. Existing outcomes and mail receipts remain intact.
      if(group)await update(ORDINARY_GROUP_TABLE,group,{报名开关:'开放',状态:'已发布',修改人:actor,更新时间:at()});
      return {count:targets.length,reason:explanation};
    }),
    // 结束活动：时长核对完成后归档为只读结果，不影响既有签到与时长记录。
    finish: (id,actor)=>write(async()=>{
      const event=await eventBy(id),config=workflowConfig(event);
      if(config.workspaceSubmission)throw fail(409,'新版活动须由所属地区主席团导出最终时长表后结束');
      const sheet=await hoursSubmission.hoursSubmissionStatus(id);
      if(approvalRouting||sheet.current.revision){
        if(sheet.current.phase!=='submitted'||sheet.pending.length||sheet.ledger.some(row=>!['已批准','已入账'].includes(row['状态'])))throw fail(409,'请提交整份时长表并完成审核后再结束活动');
        for(const target of sheet.events)if(approvalRouting)await approvalRouting.assertReviewer(target,actor);
      }
      if(config.source?.kind==='generated_blood')throw fail(409,'献血车班次由 NJUTable 排班表维护');
      const groupId=config.positionPlan?.groupId||config.ordinary?.groupId;
      const targets=groupId?projectEvents(await eventRows(),event):[event];
      if(targets.some(e=>rosterReview(e)?.phase==='publishing'))throw fail(409,'请先完成名单提交');
      if(!targets.some(e=>['进行中','停点'].includes(e['状态'])))throw fail(409,'仅进行中活动可以结束');
      // Recheck every approved entry against current source evidence before the
      // first event/group write, including entries approved before submission.
      for(const entry of sheet.ledger.filter(row=>['已批准','已入账'].includes(row['状态'])))assertReviewedLedger(entry,await evidence(entry['报名行ID'],sheet.data));
      for(const target of targets.filter(e=>['进行中','停点'].includes(e['状态'])))await update(WF.events,target,{状态:'已结束'});
      if(groupId){
        const group=one(await workflowRows(base,ORDINARY_GROUP_TABLE),g=>g['活动组ID']===groupId,'普通活动项目');
        await update(ORDINARY_GROUP_TABLE,group,{报名开关:'关闭',状态:'已结束',更新时间:at()});
      }
    }),
    prepareBloodWeek: (body,actor)=>write(async()=>{
      if(bloodSourceTable)throw fail(409,'献血车班次由 NJUTable 自动生成，无需手动排班');
      const drafts=bloodRosterDrafts(await workflowRows(base,'市血液献血车排班表（模板表）'),body);
      // Validate every amount before any durable write.
      number(body.capacity,'容量',{positive:true,integer:true});number(body.serviceHours,'服务时长',{positive:true});number(body.trainingHours??0,'培训时长');number(body.travelHours??0,'交通时长');
      const existing=await workflowRows(base,WF.events),result=[],missing=[];
      // Validate all configurations and conflicts before the first write.
      for(const draft of drafts){draft.submit=body.submit;draft.templateId='blood_vehicle';const prepared=prepare(draft);const found=one(existing,e=>workflowConfig(e).blood?.key===draft.blood.key,'排班',{optional:true});
        if(found){const c=workflowConfig(found);if(Number(c.capacity)!==Number(draft.capacity)||Number(c.service)!==Number(draft.serviceHours)||Number(c.training)!==Number(draft.trainingHours)||Number(c.travel)!==Number(draft.travelHours)||c.blood.week!==draft.blood.week)throw fail(409,'该周排班已有不同规则，请人工校对');result.push(found);}
        else{let row=eventDraft(prepared,draft,actor);if(draft.submit!==false)row=await assignApproval(row);missing.push(row);result.push(row);}}
      if(missing.length){
        if(typeof base.batchAppendRows==='function'){
          await base.batchAppendRows(WF.events,missing.map(value));
          // Resolve persisted row IDs by activity ID, without relying on SDK response order.
          const saved=await workflowRows(base,WF.events);
          for(let index=0;index<result.length;index++)if(!result[index]._id){
            const intended=result[index];const row=one(saved,e=>e['活动ID']===intended['活动ID'],'新班次');
            if(workflowApprovalHash(row)!==workflowApprovalHash(value(intended))||row['状态']!==intended['状态'])throw fail(502,'排班写入结果不一致，请刷新核对后重试');
            result[index]=row;
          }
        }else{
          // Compatibility with adapters that provide only single-row writes.
          for(let index=0;index<result.length;index++)if(!result[index]._id)result[index]=await append(WF.events,result[index]);
        }
      }
      return {count:result.length,events:result};
    }),
    ownRegistration: async(code,account)=>one(await workflowRows(base,WF.registrations),r=>r['报名ID']===code&&r['账号ID']===account.accountId,'本人报名'),
    batchDecide: (eventId,ids,decision,reason)=>write(async()=>{
      if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||!['confirm','reject'].includes(decision))throw fail(400,'请选择1至100条不同报名及有效处理结果');
      const data=await read(),event=one(data.events,e=>e._id===eventId,'活动');
      if(workflowConfig(event).approval?.mode==='workspace-regional')throw fail(409,'请从名单确认工作台调整结果');
      if(!registrationOpen(event,now())||!workflowEventApproved(event))throw fail(409,'活动尚未开放或已结束');
      const rows=ids.map(id=>one(data.registrations,r=>r._id===id&&r['活动ID']===event['活动ID'],'本活动报名'));
      if(rows.some(r=>r['报名状态']!=='待筛选'||r['请假状态']==='待审批'))throw fail(409,'名单状态已变化，请刷新后重新选择待确认的报名');
      const why=decision==='reject'?required(reason,'报名失败原因'):'';
      if(decision==='confirm'&&data.registrations.filter(r=>r['活动ID']===event['活动ID']&&['已确认','已签到'].includes(r['报名状态'])).length+rows.length>Number(workflowConfig(event).registrationLimit??event['容量']))throw fail(409,'批量确认人数超过报名上限，请减少选择');
      const patchOf=()=>({报名状态:decision==='confirm'?'已确认':'未入选',是否报名成功:decision==='confirm'?'true':'false',处理说明:why});
      // 一次提交整批处理结果；批量不可用时退回逐行写入，保留"已处理 X / Y"的定位。
      if(typeof base.batchUpdateRows==='function'){
       try{await updateRows(WF.registrations,rows,patchOf);return {completed:rows.map(row=>row._id)};}
       catch{/* 落到下面的逐行重试 */}
      }
      const completed=[];
      for(const row of rows){try{await update(WF.registrations,row,patchOf());completed.push(row._id);}catch{throw fail(502,`已处理 ${completed.length} / ${rows.length} 人，请刷新名单后仅重试未处理记录`);}}
      return {completed};
    }),
    revokeConfirmation: (id,reason)=>write(async()=>{
      const data=await read(),row=one(data.registrations,r=>r._id===id,'报名'),event=one(data.events,e=>e['活动ID']===row['活动ID'],'活动');
      if(event['状态']!=='报名中'||!workflowEventApproved(event))throw fail(409,'活动已关闭或审批状态改变，不能撤销录取');
      if(row['报名状态']!=='已确认'||row['请假状态']==='待审批')throw fail(409,'仅未申请请假的报名成功人员可以撤销录取');
      if(row['签到照片ID']||row['签到行ID']||data.checkins.some(c=>c['报名行ID']===id)||data.ledger.some(l=>l['报名行ID']===id))throw fail(409,'已有签到或时长记录，不能撤销录取');
      await update(WF.registrations,row,{报名状态:'待筛选',是否报名成功:'false',处理说明:'录取已撤销：'+required(reason,'撤销原因')});
    }),
    reject: (id,reason)=>write(async()=>{const row=one(await workflowRows(base,WF.registrations),r=>r._id===id,'报名');if(rosterReview(await eventBy(row['活动ID']))||workflowConfig(await eventBy(row['活动ID'])).approval?.mode==='workspace-regional')throw fail(409,'请从名单确认工作台调整结果');if(row['请假状态']==='待审批')throw fail(409,'请先处理请假申请');if(row['报名状态']!=='待筛选')throw fail(409,'仅待确认报名可以拒绝');await syncPosition(await eventBy(row['活动ID']),row,'可报名');await update(WF.registrations,row,{报名状态:'未入选',是否报名成功:'false',处理说明:required(reason,'未入选原因')});}),
    registrationContact: async(id,actor,isSuper=false)=>{
      const data=await read(),event=one(data.events,e=>e._id===id,'活动'),targets=projectEvents(data.events,event);
      const contact=workflowConfig(event).registrationContact||{};
      return {contact:{qqGroup:contact.qqGroup||'',invitation:contact.invitation||'',notes:contact.notes||''},token:digest(targets.map(e=>[e._id,e['状态'],e['申请版本'],workflowConfig(e).registrationContact||null])),canEdit:['草稿','待配置','待审核','可发布','报名中'].includes(event['状态'])&&(isSuper||eventResponsibleIds(event).includes(actor))};
    },
    saveRegistrationContact:(id,body,actor,isSuper=false)=>write(async()=>{
      const data=await read(),event=one(data.events,e=>e._id===id,'活动'),targets=projectEvents(data.events,event);
      if(!isSuper&&!eventResponsibleIds(event).includes(actor))throw fail(403,'仅活动负责人或超级管理员可以修改报名联系信息');
      if(!['草稿','待配置','待审核','可发布','报名中'].includes(event['状态']))throw fail(409,'当前阶段不能修改报名联系信息');
      if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['token','qqGroup','invitation','notes'].includes(k)))throw fail(400,'报名联系信息字段无效');
      const contact={};for(const key of ['qqGroup','invitation','notes']){if(typeof body[key]!=='string'||body[key].length>(key==='qqGroup'?30:500))throw fail(400,'报名联系信息格式无效或过长');contact[key]=body[key].trim();}
      if(contact.qqGroup&&!/^\d{5,30}$/.test(contact.qqGroup))throw fail(400,'QQ群号须为5至30位数字');
      if(contact.invitation){let url;try{url=new URL(contact.invitation);}catch{throw fail(400,'邀请链接格式无效');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw fail(400,'邀请链接仅支持HTTP或HTTPS网址');}
      const token=digest(targets.map(e=>[e._id,e['状态'],e['申请版本'],workflowConfig(e).registrationContact||null]));if(body.token!==token)throw fail(409,'活动联系信息已变化，请重新打开后修改');
      for(const target of targets){if(rosterReview(target)?.phase==='publishing')throw fail(409,'名单正在提交，请稍后再修改');}
      for(const target of targets){if(workflowConfig(target).source?.kind==='generated_blood')activityLifecycleStore.setContact(activityProjectKey(target),contact);else await update(WF.events,target,{报名页配置:JSON.stringify({...workflowConfig(target),registrationContact:contact})});}
      invalidateDisplayReads([WF.events,bloodSourceTable]);onSourceLifecycleChanged();
      return {saved:true};
    }),
    requestLeave: (code,account,reason)=>write(async()=>{const data=await read(),row=one(data.registrations,r=>r['报名ID']===code&&r['账号ID']===account.accountId,'本人报名');
      const event=one(data.events,e=>e['活动ID']===row['活动ID'],'活动');
      const policy=registrationLeavePolicy(event,row,{now:now(),hasRecordedEvidence:data.checkins.some(c=>c['报名行ID']===row._id)||data.ledger.some(l=>l['报名行ID']===row._id),reviewLocked:projectEvents(data.events,event).some(e=>workflowConfig(e).runningReview?.status==='submitted'||workflowConfig(e).runningReview?.entries?.some(entry=>entry.id===row._id))});
      if(!policy.allowed)throw fail(409,policy.reason);const {autoApproved}=policy;
      const patch={请假状态:autoApproved?'已批准':'待审批',请假原因:required(reason,'请假原因'),请假申请时间:at(),...(autoApproved?{报名状态:'已请假',是否报名成功:'false',处理说明:'进行中报名尚未审核，系统自动批准请假'}:{})};
      if(autoApproved){await prepareLeaveDecision(event,{...row,...patch},{approved:true,reason:patch.处理说明});await syncPosition(event,row,'可报名');}
      await update(WF.registrations,row,patch);
      return {autoApproved,notificationDecision:autoApproved?{requestAt:patch.请假申请时间,approved:true,reason:patch.处理说明}:null,id:row._id};
    }),
    decideLeave: (id,approved,reason,actor,isSuper=false)=>write(async()=>{
      const row=one(await workflowRows(base,WF.registrations),r=>r._id===id,'报名'),event=await eventBy(row['活动ID']);
      if((actor||mode==='production')&&!isSuper&&!eventResponsibleIds(event).includes(actor))throw fail(403,'仅活动负责人或超级管理员可以审批请假');
      if(rosterReview(event)?.phase==='publishing')throw fail(409,'名单正在提交');
      if(row['请假状态']!=='待审批'||!['待筛选','已确认'].includes(row['报名状态']))throw fail(409,'没有可处理的请假申请');
      const decision={approved,reason:required(reason,'处理说明')};
      await prepareLeaveDecision(event,row,decision);
      if(approved)await syncPosition(event,row,'可报名');
      await update(WF.registrations,row,{请假状态:approved?'已批准':'已驳回',处理说明:decision.reason,...(approved?{报名状态:'已请假',是否报名成功:'false'}:{})});
      return {notificationDecision:{requestAt:row['请假申请时间'],approved,reason:decision.reason}};
    }),
    submitAttendance: (code,account,photoId)=>write(async()=>{const data=await read(),row=one(data.registrations,r=>r['报名ID']===code&&r['账号ID']===account.accountId,'本人报名');if(row['报名状态']!=='已确认'||row['请假状态']==='待审批')throw fail(409,'只有报名成功且未申请请假的记录可以签到');const event=await eventBy(row['活动ID']);if(rosterReview(event)?.phase==='publishing'||rosterReview(event)?.drafts?.[row._id])throw fail(409,'名单正在调整或提交');const project=projectEvents(data.events,event),workspace=project.some(row=>workflowConfig(row).workspaceSubmission);if(!workflowEventApproved(event)||!(event['状态']==='报名中'||(workspace||workflowConfig(event).source?.kind==='generated_blood')&&event['状态']==='进行中')||project.some(row=>workflowConfig(row).runningReview?.status==='submitted'))throw fail(409,'活动未开放签到');const blood=workflowConfig(event).blood;
      const start=blood?.start||sessionWindow(event)?.start||workflowConfig(event).window?.start||`${event['报名日期']}T00:00:00+08:00`,end=blood?.end||sessionWindow(event)?.end||workflowConfig(event).window?.end||`${event['报名日期']}T23:59:59+08:00`;
      if(now()<Date.parse(start)||now()>Date.parse(end))throw fail(409,'尚未进入本次活动签到时段或时段已结束');
      if(!/^[a-f0-9-]{36}$/.test(photoId))throw fail(400,'签到照片无效');if(row['签到照片ID'])throw fail(409,'签到已提交，请等待核验');await update(WF.registrations,row,{签到照片ID:photoId,签到提交时间:at()});return {submitted:true};
    }),
    exportDraft: (id,month)=>exportHours(id,false,month),
    reviewDraft: (id,month)=>exportHours(id,true,month),
    attendanceBatch: (eventId,items,actor)=>writeHours(()=>batch(eventId,items,'registrations',async(item,data)=>{
      const registration=one(data.registrations,r=>r._id===item.id,'报名'),event=one(data.events,e=>e['活动ID']===registration['活动ID'],'活动');
      if(projectEvents(data.events,event).some(row=>workflowConfig(row).workspaceSubmission))throw fail(409,'请在新版进行中页面完成负责人初审');
      reviewDetails(event,item.hours);
      await checkinRow(item.id,actor,'',data);
      return recordHours(item.id,actor,item.hours,data);
    })),
    approveBatch: (eventId,items,actor,role,month)=>writeHours(()=>batch(eventId,items,'ledger',(item,data)=>{
      if(!/^[a-f0-9]{64}$/.test(item.expectedDigest||''))throw fail(400,'请先刷新审核表');
      return approveEntry(item.id,actor,role,item.expectedDigest,data);
    },month)),
    editReview: (eventId,items,actor,role,month)=>writeHours(()=>batch(eventId,items,'ledger',async(item,data)=>{
      if(!item.details||typeof item.details!=='object'||Array.isArray(item.details)||Object.keys(item).some(key=>!['id','expectedDigest','details'].includes(key)))throw fail(400,'修改明细字段无效');
      const row=one(data.ledger,r=>r._id===item.id,'时长明细');
      await assertHoursReviewer(data.events.find(event=>event['活动ID']===row['活动ID']),actor);
      if(row['状态']!=='待批准')throw fail(409,'仅待审核明细可在复核页修改；已通过记录不可改');
      if((row['核对人']===actor||row['账号ID']===actor)&&role!=='super_admin')throw fail(403,'需由另一位管理员复核');
      if(item.expectedDigest!==(row['核对摘要']||reviewDigest(row)))throw fail(409,'明细已改变，请刷新后再修改');
      const source=await evidence(row['报名行ID'],data);assertReviewedLedger(row,source);
      const details=reviewDetails({...source.event,报名日期:source.registration['报名日期'],报名时段:source.registration['报名时段']},item.details);
      const patch={...details,来源摘要:serviceSourceDigest(source),修订人:actor,修订时间:at()};
      patch['核对摘要']=reviewDigest({...row,...patch});
      await update(WF.ledger,row,patch);Object.assign(row,patch);return row;
    },month)),
    returnHours: (id,actor,role,reason,expectedDigest)=>writeHours(async()=>{
      const data=await read(),row=one(data.ledger,r=>r._id===id,'时长明细');
      await assertHoursReviewer(data.events.find(event=>event['活动ID']===row['活动ID']),actor);
      if(row['状态']!=='待批准')throw fail(409,'仅待审核时长可以退回');
      if((row['核对人']===actor||row['账号ID']===actor)&&role!=='super_admin')throw fail(403,'不能退回自己核对的时长');
      if(expectedDigest!==(row['核对摘要']||reviewDigest(row)))throw fail(409,'明细已改变，请刷新后再审核');
      assertReviewedLedger(row,await evidence(row['报名行ID'],data));
      await update(WF.ledger,row,{状态:'已退回',退回原因:required(reason,'退回原因')});
    }),
    mode,
    reconcilePlaces:async()=>{
      if(!places)return {changed:0};
      let changed=0,result;
      do{
        // Seat rows are a projection, not capacity authority. Release the queue
        // between small batches and reread evidence after every foreground write.
        result=await write(async()=>{const data=await overview();return places.reconcile(data.events,data.registrations,{maxChanges:8});});
        changed+=result.changed;
        if(result.remaining)await new Promise(resolve=>setTimeout(resolve,0));
      }while(result.remaining);
      return {...result,changed};
    },
    prepareWorkspaceSubmission:async(input,actor,routing,{version=1}={})=>{
      const row=prepare(input.body),c=workflowConfig(row);
      c.registrationContact={qqGroup:input.content.qqGroup||'',invitation:input.content.invitation||'',notes:input.content.notes||''};c.registrationDeadline=input.deadline;c.workspaceDescription=input.content.description;c.workspaceResponsibleName=input.responsibleName||input.content.responsibleId;c.workspaceResponsibleNames=input.responsibleNames;c.lastEditor=actor;
      if(input.content.bookingMode==='grouped'){
        const positions=normalizePositions(input.positions,c.window);
        c.positionDraft={positions,deadline:input.deadline,inputHash:digest({positions,deadline:input.deadline}),actor,token:''};
      }
      Object.assign(row,{活动ID:'',负责人账号ID:input.content.responsibleId,申请版本:version,批准版本:'',状态:'待审核',创建时间:at(),通知草稿:input.content.notice,报名页配置:JSON.stringify(c)});
      c.approval=await routing.assign(row);row['报名页配置']=JSON.stringify(c);
      await registrationWriter.encode({报名时段:row['报名时段'],岗位:row['岗位']});
      return row;
    },
    canEditWorkspace:async(id,actor)=>{try{const data=await read(),event=one(data.events,e=>e._id===id,'活动'),c=workflowConfig(event);if(!c.workspaceSubmission||c.parentActivityId||!['报名中','进行中'].includes(event['状态'])||!workspaceBeforeStart(event,now())||c.runningReview?.status==='submitted'||c.finalHours?.status==='exported')return false;const ids=new Set(projectEvents(data.events,event).map(e=>e['活动ID']));if(data.checkins.some(r=>ids.has(r['活动ID']))||data.ledger.some(r=>ids.has(r['活动ID'])))return false;await approvalRouting.assertPublisher(event,actor);return true;}catch{return false;}},
    updateWorkspaceSubmission:(id,body,actor,build)=>write(async()=>{
      const data=await read(),event=one(data.events,e=>e._id===id,'活动'),old=workflowConfig(event);
      if(!old.workspaceSubmission||!['草稿','待审核','可发布','报名中','进行中'].includes(event['状态']))throw fail(409,'当前活动不能修改');
      if(!approvalRouting?.assertRegistrar||!approvalRouting?.assertReviewer)throw fail(503,'地区活动权限服务尚未就绪');
      if(event['状态']==='待审核')await approvalRouting.assertReviewer(event,actor);else if(['可发布','报名中','进行中'].includes(event['状态'])){if(!approvalRouting.assertPublisher)throw fail(503,'地区发布权限服务尚未就绪');await approvalRouting.assertPublisher(event,actor);}else await approvalRouting.assertRegistrar(event,actor);
      if(old.workspaceEdit&&old.workspaceEdit.actor===actor&&old.workspaceEdit.token===body.token&&old.workspaceEdit.expectedVersion===body.expectedVersion){
        if(old.workspaceEdit.digest!==workspaceEditDigest(body.content))throw fail(409,'请先核对上次保存结果，不要替换原请求');
        return old.workspaceEdit.status==='complete'?{id,version:Number(event['申请版本'])}:applyWorkspaceLiveEdit(event,old.workspaceEdit);
      }
      if(old.workspaceEdit&&old.workspaceEdit.status!=='complete')throw fail(409,'上次信息修改尚未完成，请由原操作者核对保存结果');
      if(body.token!==workflowApprovalHash(event)||body.expectedVersion!==Number(event['申请版本']))throw fail(409,'活动已更新，请刷新核对');
      const ids=new Set(projectEvents(data.events,event).flatMap(e=>[e['活动ID'],...(workflowConfig(e).sourceActivityIds||[])]));
      if(['报名中','进行中'].includes(event['状态'])){
        if(!workflowEventApproved(event)||old.parentActivityId||Date.parse(old.publishAt)>now())throw fail(409,'当前活动不能直接修改信息');
        const next=normalizeWorkspaceDraft(body.content);if(old.bookingMode===next.bookingMode){const original=workspaceContentFromEvent(event);original.description=old.workspaceDescription||'';if(event['通知草稿']===workspaceNotice(original)&&next.notice===event['通知草稿'])next.notice=workspaceNotice(next);}
        const version=Number(event['申请版本'])+1,prepared=await build(next,version);await approvalRouting.assertPublisher(prepared,actor);
        const plan=planWorkspaceLiveEdit({event,data,prepared,content:next,actor,now:now(),prepare,approvalHash:workflowApprovalHash});
        for(const item of plan.registrationPatches)await registrationWriter.encodeTable(WF.registrations,item.patch);
        const receipt={status:'applying',actor,token:body.token,expectedVersion:body.expectedVersion,digest:workspaceEditDigest(body.content),content:structuredClone(body.content),plan};
        await update(WF.events,event,{报名页配置:JSON.stringify({...old,workspaceEdit:receipt})});
        return applyWorkspaceLiveEdit(event,receipt);
      }
      if(data.registrations.some(r=>ids.has(r['活动ID']))||data.ledger.some(r=>ids.has(r['活动ID'])))throw fail(409,'已有参与记录，不能在待审批页改写');
      const version=Number(event['申请版本'])+1,row=await build(body.content,version),c=workflowConfig(row);
      c.workspaceSubmission=old.workspaceSubmission;if(old.approvalReturn)c.approvalReturn=old.approvalReturn;
      await update(WF.events,event,{...row,活动ID:event['活动ID'],创建时间:event['创建时间'],状态:event['状态']==='可发布'?'待审核':event['状态'],批准版本:'',批准摘要:'',审批人:'',审批时间:'',报名页配置:JSON.stringify(c)});
      return {id,version};
    }),
    confirmWorkspacePreview:(id,{token},actor)=>write(async()=>{
      const event=await eventBy(id),c=workflowConfig(event);
      if(!c.workspaceSubmission||event['状态']!=='草稿')throw fail(409,'当前活动不能确认草稿预览');
      if(!approvalRouting?.assertRegistrar)throw fail(503,'地区活动权限服务尚未就绪');await approvalRouting.assertRegistrar(event,actor);
      if(token!==workflowApprovalHash(event))throw fail(409,'预览版本已失效');
      c.workspacePreview={token,actor};await update(WF.events,event,{报名页配置:JSON.stringify(c)});return {id};
    }),
    resubmitWorkspace:(id,{token},actor)=>write(async()=>{
      const event=await eventBy(id),c=workflowConfig(event);
      if(!c.workspaceSubmission||event['状态']!=='草稿')throw fail(409,'当前活动不能重新提交');
      if(!approvalRouting?.assertRegistrar)throw fail(503,'地区活动权限服务尚未就绪');await approvalRouting.assertRegistrar(event,actor);
      if(token!==workflowApprovalHash(event)||c.workspacePreview?.token!==token||c.workspacePreview.actor!==actor)throw fail(409,'请先预览最新保存版本');
      assertPrepared(event);const assigned=await assignApproval(event),next=workflowConfig(assigned);delete next.workspacePreview;
      await update(WF.events,event,{状态:'待审核',报名页配置:JSON.stringify(next)});return {id};
    }),
    inspectWorkspaceSubmission:async claim=>{
      const matches=(await workflowRows(base,WF.events)).filter(row=>row['活动ID']===claim.activityId);
      if(!matches.length)return null;if(matches.length!==1)throw fail(409,'提交活动标识重复，请核对');
      const row=matches[0],receipt=workflowConfig(row).workspaceSubmission;
      if(receipt?.token!==claim.token||receipt?.digest!==claim.digest)throw fail(409,'提交回执不匹配，请核对');
      return {activityId:claim.activityId,token:receipt.token,digest:receipt.digest,eventId:row._id};
    },
    acceptWorkspaceSubmission:(claim,build)=>write(async()=>{
      if(!/^WS-[a-zA-Z0-9_-]+$/.test(claim.activityId)||!claim.token||!claim.digest||typeof build!=='function')throw fail(400,'提交凭证无效');
      if((await workflowRows(base,WF.events)).some(row=>row['活动ID']===claim.activityId))throw fail(409,'提交活动已存在，请核对原请求');
      const row=await build(),c=workflowConfig(row);
      if(c.approval?.mode!=='workspace-regional'||row['状态']!=='待审核')throw fail(409,'地区审批绑定无效');
      row['活动ID']=claim.activityId;c.workspaceSubmission={token:claim.token,digest:claim.digest};row['报名页配置']=JSON.stringify(c);
      const saved=await append(WF.events,row);
      return {activityId:claim.activityId,token:claim.token,digest:claim.digest,eventId:saved._id};
    }),
    create: (body,actor)=>write(()=>{if(body.ordinary)throw fail(400,'普通多班次活动请使用项目创建入口');if(bloodSourceTable&&(body.templateId==='blood_vehicle'||activityKind({center:body.center})==='献血车专项'))throw fail(409,'献血车班次由 NJUTable 自动生成');if(body.blood||body.source)throw fail(400,'献血车申请请使用排班模板入口');return createEvent(body,actor);}),
    stop: (id,reason)=>write(async()=>{const event=await eventBy(id);if(!workflowConfig(event).blood||event['状态']!=='报名中')throw fail(409,'只有已开放的献血车班次可以停点');await update(WF.events,event,{状态:'停点',停点说明:required(reason,'停点原因')});}),
    approve: (id,actor,role,token)=>write(async()=>{
      const row=await eventBy(id),config=workflowConfig(row);
      if(config.approval?.mode==='workspace-regional'&&!approvalRouting?.assertReviewer)throw fail(503,'地区审批权限服务尚未就绪');
      if(row['状态']!=='待审核')throw fail(409,'只有待审核申请可以批准');
      if(config.workspaceSubmission&&token!==workflowApprovalHash(row))throw fail(409,'活动已更新，请刷新核对后审批');
      assertPrepared(row);const reviewer=approvalRouting?await approvalRouting.assertReviewer(row,actor):null;
      if((eventResponsibleIds(row).includes(actor)||config.lastEditor===actor)&&(approvalRouting?reviewer?.role!=='super_admin'&&!reviewer?.canSelfReview:role!=='super_admin'))throw fail(403,'负责人不能审批自己的申请');
      if(reviewer?.twoStage&&reviewer.approvalLevel==='initial'){
        config.approval.initialReview={actor,name:reviewer.reviewerName,at:at(),version:String(row['申请版本'])};
        const final=config.approval.levels.final;
        Object.assign(config.approval,{reviewerIds:final.ids,reviewerNames:final.names,reviewerId:final.ids[0],reviewerName:final.names[0]});
        await update(WF.events,row,{报名页配置:JSON.stringify(config),批准版本:'',批准摘要:'',审批人:'',审批时间:''});return;
      }
      const approvedAt=at();
      config.publicationNotice={approvedAt,version:String(row['申请版本'])};
      const approvedRow={...row,报名页配置:JSON.stringify(config)};
      await update(WF.events,row,{报名页配置:approvedRow['报名页配置'],批准版本:row['申请版本'],批准摘要:workflowApprovalHash(approvedRow),审批人:actor,审批时间:approvedAt,状态:'可发布'});
    }),
    returnApproval: (id,actor,role,reason,token)=>write(async()=>{
      const event=await eventBy(id);if(event['状态']!=='待审核')throw fail(409,'只有待审核申请可以退回');if(workflowConfig(event).workspaceSubmission&&token!==workflowApprovalHash(event))throw fail(409,'活动已更新，请刷新核对后退回');
      if(!approvalRouting)throw fail(409,'此活动尚未启用主席审核流程');
      const reviewer=await approvalRouting.assertReviewer(event,actor);
      if((eventResponsibleIds(event).includes(actor)||workflowConfig(event).lastEditor===actor)&&reviewer.role!=='super_admin'&&!reviewer.canSelfReview)throw fail(403,'负责人不能审核自己的申请');
      const config=workflowConfig(event);config.approvalReturn={reason:required(reason,'退回原因'),reviewerId:actor,reviewerName:reviewer.reviewerName,returnedAt:at()};delete config.approval;
      await update(WF.events,event,{报名页配置:JSON.stringify(config),状态:'草稿',批准版本:'',批准摘要:'',审批人:'',审批时间:''});
    }),
    publish: (id,options)=>write(()=>publishEvent(id,options)),
    register: (id,account)=>write(async()=>{const row=await eventBy(id);if(row.sourceSuperseded||!registrationOpen(row,now())||!workflowEventApproved(row))throw fail(409,'活动未开放报名');
      const accountId=required(account.accountId,'账号ID'),sid=required(account.studentId,'学号'),name=required(account.realName,'真实姓名'),email=required(account.email,'邮箱');if(!account.emailVerified||!/^\d+@(smail\.nju\.edu\.cn|nju\.edu\.cn)$/.test(email)||email.split('@')[0]!==sid)throw fail(403,'需已验证且学号一致的校园邮箱');
      const regs=await workflowRows(base,WF.registrations);const config=workflowConfig(row),blood=config.blood,activityIds=[row['活动ID'],...(config.sourceActivityIds||[])];
      if(mode==='production'&&config.source?.kind==='generated_blood')await assertBloodBookingSchema(base,bloodSourceTable);
      if(config.ordinary&&!ordinaryRegistrationOpen(row,now()))throw fail(409,'本活动报名已截止或管理员已关闭报名');
      const existing=regs.find(r=>activityIds.includes(r['活动ID'])&&r['账号ID']===accountId&&r['学号']===sid);if(existing&&mode==='production'&&config.source?.kind==='generated_blood'&&existing['报名状态']==='待筛选'){await syncPosition(row,existing);return existing;}
      if(Number(config.sourceOccupied||0)+regs.filter(r=>activityIds.includes(r['活动ID'])&&occupiesSlot(r)).length>=Number(config.approval?.mode==='workspace-regional'?row['容量']:(config.registrationLimit??row['容量'])))throw fail(409,'本班次名额已满，请选择其他时段');
      if(blood||config.ordinary){const window=sessionWindow(row);if(now()>=Date.parse(window.start))throw fail(409,'此班次已开始，不能报名');
        const events=await eventRows();if(regs.some(r=>occupiesSlot(r)&&(r['账号ID']===accountId||r['学号']===sid)&&events.some(e=>{const b=sessionWindow(e);return e['活动ID']===r['活动ID']&&b&&Date.parse(b.start)<Date.parse(window.end)&&Date.parse(b.end)>Date.parse(window.start);})))throw fail(409,'已有重叠班次的报名，请先处理原报名');
      }if(regs.some(r=>activityIds.includes(r['活动ID'])&&(r['账号ID']===accountId||r['学号']===sid)&&occupiesSlot(r)))throw fail(409,'已报名此活动');
      const registration=await append(WF.registrations,{...registrationDetails(row,account),活动名称:row['活动名称'],报名ID:`WR-${randomUUID()}`,活动ID:row['活动ID'],账号ID:accountId,学号:sid,姓名:name,邮箱:email,院系:str(account.department),报名日期:row['报名日期'],报名时段:row['报名时段'],岗位:row['岗位'],校区:str(account.campus),报名状态:'待筛选',是否报名成功:'false',志愿时长:'',录入状态:config.ordinary?.hoursPending?'时长规则待确定':'网站待核对',岗位同步状态:config.source?.kind==='generated_blood'&&mode==='production'?'待同步':'',创建时间:at()});
      await syncPosition(row,registration);await syncLinks(registration);
      return registration;
    }),
    confirm: id=>write(async()=>{
      const data=await read(),row=one(data.registrations,r=>r._id===id,'报名'),event=one(data.events,r=>r['活动ID']===row['活动ID'],'活动'),config=workflowConfig(event);
      if(rosterReview(event)||config.approval?.mode==='workspace-regional')throw fail(409,'请从名单确认工作台调整结果');
      if(row['请假状态']==='待审批')throw fail(409,'请先处理请假申请');
      // Generated shifts end by clock, not by a manager closing the review queue.
      const reviewOpen=event['状态']==='报名中'||config.source?.kind==='generated_blood'&&['进行中','已结束'].includes(event['状态']);
      if(row['报名状态']==='已确认'&&reviewOpen&&workflowEventApproved(event))return row;
      if(row['报名状态']!=='待筛选')throw fail(409,'报名不在待筛选状态');
      if(!reviewOpen||!workflowEventApproved(event))throw fail(409,'活动审批或报名状态已改变');
      if(data.registrations.filter(r=>[row['活动ID'],...(config.sourceActivityIds||[])].includes(r['活动ID'])&&['已确认','已签到'].includes(r['报名状态'])).length+Number(config.sourceOccupied||0)>=number(config.registrationLimit??event['容量'],'容量',{positive:true}))throw fail(409,'活动容量已满');
      await syncPosition(event,row,'成功');await update(WF.registrations,row,{报名状态:'已确认',是否报名成功:'true',处理说明:''});
    }),
    checkin: (id,actor,note)=>write(()=>checkinRow(id,actor,note)),
    /** 现场核验：只认服务端签发的一次性凭证，凭证绑定活动+报名行且限时，避免报名ID被直接当作签到授权。 */
    checkinByTicket: (ticket,actor,note,expectedRegistration)=>write(()=>verifyCheckin(ticket,actor,note,expectedRegistration)),
    issueCheckinTicket: (id,actor)=>write(()=>issueCheckinTicket(id,actor)),
    checkinAndReview: (id,actor,body={})=>writeHours(async()=>{
      for(const [key,label] of [['serviceHours','服务时长'],['trainingHours','培训时长'],['travelHours','交通时长']])if(body[key]!==undefined)number(body[key],label,{positive:key==='serviceHours'});
      const data=await read(),registration=one(data.registrations,r=>r._id===id,'报名'),event=one(data.events,e=>e['活动ID']===registration['活动ID'],'活动');
      if(projectEvents(data.events,event).some(row=>workflowConfig(row).workspaceSubmission))throw fail(409,'请在新版进行中页面完成负责人初审');
      const input=Object.fromEntries(['serviceHours','trainingHours','travelHours'].filter(key=>body[key]!==undefined).map(key=>[key,body[key]]));
      const details=reviewDetails(event,input),existing=one(data.ledger,r=>r['幂等键']===`SERVICE:${registration._id}`,'时长明细',{optional:true});
      if(existing){assertReviewedLedger(existing,await evidence(id,data));if(Object.keys(input).length&&['服务时长','培训时长','交通时长'].some(key=>Number(existing[key])!==Number(details[key])))throw fail(409,'已有时长草稿与本次数值不同，请核对原记录');return existing;}
      await checkinRow(id,actor,body.note,data);return recordHours(id,actor,input,data);
    }),
    reviewHours: (id,actor,input={})=>writeHours(()=>recordHours(id,actor,input)),
    approveHours: (id,actor,role,expectedDigest)=>writeHours(()=>approveEntry(id,actor,role,expectedDigest)),
    post: id=>writeHours(async()=>{const row=one(await workflowRows(base,WF.ledger),r=>r._id===id,'时长明细');if(!['已批准','已入账'].includes(row['状态']))throw fail(409,'时长尚未批准');const source=await evidence(row['报名行ID']);if(supportsHoursSubmission(source.event)&&(await hoursSubmission.hoursSubmissionStatus(source.event._id)).current.revision)await hoursSubmission.assertHoursSubmitted(source.event._id);assertReviewedLedger(row,source);return mirror(row['账号ID']);}),
  };
}
