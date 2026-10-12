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

import { readPagedRows } from '../http/paged-rows.js';
import {ACTIVITY_CENTERS,serviceDuration,noticeTemplate,syncNoticeSchedule,registrationOpen} from '../../public/app/shared/activity-management.js';
import {activityKind} from '../../public/app/shared/activity-taxonomy.js';
import {REGISTRATION_TABLE,normalizeRegistration,createRegistrationWriter,registrationDetails} from './registration-schema.js';
import {syncRegistrationLinks} from './registration-links.js';
import {rosterReview,publishedRosterRow} from '../../public/app/shared/roster-review.js';
import {createRosterReview,rosterToken} from './roster-review.js';
import {ORDINARY_GROUP_TABLE,ORDINARY_GROUP_COLUMNS,ordinaryConfig,sessionWindow,ordinaryRegistrationOpen,validateOrdinarySession,attachOrdinaryControls} from './ordinary-groups.js';
import { syncBloodBooking } from './blood-booking.js';
import { sourceText, bloodSourceOccupied, generatedBloodEvents } from './blood-source.js';
import { displayRead } from '../http/display-reads.js';
import { createHash, randomUUID } from 'node:crypto';
import { sourceActivities } from './catalog.js';
import { ACTIVITY_TEMPLATES } from '../../public/app/shared/activity-templates.js';
import { reviewDetails, reviewDigest, assertReviewedLedger, reviewWorkbookRows } from './hours-review.js';
import { memberContext, attendanceContext } from './service-context.js';
import { createMutationQueue } from './safety.js';
import { bloodRosterDrafts, workflowConfig, BLOOD_POINTS, BLOOD_SHIFTS, rosterTimes } from './blood-roster.js';
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
  if(key==='报名页配置'&&rosterReview(row)){const config=workflowConfig(row);delete config.rosterReview;return JSON.stringify(config);}
  return row[key]||'';
}));
export const workflowEventApproved = row => row['批准版本']===row['申请版本']&&row['批准摘要']===workflowApprovalHash(row);
const at = () => new Date().toISOString();
const value = object => Object.fromEntries(Object.entries(object).map(([key,item])=>[key,String(item??'')]));
export async function workflowRows(base, table, ttlMs = 5_000) {
  return displayRead(base, JSON.stringify(['workflowRows', table]), () => loadWorkflowRows(base, table), ttlMs);
}
async function loadWorkflowRows(base, table) {
  const rows=await readPagedRows(base, table, { maxRows: 100000, requireComplete: true });
  return table===REGISTRATION_TABLE?rows.map(normalizeRegistration):rows;
}
function one(rows,predicate,label,{optional=false}={}){const found=rows.filter(predicate);if(found.length>1)throw fail(409,`${label}出现重复，需对账`);if(!found.length&&!optional)throw fail(404,`${label}不存在`);return found[0];}
function snapshot(event,row,checkin){return digest([event['活动ID'],event['申请版本'],event['批准版本'],event['服务时长'],event['培训时长'],event['交通时长'],event['报名日期'],event['报名时段'],event['岗位'],event['容量'],event['地点'],event['工作内容'],row['账号ID'],row['学号'],row['姓名'],row['报名日期'],row['报名时段'],row['岗位'],row['报名状态'],row['是否报名成功'],checkin._id,checkin['报名行ID'],checkin['学号'],checkin['账号ID'],checkin['核验人'],checkin['核验说明'],checkin['活动时间'],...(workflowConfig(event).blood?[row['签到照片ID'],row['签到提交时间']]:[])]);}
export function createWorkflow(base,{assertWritable=()=>{},assertHoursWritable=()=>{},onStep=async()=>{},now=()=>Date.now(),bloodSourceTable=null,mode='test'}={}) {
  const serial=createMutationQueue();
  const registrationWriter=createRegistrationWriter(base);
  async function syncLinks(row,data){
   try{
    const metadata=await registrationWriter.metadata();
    if(!metadata?.tables?.find(t=>t.name===WF.registrations)?.columns?.some(c=>c.name==='关联状态'))return;
    const loaded=data||Object.fromEntries(await Promise.all(['events','checkins','ledger','profiles'].map(async key=>[key,await workflowRows(base,WF[key])])));
    return syncRegistrationLinks(base,metadata,row,loaded);
   }catch{
    try{await update(WF.registrations,row,{关联状态:'关联待核对'});}catch{/* Do not report a durable booking as failed because navigation links were unavailable. */}
    return '关联待核对';
   }
  }
  async function eventRows(){
    const attach=async rows=>rows.some(ordinaryConfig)?attachOrdinaryControls(rows,await workflowRows(base,ORDINARY_GROUP_TABLE)):rows;
    if(!bloodSourceTable)return attach(await workflowRows(base,WF.events));
    const [stored,sourceRows,websiteRows]=await Promise.all([workflowRows(base,WF.events),workflowRows(base,bloodSourceTable,30_000),workflowRows(base,WF.registrations)]);
    const ownedCodes=new Set(websiteRows.filter(r=>['待筛选','已确认','已签到'].includes(r['报名状态'])).map(r=>r['报名ID']));
    const generated=generatedBloodEvents(sourceRows,now(),ownedCodes);
    const legacyByKey=new Map();for(const e of stored){const key=workflowConfig(e).blood?.key;if(key){const ids=legacyByKey.get(key)||[];ids.push(e['活动ID']);legacyByKey.set(key,ids);}}
    for(const row of generated){const c=workflowConfig(row);c.source.table=bloodSourceTable;c.sourceActivityIds=legacyByKey.get(c.blood.key)||[];row['报名页配置']=JSON.stringify(c);row['批准摘要']=workflowApprovalHash(row);}
    const keys=new Set(generated.map(row=>workflowConfig(row).blood.key));
    return attach([...stored.map(row=>keys.has(workflowConfig(row).blood?.key)?{...row,sourceSuperseded:true}:row),...generated]);
  }
  async function syncPosition(event,row,state='待审核'){if(mode!=='production'||workflowConfig(event).source?.kind!=='generated_blood')return;const sourceId=await syncBloodBooking(base,bloodSourceTable,event,row,state);await update(WF.registrations,row,{岗位源行ID:sourceId||row['岗位源行ID']||'',岗位同步状态:state==='可报名'?'已释放':'已同步'});}
  async function read(){const sets=await Promise.all(Object.entries(WF).map(([key,name])=>key==='events'?eventRows():workflowRows(base,name)));return Object.fromEntries(Object.keys(WF).map((key,index)=>[key,sets[index]]));}
  // Display snapshots only need three tables. Mutation evidence still uses fresh read().
  async function overview(){const keys=['events','registrations','ledger'];const sets=await Promise.all(keys.map(key=>key==='events'?eventRows():workflowRows(base,WF[key])));const data=Object.fromEntries(keys.map((key,index)=>[key,sets[index]]));data.ledger=data.ledger.map(row=>({...row,核对摘要:row['核对摘要']||reviewDigest(row)}));return data;}
  async function write(task){await assertWritable();return serial(task);}
  async function writeHours(task){return write(async()=>{await assertHoursWritable();return task();});}
  async function append(table,row){const encoded=await registrationWriter.encodeTable(table,row);const result=await base.appendRow(table,encoded);if(!result?._id)throw fail(502,'流程写入结果不完整，请刷新对账后重试');return {...(table===WF.registrations?normalizeRegistration(encoded):encoded),_id:result._id};}
  const update=async(table,row,patch)=>{if(table===WF.events&&workflowConfig(row).source?.kind==='generated_blood')throw fail(409,'献血车班次由排班表维护，请在 NJUTable 调整');return base.updateRow(table,row._id,await registrationWriter.encodeTable(table,patch));};
  async function eventBy(id){return one(await eventRows(),row=>row._id===id||row['活动ID']===id,'活动');}
  async function checkinRow(id,actor,note,loaded){
    const data=loaded||await read(),row=one(data.registrations,r=>r._id===id,'报名');
    if(row['请假状态']==='待审批')throw fail(409,'请先处理请假申请');
    if(row['报名状态']==='已签到')return one(data.checkins,c=>c._id===row['签到行ID']&&c['报名行ID']===id,'签到');
    if(row['报名状态']!=='已确认')throw fail(409,'仅已确认名单可以签到');
    const event=one(data.events,e=>e['活动ID']===row['活动ID'],'活动');
    if(rosterReview(event)?.phase==='publishing'||rosterReview(event)?.drafts?.[row._id])throw fail(409,'名单正在调整或提交');
    if(ordinaryConfig(event)&&now()<Date.parse(ordinaryConfig(event).start))throw fail(409,'班次尚未开始，不能核验到场');
    if(!workflowEventApproved(event)||!['报名中','已结束'].includes(event['状态']))throw fail(409,'活动审批或开放状态已改变');
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
    const source=await evidence(id,loaded),{data,registration:r,event:e,checkin:c,sourceHash}=source;
    if(ordinaryConfig(e)?.hoursPending)throw fail(409,'本活动时长规则尚未确定，不能录入、批准或入账');
    const key=`SERVICE:${r._id}`,existing=one(data.ledger,row=>row['幂等键']===key,'时长明细',{optional:true});
    const editing=Object.keys(input).some(key=>key!=='expectedDigest');
    if(existing){
      assertReviewedLedger(existing,source);
      if(!editing)return existing;
      if(!['待批准','已退回'].includes(existing['状态']))throw fail(409,'已审核时长不能修改');
      if(input.expectedDigest!==(existing['核对摘要']||reviewDigest(existing)))throw fail(409,'时长已被更新，请刷新后再修改');
    }
    const row={...(existing||{}),幂等键:key,报名行ID:r._id,签到行ID:c._id,活动ID:r['活动ID'],账号ID:r['账号ID'],学号:r['学号'],姓名:r['姓名'],规则版本:e['申请版本'],
      ...reviewDetails({...e,报名日期:r['报名日期'],报名时段:r['报名时段']},input),状态:'待批准',核对人:actor,来源摘要:`v3:${sourceHash}`,批准人:'',批准时间:'',退回原因:'',修订人:actor,修订时间:at()};
    row['核对摘要']=reviewDigest(row);
    if(existing){await update(WF.ledger,existing,row);Object.assign(existing,row);return existing;}
    const saved=await append(WF.ledger,row);data.ledger.push(saved);await syncLinks(r,data);return saved;
  }
  async function approveEntry(id,actor,role,expectedDigest,loaded){
    const data=loaded||await read(),row=one(data.ledger,r=>r._id===id,'时长明细');
    if(row['状态']!=='待批准')throw fail(409,'时长不在待批准状态');
    if((row['核对人']===actor||row['账号ID']===actor)&&role!=='super_admin')throw fail(403,'核对人不能批准自己的时长核对');
    if(expectedDigest!==undefined&&expectedDigest!==(row['核对摘要']||reviewDigest(row)))throw fail(409,'时长已被修改，请重新查看后审核');
    assertReviewedLedger(row,await evidence(row['报名行ID'],data));
    const patch={状态:'已批准',批准人:actor,批准时间:at()};await update(WF.ledger,row,patch);Object.assign(row,patch);return row;
  }
  function scopeEvents(data,event,month){
    const group=ordinaryConfig(event)?.groupId;
    if(group&&!month)return data.events.filter(e=>ordinaryConfig(e)?.groupId===group);
    if(!month)return [event];
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
    return {data,registration,event,checkin,sourceHash:snapshot(event,registration,checkin)};
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
      if(target){if(target['学号']!==first['学号']||target['姓名']!==first['姓名'])throw fail(409,'时长镜像身份冲突');await update(table,target,patch);}else await append(table,patch);
      await onStep(step);
    }
    for(const row of rows){if(row['状态']!=='已入账')await update(WF.ledger,row,{状态:'已入账',入账时间:at()});const r=one(data.registrations,item=>item._id===row['报名行ID'],'报名');await update(WF.registrations,r,{录入状态:'网站已入账',志愿时长:row['服务时长']});await syncLinks(r);await onStep('registration');}
    return {accountId,serviceHours:hours,trainingHours:training,travelHours:travel,ledgerCount:rows.length,checksum};
  }
  function prepare(body){
      const title=required(body.name,'活动名称'),date=required(body.date,'报名日期');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date)throw fail(400,'日期格式无效');
      const ordinary=body.ordinary?validateOrdinarySession(body.ordinary,date):null;
      const config={name:title,date,slot:required(body.slot,'时段'),position:str(body.position),capacity:number(body.capacity,'容量',{positive:true,integer:true}),service:ordinary?.hoursPending?0:number(body.serviceHours,'服务时长',{positive:true}),training:ordinary?.hoursPending?0:number(body.trainingHours??1,'培训时长'),travel:ordinary?.hoursPending?0:number(body.travelHours??1,'交通时长'),location:required(body.location,'地点'),work:required(body.work,'工作内容')};
      if(ordinary)config.ordinary=ordinary;
      if(body.registrationLimit!==undefined)config.registrationLimit=number(body.registrationLimit,'报名上限',{positive:true,integer:true});
      if(config.registrationLimit<config.capacity||ordinary&&config.registrationLimit&&config.registrationLimit!==config.capacity)throw fail(400,'报名上限不符合录取规则');
      config.region=body.region||'南京活动';if(!['南京活动','苏州活动'].includes(config.region))throw fail(400,'活动类型无效');
      config.center=str(body.center);if(config.center)config.center=activityKind({center:config.center});if(config.center&&!ACTIVITY_CENTERS.includes(config.center))throw fail(400,'活动中心无效');
      config.team=str(body.team);config.content=str(body.content)||config.work;
      config.benefits=str(body.benefits)||'丰富的志愿时长';config.requirements=str(body.requirements)||'按时到岗，服从活动安排';
      if([config.team,config.content,config.benefits,config.requirements,config.position].some(v=>v.length>500))throw fail(400,'活动字段不能超过500字');
      if(body.startTime||body.endTime){const duration=serviceDuration(body.startTime,body.endTime);if(!duration||ordinary)throw fail(400,'请选择有效的整点或半点时段');config.startTime=body.startTime;config.endTime=body.endTime;config.slot=`${body.startTime}-${body.endTime}`;config.service=duration;}
      config.coOwners=body.coOwners??[];if(!Array.isArray(config.coOwners)||config.coOwners.length>20||config.coOwners.some(v=>typeof v!=='string'||!v||v.length>100))throw fail(400,'补充负责人无效');config.coOwners=[...new Set(config.coOwners)];
      if(body.publishAt){const time=String(body.publishAt);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::00)?\+08:00$/.test(time)||!Number.isFinite(Date.parse(time))||new Date(Date.parse(time)+8*3600000).toISOString().slice(0,16)!==time.slice(0,16)||Date.parse(time)>=Date.parse(`${date}T${config.startTime||'23:59'}:00+08:00`))throw fail(400,'报名开始时间须为活动开始前的北京时间');config.publishAt=time;}
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
    prepare({...c,serviceHours:c.service,trainingHours:c.training,travelHours:c.travel,startTime:c.ordinary?undefined:c.startTime,endTime:c.ordinary?undefined:c.endTime});
  }
  async function createEvent(body,actor){const prepared=prepare(body);const blood=workflowConfig(prepared).blood;if(blood&&(await workflowRows(base,WF.events)).some(e=>workflowConfig(e).blood?.key===blood.key))throw fail(409,'该日期点位班次已存在，请编辑原班次或先从回收站恢复');await registrationWriter.encode({报名时段:prepared['报名时段'],岗位:prepared['岗位']});return append(WF.events,eventDraft(prepared,body,actor));}
  function eventDraft(prepared,body,actor){return {...prepared,活动ID:`WF-${randomUUID()}`,负责人账号ID:actor,申请版本:1,批准版本:'',状态:body.submit===false?'草稿':'待审核',创建时间:at()};}
  async function sources(managed=[]){const meta=await base.getMetadata();const tables=new Set(meta.tables.map(t=>t.name));const rows=await Promise.all(['活动报名总表','登记审批'].map(t=>tables.has(t)?workflowRows(base,t):[]));return sourceActivities(rows[0],rows[1],managed);}
  return {
    ...createRosterReview({read,write,update,WF,approved:workflowEventApproved}),
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
      if(body.enabled&&events.length!==Number(group['班次数']))throw fail(409,'项目班次不完整，禁止开放');
      await update(ORDINARY_GROUP_TABLE,group,{报名截止:deadline,报名开关:body.enabled?'开放':'关闭',状态:body.enabled||group['状态']==='已发布'?'已发布':'草稿',修改人:actor,更新时间:at()});return {groupId:config.groupId,deadline,enabled:body.enabled,count:events.length};
    }),
    read,
    members: async (id,month) => {
      const event=await eventBy(id),events=month?scopeEvents({events:await eventRows()},event,month):[event],allowed=new Set(events.map(e=>e['活动ID']));
      const registrations=(await workflowRows(base,WF.registrations)).filter(r=>allowed.has(r['活动ID']));
      const metadata=await base.getMetadata();
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
      const sets=await Promise.all(keys.map(key=>key==='events'?eventRows():workflowRows(base,WF[key])));
      return Object.fromEntries(keys.map((key,index)=>[key,sets[index]]));
    },
    publicRead: async () => {
      const [events, registrations] = await Promise.all([eventRows(), workflowRows(base, WF.registrations)]);
      return { events, registrations };
    },
    overview:async()=>{const data=await overview();return {...data,events:data.events.map(e=>({...e,rosterToken:rosterToken(e,data.registrations)}))};},
    positions:async id=>{
      const event=await eventBy(id);if(!bloodSourceTable||workflowConfig(event).source?.kind!=='generated_blood')return [];
      const rows=(await workflowRows(base,bloodSourceTable)).filter(r=>String(r['日期']||'').slice(0,10)===event['报名日期']&&r['点位']===event['地点']&&r['活动时间']===event['报名时段']);
      return Promise.all(rows.map(async(r,index)=>{
        let profile={...r,姓名:sourceText(r['姓名'])||sourceText(r['姓名2'])||sourceText(r['报名人']),学号:sourceText(r['学号'])||sourceText(r['学号2'])};const studentId=profile['学号'];
        if(base.query&&/^\d{6,20}$/.test(studentId)){const matches=await base.query(`SELECT * FROM \`个人主页（编辑版）\` WHERE \`学号\` = '${studentId}' LIMIT 3`);if(Array.isArray(matches)&&matches.length===1&&sourceText(matches[0]['学号'])===studentId&&sourceText(matches[0]['姓名'])===profile['姓名'])profile={...profile,...matches[0]};}
        return {position:index+1,status:['停点','已停点'].includes(r['报名结果'])?'停点':bloodSourceOccupied(r)?sourceText(r['报名结果'])||'已占用':'可报名',profile:Object.fromEntries(['姓名','学号','邮箱','手机号','院系','年级','校区','性别','所属部门','急救资质','总志愿时长'].map(key=>[key,sourceText(profile[key])]))};
      }));
    },
    sources,
    adopt: (sourceKey,body,actor,managed=[])=>write(async()=>{
      if(body.blood||body.source)throw fail(400,'不能覆盖来源关联');
      const source=one(await sources(managed),r=>r.key===sourceKey,'源活动');
      const existing=one(await workflowRows(base,WF.events),e=>workflowConfig(e).source?.key===sourceKey,'源活动映射',{optional:true});if(existing)return existing;
      return createEvent({...body,source:{key:source.key,table:source.table,id:source.sourceId,hash:source.sourceHash},submit:false},actor);
    }),
    edit: (id,body,actor)=>write(async()=>{const data=await read(),event=one(data.events,e=>e._id===id||e['活动ID']===id,'活动');
      if(['报名中','已结束','停点','已归档'].includes(event['状态'])||data.registrations.some(r=>r['活动ID']===event['活动ID']))throw fail(409,'已有参与记录或已发布的活动不能改写配置');
      if(body.blood||body.source)throw fail(400,'不能覆盖来源或排班关联');
      const old=workflowConfig(event),prepared=prepare({...body,source:old.source,ordinary:old.ordinary});
      if(old.blood&&JSON.parse(prepared['报名页配置']).blood?.key!==old.blood.key)throw fail(409,'班次日期点位不能修改，请新建班次');
      const preparedConfig=workflowConfig(prepared);if(old.noticeCustomized){prepared['通知草稿']=event['通知草稿'];preparedConfig.noticeCustomized=true;}preparedConfig.lastEditor=required(actor,'变更提交者');prepared['报名页配置']=JSON.stringify(preparedConfig);
      await update(WF.events,event,{...prepared,申请版本:Number(event['申请版本']||0)+1,批准版本:'',批准摘要:'',审批人:'',审批时间:'',状态:'草稿'});
    }),
    editNotice: (id,text,actor,{publishAt}={})=>write(async()=>{
      const event=await eventBy(id);if(!['草稿','待审核','可发布'].includes(event['状态']))throw fail(409,'仅未发布活动可以编辑通知');
      const content=str(text);if(!content||content.length>5000)throw fail(400,'通知不能为空或超过5000字');
      const config=workflowConfig(event);
      if(publishAt!==undefined){
        if(typeof publishAt!=='string')throw fail(400,'报名开始时间格式无效');
        // Validate the proposed schedule before writing either the text or the configuration.
        const checked=workflowConfig(prepare({...config,publishAt,serviceHours:config.service,trainingHours:config.training,travelHours:config.travel}));
        if(checked.publishAt)config.publishAt=checked.publishAt;else delete config.publishAt;
      }
      config.lastEditor=required(actor,'通知提交者');config.noticeCustomized=true;
      await update(WF.events,event,{通知草稿:content,报名页配置:JSON.stringify(config),申请版本:Number(event['申请版本']||0)+1,批准版本:'',批准摘要:'',审批人:'',审批时间:'',状态:'草稿'});
    }),
    submit: id=>write(async()=>{const event=await eventBy(id);if(!['草稿','待配置'].includes(event['状态'])||event['准备状态']!=='已准备'||!event['报名页配置'])throw fail(409,'请先补全活动配置并保存');assertPrepared(event);await update(WF.events,event,{状态:'待审核'});}),
    archive: id=>write(async()=>{const data=await read(),event=one(data.events,e=>e._id===id||e['活动ID']===id,'活动');if(data.registrations.some(r=>r['活动ID']===event['活动ID'])||data.ledger.some(r=>r['活动ID']===event['活动ID']))throw fail(409,'已有参与记录，不能删除；请结束活动并保留记录');if(event['状态']==='已归档')throw fail(409,'已在回收站');await update(WF.events,event,{归档前状态:event['状态'],状态:'已归档'});}),
    restore: id=>write(async()=>{const event=await eventBy(id);if(event['状态']!=='已归档')throw fail(409,'活动不在回收站');await update(WF.events,event,{状态:['可发布','报名中'].includes(event['归档前状态'])&&workflowEventApproved(event)?event['归档前状态']:'草稿'});}),
    close: id=>write(async()=>{const event=await eventBy(id);if(rosterReview(event)?.phase==='publishing')throw fail(409,'请先完成名单提交');if(!['报名中','停点'].includes(event['状态']))throw fail(409,'仅开放或停点活动可结束');await update(WF.events,event,{状态:'已结束'});}),
    prepareBloodWeek: (body,actor)=>write(async()=>{
      if(bloodSourceTable)throw fail(409,'献血车班次由 NJUTable 自动生成，无需手动排班');
      const drafts=bloodRosterDrafts(await workflowRows(base,'市血液献血车排班表（模板表）'),body);
      // Validate every amount before any durable write.
      number(body.capacity,'容量',{positive:true,integer:true});number(body.serviceHours,'服务时长',{positive:true});number(body.trainingHours??0,'培训时长');number(body.travelHours??0,'交通时长');
      const existing=await workflowRows(base,WF.events),result=[],missing=[];
      // Validate all configurations and conflicts before the first write.
      for(const draft of drafts){draft.submit=body.submit;draft.templateId='blood_vehicle';const prepared=prepare(draft);const found=one(existing,e=>workflowConfig(e).blood?.key===draft.blood.key,'排班',{optional:true});
        if(found){const c=workflowConfig(found);if(Number(c.capacity)!==Number(draft.capacity)||Number(c.service)!==Number(draft.serviceHours)||Number(c.training)!==Number(draft.trainingHours)||Number(c.travel)!==Number(draft.travelHours)||c.blood.week!==draft.blood.week)throw fail(409,'该周排班已有不同规则，请人工校对');result.push(found);}
        else{const row=eventDraft(prepared,draft,actor);missing.push(row);result.push(row);}}
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
      if(!registrationOpen(event,now())||!workflowEventApproved(event))throw fail(409,'活动尚未开放或已结束');
      const rows=ids.map(id=>one(data.registrations,r=>r._id===id&&r['活动ID']===event['活动ID'],'本活动报名'));
      if(rows.some(r=>r['报名状态']!=='待筛选'||r['请假状态']==='待审批'))throw fail(409,'名单状态已变化，请刷新后重新选择待确认的报名');
      const why=decision==='reject'?required(reason,'报名失败原因'):'';
      if(decision==='confirm'&&data.registrations.filter(r=>r['活动ID']===event['活动ID']&&['已确认','已签到'].includes(r['报名状态'])).length+rows.length>Number(workflowConfig(event).registrationLimit??event['容量']))throw fail(409,'批量确认人数超过报名上限，请减少选择');
      const completed=[];
      for(const row of rows){try{await update(WF.registrations,row,{报名状态:decision==='confirm'?'已确认':'未入选',是否报名成功:decision==='confirm'?'true':'false',处理说明:why});completed.push(row._id);}catch{throw fail(502,`已处理 ${completed.length} / ${rows.length} 人，请刷新名单后仅重试未处理记录`);}}
      return {completed};
    }),
    revokeConfirmation: (id,reason)=>write(async()=>{
      const data=await read(),row=one(data.registrations,r=>r._id===id,'报名'),event=one(data.events,e=>e['活动ID']===row['活动ID'],'活动');
      if(event['状态']!=='报名中'||!workflowEventApproved(event))throw fail(409,'活动已关闭或审批状态改变，不能撤销录取');
      if(row['报名状态']!=='已确认'||row['请假状态']==='待审批')throw fail(409,'仅未申请请假的报名成功人员可以撤销录取');
      if(row['签到照片ID']||row['签到行ID']||data.checkins.some(c=>c['报名行ID']===id)||data.ledger.some(l=>l['报名行ID']===id))throw fail(409,'已有签到或时长记录，不能撤销录取');
      await update(WF.registrations,row,{报名状态:'待筛选',是否报名成功:'false',处理说明:'录取已撤销：'+required(reason,'撤销原因')});
    }),
    reject: (id,reason)=>write(async()=>{const row=one(await workflowRows(base,WF.registrations),r=>r._id===id,'报名');if(rosterReview(await eventBy(row['活动ID'])))throw fail(409,'请从名单确认工作台调整结果');if(row['请假状态']==='待审批')throw fail(409,'请先处理请假申请');if(row['报名状态']!=='待筛选')throw fail(409,'仅待确认报名可以拒绝');await syncPosition(await eventBy(row['活动ID']),row,'可报名');await update(WF.registrations,row,{报名状态:'未入选',是否报名成功:'false',处理说明:required(reason,'未入选原因')});}),
    requestLeave: (code,account,reason)=>write(async()=>{const data=await read(),row=one(data.registrations,r=>r['报名ID']===code&&r['账号ID']===account.accountId,'本人报名');
      if(!['待筛选','已确认'].includes(row['报名状态'])||row['请假状态']==='待审批'||data.checkins.some(c=>c['报名行ID']===row._id)||data.ledger.some(l=>l['报名行ID']===row._id))throw fail(409,'当前报名不能申请请假');
      const event=one(data.events,e=>e['活动ID']===row['活动ID'],'活动');if(rosterReview(event)?.phase==='publishing')throw fail(409,'名单正在提交');if(event['状态']!=='报名中')throw fail(409,'活动已关闭，请联系负责人');const start=sessionWindow(event)?.start||`${event['报名日期']}T23:59:59+08:00`;if(now()>=Date.parse(start))throw fail(409,'活动已开始或日期已过，请联系负责人处理');
      await update(WF.registrations,row,{请假状态:'待审批',请假原因:required(reason,'请假原因'),请假申请时间:at()});
    }),
    decideLeave: (id,approved,reason)=>write(async()=>{const row=one(await workflowRows(base,WF.registrations),r=>r._id===id,'报名');if(rosterReview(await eventBy(row['活动ID']))?.phase==='publishing')throw fail(409,'名单正在提交');if(row['请假状态']!=='待审批'||!['待筛选','已确认'].includes(row['报名状态']))throw fail(409,'没有可处理的请假申请');if(approved)await syncPosition(await eventBy(row['活动ID']),row,'可报名');await update(WF.registrations,row,{请假状态:approved?'已批准':'已驳回',处理说明:required(reason,'处理说明'),...(approved?{报名状态:'已请假',是否报名成功:'false'}:{})});}),
    submitAttendance: (code,account,photoId)=>write(async()=>{const row=one(await workflowRows(base,WF.registrations),r=>r['报名ID']===code&&r['账号ID']===account.accountId,'本人报名');if(row['报名状态']!=='已确认'||row['请假状态']==='待审批')throw fail(409,'只有报名成功且未申请请假的记录可以签到');const event=await eventBy(row['活动ID']);if(rosterReview(event)?.phase==='publishing'||rosterReview(event)?.drafts?.[row._id])throw fail(409,'名单正在调整或提交');if(!workflowEventApproved(event)||event['状态']!=='报名中')throw fail(409,'活动未开放');const blood=workflowConfig(event).blood;
      const start=blood?.start||sessionWindow(event)?.start||`${event['报名日期']}T00:00:00+08:00`,end=blood?.end||sessionWindow(event)?.end||`${event['报名日期']}T23:59:59+08:00`;
      if(now()<Date.parse(start)||now()>Date.parse(end))throw fail(409,'尚未进入本次活动签到时段或时段已结束');
      if(!/^[a-f0-9-]{36}$/.test(photoId))throw fail(400,'签到照片无效');if(row['签到照片ID'])throw fail(409,'签到已提交，请等待核验');await update(WF.registrations,row,{签到照片ID:photoId,签到提交时间:at()});return {submitted:true};
    }),
    exportDraft: (id,month)=>exportHours(id,false,month),
    reviewDraft: (id,month)=>exportHours(id,true,month),
    attendanceBatch: (eventId,items,actor)=>writeHours(()=>batch(eventId,items,'registrations',async(item,data)=>{
      const registration=one(data.registrations,r=>r._id===item.id,'报名'),event=one(data.events,e=>e['活动ID']===registration['活动ID'],'活动');
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
      if(row['状态']!=='待批准')throw fail(409,'仅待审核明细可在复核页修改；已通过记录不可改');
      if((row['核对人']===actor||row['账号ID']===actor)&&role!=='super_admin')throw fail(403,'需由另一位管理员复核');
      if(item.expectedDigest!==(row['核对摘要']||reviewDigest(row)))throw fail(409,'明细已改变，请刷新后再修改');
      const source=await evidence(row['报名行ID'],data);assertReviewedLedger(row,source);
      const details=reviewDetails({...source.event,报名日期:source.registration['报名日期'],报名时段:source.registration['报名时段']},item.details);
      const patch={...details,来源摘要:`v3:${source.sourceHash}`,修订人:actor,修订时间:at()};
      patch['核对摘要']=reviewDigest({...row,...patch});
      await update(WF.ledger,row,patch);Object.assign(row,patch);return row;
    },month)),
    returnHours: (id,actor,role,reason,expectedDigest)=>writeHours(async()=>{
      const data=await read(),row=one(data.ledger,r=>r._id===id,'时长明细');
      if(row['状态']!=='待批准')throw fail(409,'仅待审核时长可以退回');
      if((row['核对人']===actor||row['账号ID']===actor)&&role!=='super_admin')throw fail(403,'不能退回自己核对的时长');
      if(expectedDigest!==(row['核对摘要']||reviewDigest(row)))throw fail(409,'明细已改变，请刷新后再审核');
      assertReviewedLedger(row,await evidence(row['报名行ID'],data));
      await update(WF.ledger,row,{状态:'已退回',退回原因:required(reason,'退回原因')});
    }),
    mode,
    create: (body,actor)=>write(()=>{if(body.ordinary)throw fail(400,'普通多班次活动请使用项目创建入口');if(bloodSourceTable&&body.templateId==='blood_vehicle')throw fail(409,'献血车班次由 NJUTable 自动生成');if(body.blood||body.source)throw fail(400,'献血车申请请使用排班模板入口');return createEvent(body,actor);}),
    stop: (id,reason)=>write(async()=>{const event=await eventBy(id);if(!workflowConfig(event).blood||event['状态']!=='报名中')throw fail(409,'只有已开放的献血车班次可以停点');await update(WF.events,event,{状态:'停点',停点说明:required(reason,'停点原因')});}),
    approve: (id,actor,role)=>write(async()=>{const row=await eventBy(id);if(row['状态']!=='待审核')throw fail(409,'只有待审核申请可以批准');assertPrepared(row);if((row['负责人账号ID']===actor||workflowConfig(row).lastEditor===actor)&&role!=='super_admin')throw fail(403,'负责人不能审批自己的申请');await update(WF.events,row,{批准版本:row['申请版本'],批准摘要:workflowApprovalHash(row),审批人:actor,审批时间:at(),状态:'可发布'});}),
    publish: id=>write(async()=>{const row=await eventBy(id);if(row['状态']!=='可发布'||!workflowEventApproved(row)||row['准备状态']!=='已准备')throw fail(409,'申请未获批或准备未完成');assertPrepared(row);await update(WF.events,row,{状态:'报名中'});}),
    register: (id,account)=>write(async()=>{const row=await eventBy(id);if(row.sourceSuperseded||!registrationOpen(row,now())||!workflowEventApproved(row))throw fail(409,'活动未开放报名');
      const accountId=required(account.accountId,'账号ID'),sid=required(account.studentId,'学号'),name=required(account.realName,'真实姓名'),email=required(account.email,'邮箱');if(!account.emailVerified||!/^\d+@(smail\.nju\.edu\.cn|nju\.edu\.cn)$/.test(email)||email.split('@')[0]!==sid)throw fail(403,'需已验证且学号一致的校园邮箱');
      const regs=await workflowRows(base,WF.registrations);const config=workflowConfig(row),blood=config.blood,activityIds=[row['活动ID'],...(config.sourceActivityIds||[])];
      if(config.ordinary&&!ordinaryRegistrationOpen(row,now()))throw fail(409,'本活动报名已截止或管理员已关闭报名');
      const existing=regs.find(r=>activityIds.includes(r['活动ID'])&&r['账号ID']===accountId&&r['学号']===sid);if(existing&&mode==='production'&&config.source?.kind==='generated_blood'&&existing['报名状态']==='待筛选'){await syncPosition(row,existing);return existing;}
      if(Number(config.sourceOccupied||0)+regs.filter(r=>activityIds.includes(r['活动ID'])&&['待筛选','已确认','已签到'].includes(r['报名状态'])).length>=Number(config.registrationLimit??row['容量']))throw fail(409,'本班次名额已满，请选择其他时段');
      if(blood||config.ordinary){const window=sessionWindow(row);if(now()>=Date.parse(window.start))throw fail(409,'此班次已开始，不能报名');
        const events=await eventRows();if(regs.some(r=>['待筛选','已确认','已签到'].includes(r['报名状态'])&&(r['账号ID']===accountId||r['学号']===sid)&&events.some(e=>{const b=sessionWindow(e);return e['活动ID']===r['活动ID']&&b&&Date.parse(b.start)<Date.parse(window.end)&&Date.parse(b.end)>Date.parse(window.start);})))throw fail(409,'已有重叠班次的报名，请先处理原报名');
      }if(regs.some(r=>activityIds.includes(r['活动ID'])&&(r['账号ID']===accountId||r['学号']===sid)&&(!config.ordinary||['待筛选','已确认','已签到'].includes(r['报名状态']))))throw fail(409,'已报名此活动');
      const registration=await append(WF.registrations,{...registrationDetails(row,account),活动名称:row['活动名称'],报名ID:`WR-${randomUUID()}`,活动ID:row['活动ID'],账号ID:accountId,学号:sid,姓名:name,邮箱:email,院系:str(account.department),报名日期:row['报名日期'],报名时段:row['报名时段'],岗位:row['岗位'],校区:str(account.campus),报名状态:config.ordinary?'已确认':'待筛选',是否报名成功:config.ordinary?'true':'false',志愿时长:'',录入状态:config.ordinary?.hoursPending?'时长规则待确定':'网站待核对',岗位同步状态:config.source?.kind==='generated_blood'&&mode==='production'?'待同步':'',创建时间:at()});
      await syncPosition(row,registration);await syncLinks(registration);return registration;
    }),
    confirm: id=>write(async()=>{const data=await read();const row=one(data.registrations,r=>r._id===id,'报名');const event=one(data.events,r=>r['活动ID']===row['活动ID'],'活动');if(rosterReview(event))throw fail(409,'请从名单确认工作台调整结果');if(row['请假状态']==='待审批')throw fail(409,'请先处理请假申请');if(row['报名状态']==='已确认'&&event['状态']==='报名中'&&workflowEventApproved(event))return row;if(row['报名状态']!=='待筛选')throw fail(409,'报名不在待筛选状态');if(event['状态']!=='报名中'||!workflowEventApproved(event))throw fail(409,'活动审批或报名状态已改变');if(data.registrations.filter(r=>[row['活动ID'],...(workflowConfig(event).sourceActivityIds||[])].includes(r['活动ID'])&&['已确认','已签到'].includes(r['报名状态'])).length+Number(workflowConfig(event).sourceOccupied||0)>=number(workflowConfig(event).registrationLimit??event['容量'],'容量',{positive:true}))throw fail(409,'活动容量已满');await syncPosition(event,row,'成功');await update(WF.registrations,row,{报名状态:'已确认',是否报名成功:'true',处理说明:''});}),
    checkin: (id,actor,note)=>write(()=>checkinRow(id,actor,note)),
    checkinAndReview: (id,actor,body={})=>writeHours(async()=>{
      for(const [key,label] of [['serviceHours','服务时长'],['trainingHours','培训时长'],['travelHours','交通时长']])if(body[key]!==undefined)number(body[key],label,{positive:key==='serviceHours'});
      const data=await read(),registration=one(data.registrations,r=>r._id===id,'报名'),event=one(data.events,e=>e['活动ID']===registration['活动ID'],'活动');
      const input=Object.fromEntries(['serviceHours','trainingHours','travelHours'].filter(key=>body[key]!==undefined).map(key=>[key,body[key]]));
      const details=reviewDetails(event,input),existing=one(data.ledger,r=>r['幂等键']===`SERVICE:${registration._id}`,'时长明细',{optional:true});
      if(existing){assertReviewedLedger(existing,await evidence(id,data));if(Object.keys(input).length&&['服务时长','培训时长','交通时长'].some(key=>Number(existing[key])!==Number(details[key])))throw fail(409,'已有时长草稿与本次数值不同，请核对原记录');return existing;}
      await checkinRow(id,actor,body.note,data);return recordHours(id,actor,input,data);
    }),
    reviewHours: (id,actor,input={})=>writeHours(()=>recordHours(id,actor,input)),
    approveHours: (id,actor,role,expectedDigest)=>writeHours(()=>approveEntry(id,actor,role,expectedDigest)),
    post: id=>writeHours(async()=>{const row=one(await workflowRows(base,WF.ledger),r=>r._id===id,'时长明细');if(!['已批准','已入账'].includes(row['状态']))throw fail(409,'时长尚未批准');const source=await evidence(row['报名行ID']);assertReviewedLedger(row,source);return mirror(row['账号ID']);}),
  };
}
