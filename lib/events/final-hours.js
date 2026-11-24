import {createHash} from 'node:crypto';
import {projectEvents} from '../../public/app/shared/activity-projects.js';
import {positionOptionLabel,normalizeTimeRange} from '../../public/app/shared/activity-running.js';
import {finalTrainingHours} from '../../public/app/shared/activity-final-hours.js';
import {recomputeSourceDigest,runningLedgerEntries,finalLedgerEntries,finalLedgerKey,isFinalLedgerRow,supplementRowsOf} from './running-review.js';
import {workflowConfig} from './blood-roster.js';
import {finalHoursWorkbook} from './final-hours-workbook.js';
import {finalHoursDates} from './final-hours-dates.js';
import {isManualHoursRegistration,manualHoursInput,manualHoursRequestId} from './manual-hours.js';
import {readHoursConfig,encodeHoursConfig} from './hours-config-state.js';
const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode,code:'final_hours_conflict'});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const editKeys=['serviceHours','trainingHours','travelHours','location','dates','work','remark','decision','reason','evidenceChecked'];
const safeName=name=>`${String(name||'志愿活动').replace(/[\r\n\\/:*?"<>|]/g,'_').slice(0,90)}-分工时长表.xlsx`;
// 补录行必须有主席团确认才计入导出：pending（待确认）与 revoked（已撤回）都不进表。
const supplementApprovalOf=row=>row.manual?(row.manualApproval||'approved'):'approved';
const eligibleRows=rows=>rows.filter(row=>row.decision==='pass'&&row.serviceHours+row.trainingHours+row.travelHours>0&&supplementApprovalOf(row)==='approved');
/** 归档文件不再以 base64 塞进「报名页配置」——xlsx 的 base64 会让配置逼近
 * NJUTable 文本上限，一旦被截断整行配置永久不可读。行数据本身已足够重建
 * 同一份工作簿，下载与发信时现场生成即可。 */
const archivedBuffer=rows=>finalHoursWorkbook(eligibleRows(rows));
const toNumber=value=>Number.isFinite(Number(value))?Number(value):0;
const META_VERSION=2;
/**
 * 终审按账号（学号）合并同一活动里的多条参与记录。
 *
 * 献血周这类项目一人会报多个场次，逐场次列出来就是同一个人反复出现；录入方（网站
 * 志愿时长表）按人登记，重复行会被当成多次服务。合并口径：
 * - 时长：各场次相加（同一场次重复报名只算一次）；
 * - 工作地点／日期／内容／备注：去重后换行拼接；
 * - 结论：任一不通过即不通过，全部通过才算通过；
 * - 身份：以学号为准（导出表也按学号登记），缺学号时才用账号ID，再缺就各自成行。
 * 存储仍是每个报名行一条台账，合并只发生在展示、导出与归档下载。
 */
const MERGE_TEXT_KEYS=['location','dates','work','remark'];
const accountKeyOf=row=>{
 const student=String(row.studentId||'').trim();if(student)return `S:${student}`;
 const account=String(row.accountId||'').trim();if(account)return `A:${account}`;
 return `R:${row.id}`;
};
const joinUnique=(values,separator='\n')=>[...new Set(values.map(value=>String(value??'').trim()).filter(Boolean))].join(separator);
/**
 * 合并文本列前先拆行、再规范化。
 *
 * 「正式工作日期」有三条写入路径：初审只写日期、终审写成「日期 HH:MM—HH:MM」、
 * 补录直接抄岗位行的「日期 HH:MM:SS-HH:MM:SS」。三者指向同一场服务，
 * 不规范化就会被当成三个不同日期并排显示。拆行是为了让历史合并值也能被归并。
 */
const mergeTextValues=(rows,key)=>joinUnique(rows
 .flatMap(row=>String(row[key]??'').split(/\n|；/))
 .map(value=>key==='dates'?normalizeTimeRange(value):value));
/** 合并键与同场次去重都依赖报名行身份，台账行本身不存这些字段，读取时从报名补齐。 */
const slotOf=registration=>({accountId:registration?.['账号ID']||'',eventId:registration?.['活动ID']||'',regDate:registration?.['报名日期']||'',slot:registration?.['报名时段']||''});
/** 同一场次重复报名只计一次；场次信息不全的行不参与去重，避免误删。 */
function distinctSlots(rows){
 const seen=new Set(),kept=[];
 for(const row of rows){
  const slot=row.eventId?`${row.eventId}|${row.regDate||''}|${row.slot||''}`:'';
  if(slot&&seen.has(slot))continue;
  if(slot)seen.add(slot);
  kept.push(row);
 }
 return kept;
}
export function groupFinalHoursRows(rows){
 const groups=new Map();
 for(const row of rows){const key=accountKeyOf(row);const list=groups.get(key);if(list)list.push(row);else groups.set(key,[row]);}
 return [...groups.values()].map(members=>{
  // 单人组也要规范化：补录行直接抄了岗位行的 `14:00:00-16:00:00`，
  // 不归一就会和同场的普通报名行显示成两个不同日期。
  if(members.length===1)return {members,merged:{...members[0],dates:normalizeTimeRange(members[0].dates)}};
  const unique=distinctSlots(members),ordered=[...unique].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const sum=key=>ordered.reduce((total,row)=>total+toNumber(row[key]),0);
  const decisions=ordered.map(row=>row.decision);
  const decision=decisions.includes('fail')?'fail':decisions.every(value=>value==='pass')?'pass':'';
  // 合并行必须继承补录语义：只取 ordered[0] 的话，普通行排在前就会把「待确认」洗掉。
  const manualMembers=ordered.filter(row=>row.manual);
  return {members,merged:{...ordered[0],accountId:ordered[0].accountId,eventId:ordered[0].eventId,
   serviceHours:sum('serviceHours'),trainingHours:sum('trainingHours'),travelHours:sum('travelHours'),
   ...Object.fromEntries(MERGE_TEXT_KEYS.map(key=>[key,mergeTextValues(ordered,key)])),
   position:joinUnique(ordered.flatMap(row=>String(row.position??'').split(/[、\n]/)),'、'),
   decision,reason:decision==='fail'?joinUnique(ordered.map(row=>row.reason),'；'):'',
   evidenceChecked:ordered.every(row=>row.evidenceChecked===true),memberIds:ordered.map(row=>row.id),merged:true,
   ...(manualMembers.length?{manual:true,requestId:manualMembers[0].requestId,fingerprint:manualMembers[0].fingerprint,addedBy:manualMembers[0].addedBy,
    manualApproval:manualMembers.some(row=>(row.manualApproval||'approved')==='pending')?'pending':manualMembers.some(row=>row.manualApproval==='revoked')?'revoked':'approved'}:{})}};
 });
}
export const mergeFinalHoursRows=rows=>groupFinalHoursRows(rows).map(group=>group.merged);
/**
 * 把合并视图落回台账：只写被改动过的字段，未改动的成员行保留原始明细与证据。
 * 同一场的重复报名行始终清零，否则入账按行累加时会重复计时。
 */
export function storedFinalHoursRows(mergedRows,groups){
 const byId=new Map(groups.map(group=>[group.merged.id,group]));
 const stored=[];
 for(const row of mergedRows){
  const group=byId.get(row.id);
  if(!group||group.members.length<2){const member=group?.members[0]||row;stored.push({...member,...Object.fromEntries(editKeys.map(key=>[key,row[key]]))});continue;}
  const natural=group.merged,counted=new Set(natural.memberIds||[]);
  const hoursChanged=['serviceHours','trainingHours','travelHours'].some(key=>toNumber(row[key])!==toNumber(natural[key]));
  const textChanged=key=>String(row[key]??'')!==String(natural[key]??'');
  // 结论只在管理员真的改过合并结论时统一写回；否则保留各场次的原始判定。
  const conclusionChanged=row.decision!==natural.decision||String(row.reason??'')!==String(natural.reason??'');
  const evidenceChanged=(row.evidenceChecked===true)!==(natural.evidenceChecked===true);
  const [primary]=group.members.filter(member=>counted.has(member.id)).sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  for(const member of group.members){
   const patch={};
   if(conclusionChanged)Object.assign(patch,{decision:row.decision,reason:row.reason});
   if(evidenceChanged)patch.evidenceChecked=row.evidenceChecked===true;
   const duplicate=!counted.has(member.id);
   if(duplicate)Object.assign(patch,{serviceHours:0,trainingHours:0,travelHours:0});
   else if(hoursChanged)Object.assign(patch,member===primary?{serviceHours:row.serviceHours,trainingHours:row.trainingHours,travelHours:row.travelHours}:{serviceHours:0,trainingHours:0,travelHours:0});
   for(const key of MERGE_TEXT_KEYS)if(textChanged(key))patch[key]=row[key];
   stored.push({...member,...patch});
  }
 }
 return stored;
}
const encodeMeta=row=>JSON.stringify({v:META_VERSION,d:row.decision||'',e:row.evidenceChecked===true,f:row.firstDecision||'',r:row.remark||'',
 ...(row.manual?{m:{requestId:row.requestId,fingerprint:row.fingerprint,addedBy:row.addedBy,
  ...(row.manualApproval?{approval:row.manualApproval}:{}),
  ...(row.approvedBy?{approvedBy:row.approvedBy}:{}),...(row.approvedAt?{approvedAt:row.approvedAt}:{}),
  ...(row.selfReview?{self:true}:{})}}:{})});
/**
 * 终审明细存「网站服务时长明细表」的 `FINAL:` 行，一人一行。
 *
 * 原先整份 rows 塞进活动的「报名页配置」，而该文本列上限 10000 字符：一条终审行约
 * 324 字符，三十余行就会撞顶。献血周 16 场次、三百余人时初审刚通过就会在终审环节失败。
 * 改为行存储后容量与人数无关，导出的 xlsx 仍按行现场重建。
 */
export function createFinalHours({stateStore,read,write,update,append,appendRows,updateRows,WF,approved,authorizeRead,authorizeReview,authorizeSupplement,recipient,addParticipant,manualEvidence=()=>false,manualRequest=()=>null,syncManualRows=async()=>{},now=()=>Date.now()}){
 function finalState(id,state){
  if(!state?.stateRef)return state;
  const stored=stateStore?.finalHoursState?.(id,state.stateRef);
  if(!stored||stored.status!==state.status)throw fail(503,'最终时长归档状态暂不可用，请恢复活动私有状态备份后核对');
  return stored;
 }
 const configuration=ctx=>encodeHoursConfig(ctx.event,ctx.c,stateStore);
 async function context(id,actor,editing=false,authorityEvents){
  const data=await read(id,authorityEvents),event=data.events.find(row=>row._id===id),c=event?readHoursConfig(event,stateStore):{};
  if(!event||!c.workspaceSubmission||c.parentActivityId||c.runningReview?.status!=='submitted')throw fail(409,'活动尚未提交时长审核');
  await authorizeRead(event,actor);let canEdit=false;try{await authorizeReview(event,actor);canEdit=true;}catch(error){if(editing)throw error;}
  if(editing&&c.finalHours?.status==='exported')throw fail(409,'最终表已导出，不能继续修改');
  const events=projectEvents(data.events,event),jobs=events.filter(row=>workflowConfig(row).bookingMode!=='grouped'),ids=new Set(jobs.map(row=>row['活动ID']));
  const supplemental=data.registrations.filter(row=>isManualHoursRegistration(row)),supplementalIds=new Set(supplemental.map(row=>row._id));
  const registrations=data.registrations.filter(row=>!supplementalIds.has(row._id)&&ids.has(row['活动ID'])&&['已确认','已签到'].includes(row['报名状态'])&&row['请假状态']!=='已批准');
  const positions=jobs.map(row=>({id:row._id,name:positionOptionLabel(row),event:row}));
  // 终审明细：台账行优先，历史项目回退到配置里冻结的 rows。
  const finalRows=new Map(finalLedgerEntries(data,ids).map(row=>[row.id,row]));
  const legacyRows=Array.isArray(c.finalHours?.rows)?c.finalHours.rows:[];
  const previousOf=registrationId=>finalRows.get(registrationId)||legacyRows.find(row=>row.id===registrationId)||null;
  const build=rows=>{
   const groups=groupFinalHoursRows(rows),merged=groups.map(group=>group.merged);
   // The table service may return the same rows in a different order on GET and
   // POST. Bind versions to identities and values, never transport ordering.
   const ordered=[...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
   const statuses=[...finalRows.values()].map(row=>[row.id,row.status]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
   const token=hash([c.runningReview.previewToken,c.runningReview.sourceDigest,ordered,c.finalHours?.updatedAt||'',statuses]);
   return {data,event,c,events,registrations,rows:merged,storedRows:rows,token,canEdit,positions,groups,
    pendingManual:supplemental.filter(row=>ids.has(row['活动ID'])&&row['报名状态']!=='已撤回'&&!rows.some(item=>item.id===row._id))};
  };
  // 已撤回的补录彻底退出视图：报名行标记「已撤回」，台账行保留作审计但不参与任何合计。
  const manualRow=line=>{
   const registration=supplemental.find(item=>item._id===line.id),checkin=data.checkins.find(item=>item._id===registration?.['签到行ID']);
   if(!registration||registration['报名状态']==='已撤回'||line.manualApproval==='revoked')return null;
   if(!ids.has(registration['活动ID'])||String(registration['学号']||'')!==String(line.studentId||'')||registration['报名状态']!=='已签到'||registration['是否报名成功']!=='true'||!manualEvidence(registration,checkin))throw fail(409,'补录人员或核验依据已改变，请先核对');
   return {...line,name:registration['姓名'],studentId:registration['学号'],department:registration['院系']||'',position:line.position||positions.find(item=>item.event['活动ID']===registration['活动ID'])?.event['岗位']||'',
    accountId:registration['账号ID']||'',eventId:registration['活动ID']||'',regDate:registration['报名日期']||'',slot:registration['报名时段']||'',manualApproval:line.manualApproval||'approved'};
  };
  if(c.finalHours?.status==='exported'){
   // 导出后行数据以台账为准；历史项目仍只有配置内冻结的 rows，读取时回退兼容。
   const frozen=[];
   for(const reg of registrations){
    const line=finalRows.get(reg._id)||legacyRows.find(row=>row.id===reg._id);
    if(!line)throw fail(409,'最终时长行缺失，请核对台账');
    frozen.push({...line,...slotOf(reg),name:line.name||reg['姓名'],studentId:line.studentId||reg['学号'],department:line.department||reg['院系']||'',position:line.position||positions.find(item=>item.event['活动ID']===reg['活动ID'])?.event['岗位']||''});
   }
   for(const line of [...finalRows.values(),...legacyRows]){
    if(registrations.some(item=>item._id===line.id)||frozen.some(item=>item.id===line.id))continue;
    const registration=supplemental.find(item=>item._id===line.id);
    if(!registration||registration['报名状态']==='已撤回'||line.manualApproval==='revoked')continue;
    frozen.push({...line,...slotOf(registration),name:line.name||registration['姓名'],studentId:line.studentId||registration['学号'],department:line.department||registration['院系']||'',position:line.position||''});
   }
   return {...build(frozen),status:'exported'};
  }
  const misaligned=events.filter(row=>row['状态']!=='进行中'||!approved(row));
  if(misaligned.length){
   const detail=misaligned.map(row=>`${row['岗位']||row['活动名称']}（${row['状态']}${approved(row)?'':'·未批准'}）`).join('、');
   throw fail(409,`项目内班次状态不一致：${detail}；请在活动管理里打开该班次，用「活动信息修改」保存并完成审批（状态需为「进行中」）后重试`);
  }
  // Final-review supplements are separate from the frozen director review; never rewrite its evidence digest.
  // 存量摘要可能是 v1（整行入摘要），必须按它自己的口径重算：换算法会让所有在途项目在终审 409。
  // 入参一律取「提交时」的口径（补录不过滤）：是否排除补录由算法版本决定，否则存量 v1
  // 项目的冻结值含补录、重算却少一条，终审永远进不去。
  const digestRegistrations=data.registrations.filter(row=>ids.has(row['活动ID'])&&['已确认','已签到'].includes(row['报名状态'])&&row['请假状态']!=='已批准');
  if(c.runningReview.sourceDigest!==recomputeSourceDigest(c.runningReview.sourceDigest,events,digestRegistrations,data.checkins,data.ledger))throw fail(409,'参与或签到依据已改变，请核对初审来源后再审核');
  // 初审明细已从「报名页配置」搬到台账独立行：一人一行，不再受单字段 10000 字符限制。
  // 历史项目仍可能只有配置内的 entries，读取时按「台账优先、配置回退」兼容。
  const ledgerFirst=runningLedgerEntries(data,ids).filter(row=>!supplementalIds.has(row.id)),legacy=Array.isArray(c.runningReview.entries)?c.runningReview.entries:[];
  const first=ledgerFirst.length?ledgerFirst:legacy;
  if(!Array.isArray(first)||first.length!==registrations.length||new Set(first.map(row=>row.id)).size!==first.length)throw fail(409,'时长初审名单不完整');
  const rows=rootRows(),shown=new Set(rows.map(row=>row.id));
  for(const row of legacyRows.filter(row=>row.manual)){
   if(shown.has(row.id))continue;
   rows.push(row);shown.add(row.id);
  }
  return {...build(rows),status:'review'};
  function rootRows(){
   const base=registrations.map(reg=>{
    const original=first.find(row=>row.id===reg._id),job=jobs.find(row=>row['活动ID']===reg['活动ID']),previous=previousOf(reg._id);
    if(!original)throw fail(409,'时长初审名单已改变');
    const row={id:reg._id,...slotOf(reg),name:reg['姓名'],studentId:reg['学号'],department:reg['院系']||'',location:job['地点']||'',dates:finalHoursDates(job,reg),work:job['工作内容']||'',remark:'',serviceHours:original.serviceHours,trainingHours:finalTrainingHours(original.trainingHours),travelHours:original.travelHours,decision:original.decision,reason:original.reason,evidenceChecked:original.evidenceChecked,firstDecision:original.decision,position:job['岗位']||job['活动名称']};
    if(previous)for(const key of editKeys)row[key]=previous[key];
    return row;
   });
   for(const line of finalRows.values()){
    if(registrations.some(item=>item._id===line.id))continue;
    const mapped=manualRow(line);
    if(mapped)base.push(mapped);
   }
   return base;
  }
 }
 function changedRows(ctx,items){
  if(!Array.isArray(items)||!items.length||items.length>5000||new Set(items.map(item=>item?.id)).size!==items.length)throw fail(400,'请选择有效的时长行');
  const rows=structuredClone(ctx.rows);
  for(const item of items){const row=rows.find(row=>row.id===item?.id);if(!row||Object.keys(item).some(key=>!['id',...editKeys].includes(key)))throw fail(400,'不能修改身份或其他活动的时长');
   for(const key of editKeys)if(Object.hasOwn(item,key))row[key]=item[key];
   for(const key of ['serviceHours','trainingHours','travelHours']){if(!['string','number'].includes(typeof row[key])||String(row[key]).trim()===''||!Number.isFinite(Number(row[key]))||Number(row[key])<0||Number(row[key])>100000)throw fail(400,'时长必须为有效非负数字');row[key]=Number(row[key]);}
   if(!Number.isInteger(row.trainingHours))throw fail(400,'培训时长须按模板填写整数');
   // 合并行的地点／日期／内容是多场次拼接而来，上限要容得下整个项目，不能按单场次卡 1000 字。
   for(const key of ['location','dates','work','remark','reason']){if(typeof row[key]!=='string'||row[key].length>4000)throw fail(400,'工作明细不能为空或过长');row[key]=row[key].trim();}
   if(!['pass','fail'].includes(row.decision)||row.decision==='fail'&&!row.reason)throw fail(400,'未通过须填写原因');
   if(row.decision==='pass'&&(!row.location||!row.dates||!row.work))throw fail(400,'请补齐实际工作地点、日期与工作内容');
  }
  return rows;
 }
 const ledgerPatch=(ctx,row,actor,status)=>{
  const registration=ctx.data.registrations.find(item=>item._id===row.id),job=ctx.data.events.find(item=>item['活动ID']===registration?.['活动ID']);
  return {幂等键:finalLedgerKey(row.id),报名行ID:row.id,签到行ID:registration?.['签到行ID']||'',活动ID:registration?.['活动ID']||'',
   账号ID:registration?.['账号ID']||'',学号:registration?.['学号']||'',姓名:registration?.['姓名']||'',规则版本:String(ctx.event['申请版本']||''),
   服务时长:row.serviceHours,培训时长:row.trainingHours,交通时长:row.travelHours,状态:status,
   核对人:actor,批准人:status==='已批准'?actor:'',批准时间:status==='已批准'?new Date(now()).toISOString():'',入账时间:'',
   退回原因:row.decision==='fail'?row.reason:'',工作内容:row.work||job?.['工作内容']||'',具体工作地点:row.location||'',正式工作日期:row.dates||'',
   备注:encodeMeta(row),来源摘要:hash([registration,ctx.data.checkins.filter(check=>check['报名行ID']===row.id)]),修订人:actor,修订时间:new Date(now()).toISOString()};
 };
 async function persistRows(ctx,rows,actor,status){
  const existing=new Map((ctx.data.ledger||[]).filter(isFinalLedgerRow).map(line=>[line['报名行ID'],line]));
  const patches=[],appends=[];
  for(const row of rows){
   const line=existing.get(row.id);
   if(line)patches.push({row:line,patch:ledgerPatch(ctx,row,actor,status)});
   else appends.push(ledgerPatch(ctx,row,actor,status));
  }
  if(patches.length){const byRow=new Map(patches.map(item=>[item.row,item.patch]));await updateRows(WF.ledger,patches.map(item=>item.row),row=>byRow.get(row));}
  if(appends.length)await appendRows(WF.ledger,appends);
 }
 /**
 * 补录的独立上下文：初审草稿阶段也必须能用。
 *
 * 不能复用 `context()`：它要求初审已提交，且要求初审明细条数与参与人数严格相等。
 * 草稿阶段这两个条件都不成立，负责人会被永久挡在门外——而「填初审时发现漏了人」
 * 恰恰是最需要补录的时刻。
 */
async function supplementContext(id,actor,mode){
 if(!authorizeSupplement)throw fail(503,'人员补录权限服务尚未就绪');
 const data=await read(id),event=data.events.find(row=>row._id===id);
 if(!event)throw fail(404,'活动不存在');
 const c=readHoursConfig(event,stateStore);
 if(!c.workspaceSubmission||c.parentActivityId)throw fail(409,'请从新版项目活动进入时长审核');
 if(c.finalHours?.status==='exported')throw fail(409,'最终表已导出，不能补录人员');
 const events=projectEvents(data.events,event),jobs=events.filter(row=>workflowConfig(row).bookingMode!=='grouped');
 if(!jobs.length)throw fail(409,'项目内没有可审核的岗位');
 // 与初审同口径：所有班次都要「进行中」且已批准，否则补录会落进一个还没开始的班次。
 const misaligned=events.filter(row=>row['状态']!=='进行中'||!approved(row));
 if(misaligned.length){
  const detail=misaligned.map(row=>`${row['岗位']||row['活动名称']}（${row['状态']}${approved(row)?'':'·未批准'}）`).join('、');
  throw fail(409,`项目内班次状态不一致：${detail}；请在活动管理里打开该班次，用「活动信息修改」保存并完成审批（状态需为「进行中」）后重试`);
 }
 if(mode==='recorder'){
  // 与初审一致：项目内任一班次认这个账号即可，不要求每个场次的负责人名单都含他。
  let allowed=false,denied=null;
  for(const target of events){try{await authorizeSupplement(target,actor);allowed=true;break;}catch(error){denied=denied||error;}}
  if(!allowed)throw denied||fail(403,'仅本项目负责人可以进行人员补录');
 }
 if(mode==='reviewer')await authorizeReview(event,actor);
 const ids=new Set(jobs.map(row=>row['活动ID']));
 const supplemental=data.registrations.filter(row=>isManualHoursRegistration(row)&&ids.has(row['活动ID']));
 const finalRows=new Map(finalLedgerEntries(data,ids).map(row=>[row.id,row]));
 return {data,event,c,events,jobs,ids,supplemental,finalRows};
}
// 进行中页与终审页共用同一份补录视图，字段不会再分叉。
const supplementRows=(ctx,actor)=>supplementRowsOf(ctx.finalRows,ctx.data.registrations,ctx.jobs,actor);
/**
 * 按合并行 id 定位真正的补录台账行。
 *
 * 终审表按学号把同一人的多条参与记录合并成一行，行上只保留组内排序第一的 id；
 * 「确认补录」「撤回补录」从前端拿到的是这个合并 id，它未必是补录那一条。
 * 只按 id 精确查就会报「补录记录不存在」——生产已发生（同一人既有普通报名又有补录）。
 */
function supplementLineOf(ctx,rowId){
 const direct=ctx.finalRows.get(rowId);
 if(direct?.manual)return direct;
 // 合并行可能由「只有初审、还没落 FINAL 行」的成员打头，这时连学号都要从报名行取。
 const registration=ctx.data.registrations.find(row=>row._id===rowId);
 const studentId=String(direct?.studentId||registration?.['学号']||'').trim();
 const accountId=String(direct?.accountId||registration?.['账号ID']||'').trim();
 const key=studentId?`S:${studentId}`:accountId?`A:${accountId}`:'';
 if(!key)return null;
 const candidates=[...ctx.finalRows.values()].filter(row=>row.manual&&accountKeyOf(row)===key);
 return candidates.find(row=>(row.manualApproval||'approved')==='pending')
  ||candidates.find(row=>(row.manualApproval||'approved')!=='revoked')||null;
}
const view=ctx=>({name:ctx.event['活动名称'],token:ctx.token,status:ctx.status,canEdit:ctx.canEdit,rows:ctx.rows,positions:ctx.positions||[],pendingManual:ctx.pendingManual?.length||0,pendingRequests:ctx.canEdit?ctx.pendingManual?.map(row=>manualRequest(manualHoursRequestId(row))).filter(Boolean)||[]:[],mailStatus:ctx.c.finalHours?.mail?.status||'',exportedAt:ctx.c.finalHours?.exportedAt||''});
 const service={
  finalHours:async(id,actor,authorityEvents)=>view(await context(id,actor,false,authorityEvents)),
  saveFinalHours:(id,body,actor)=>write(async()=>{
   const ctx=await context(id,actor,true);if(ctx.status==='exported')throw fail(409,'最终表已导出，不能继续修改');
   if(body.token!==ctx.token)throw fail(409,'时长表已更新，请重新打开');
   const rows=changedRows(ctx,body.items);
   // 只落本次提交涉及的行：整份 rows 一起写会让每次保存都产生数百次远程写入。
   const touched=body.items.map(item=>rows.find(row=>row.id===item.id));
   // 合并行落回台账：改过的字段写回成员行，未改动的保留原始明细；同一场的重复报名清零。
   const stored=storedFinalHoursRows(Array.isArray(ctx.c.finalHours?.rows)?rows:touched,ctx.groups);
   // 旧配置首次迁移须连同未修改的明细保存，否则清理配置会丢失其历史终审值。
   ctx.c.finalHours={status:'review',entryCount:rows.length,updatedBy:actor,updatedAt:new Date(now()).toISOString()};
   const encoded=configuration(ctx);
   await persistRows(ctx,stored,actor,'待批准');
   await update(WF.events,ctx.event,{报名页配置:encoded});return {saved:true};
  }),
  addFinalHoursParticipant:(id,body,actor,participant)=>write(async()=>{
   const input=manualHoursInput(body),ctx=await context(id,actor,true);
   const job=ctx.positions.find(row=>row.id===input.eventId)?.event;if(!job)throw fail(400,'请选择本活动的实际岗位');
   if(ctx.storedRows.some(row=>row.manual&&row.requestId===input.requestId)){
    const saved=ctx.storedRows.find(row=>row.requestId===input.requestId);if(saved.fingerprint!==input.fingerprint||saved.addedBy!==actor)throw fail(409,'补录内容已改变，请重新打开窗口');return {id:saved.id};
   }
   if(body.token!==ctx.token&&!ctx.pendingManual.some(row=>String(row['报名ID']).startsWith(`WMH-${input.requestId}-`)))throw Object.assign(fail(409,'时长表已更新，请刷新后重新补录'),{code:'manual_hours_version_conflict'});
   if(!addParticipant)throw fail(503,'人员补录尚未就绪');
   if(input.accountId&&participant?.accountId&&input.accountId!==participant.accountId)throw fail(409,'所选人员与平台账号不一致，请重新选择');
   if(ctx.storedRows.length>=5000)throw fail(400,'最终时长表明细过多，请联系管理员');
   const details=input.details||{},candidate={id:'new',name:input.name,studentId:input.studentId,department:input.department,location:details.location,dates:details.dates,work:details.work,remark:details.remark||'',serviceHours:details.serviceHours,trainingHours:details.trainingHours,travelHours:details.travelHours,decision:'pass',reason:'',evidenceChecked:true};
   const normalized=changedRows({...ctx,rows:[candidate]},[{id:'new'}])[0];
   // 先校验配置预算；校验失败时不创建半份人员补录。
   configuration({...ctx,c:{...ctx.c,finalHours:{status:'review',entryCount:ctx.storedRows.length+1,updatedBy:actor,updatedAt:new Date(now()).toISOString()}}});
   const {registration}=await addParticipant(ctx.data,job,input,actor,participant);
   const row={...normalized,id:registration._id,position:job['岗位']||job['活动名称'],firstDecision:'manual',manual:true,requestId:input.requestId,fingerprint:input.fingerprint,addedBy:actor,...slotOf(registration)};
   const stored=Array.isArray(ctx.c.finalHours?.rows)?[...ctx.storedRows,row]:[row];
   ctx.c.finalHours={status:'review',entryCount:groupFinalHoursRows([...ctx.storedRows,row]).length,updatedBy:actor,updatedAt:new Date(now()).toISOString()};
   const encoded=configuration(ctx);
   await persistRows(ctx,stored,actor,'待批准');
   await update(WF.events,ctx.event,{报名页配置:encoded});return {id:row.id};
  }),
  // ——— 人员补录：负责人（本活动）发起，主席团确认后才计入导出 ———
  hoursSupplementList:async(id,actor)=>{
   const ctx=await supplementContext(id,actor,'recorder');
   return {canSupplement:true,items:supplementRows(ctx,actor)};
  },
  // 选人只要求「能补录这个活动」：初审页是负责人，终审页是主席团，两种身份都要能检索。
  hoursSupplementDirectory:async(id,actor)=>{
   let denied=null;
   for(const mode of ['recorder','reviewer']){
    try{await supplementContext(id,actor,mode);return {ok:true};}catch(error){denied=denied||error;}
   }
   throw denied||fail(403,'仅本项目负责人或主席团可以检索补录人员');
  },
  addSupplement:(id,body,actor,participant)=>write(async()=>{
   const input=manualHoursInput(body),ctx=await supplementContext(id,actor,'recorder');
   const job=ctx.jobs.find(row=>row._id===input.eventId);if(!job)throw fail(400,'请选择本活动的实际岗位');
   // 只接受已注册平台账号：没有账号就没有可追溯的入账对象，不再写 `manual:学号`。
   if(!participant?.accountId)throw fail(400,'该学号未注册平台账号，无法补录；请先让本人完成注册');
   if(input.accountId&&input.accountId!==participant.accountId)throw fail(409,'所选人员与平台账号不一致，请重新选择');
   const prefix=`WMH-${input.requestId}-`,existing=ctx.supplemental.find(row=>String(row['报名ID']).startsWith(prefix));
   if(existing){
    const line=ctx.finalRows.get(existing._id);
    // 已撤回的那条不算重放：继续往下走，复用原报名行并重建待确认的台账行。
    if(line&&(line.manualApproval||'approved')!=='revoked'){
     if(line.fingerprint!==input.fingerprint||line.addedBy!==actor)throw fail(409,'补录内容已改变，请关闭窗口重新添加');
     return {id:existing._id,approval:line.manualApproval||'approved'};
    }
   }
   if(ctx.supplemental.filter(row=>row['报名状态']!=='已撤回').length>=200)throw fail(400,'补录人员过多，请联系管理员');
   if(!addParticipant)throw fail(503,'人员补录尚未就绪');
   const details=input.details||{},candidate={id:'new',name:input.name,studentId:input.studentId,department:input.department,location:details.location,dates:details.dates,work:details.work,remark:details.remark||'',serviceHours:details.serviceHours,trainingHours:details.trainingHours,travelHours:details.travelHours,decision:'pass',reason:'',evidenceChecked:true};
   const normalized=changedRows({rows:[candidate]},[{id:'new'}])[0];
   const {registration}=await addParticipant(ctx.data,job,input,actor,participant);
   const row={...normalized,id:registration._id,position:job['岗位']||job['活动名称'],firstDecision:'manual',manual:true,
    requestId:input.requestId,fingerprint:input.fingerprint,addedBy:actor,manualApproval:'pending',...slotOf(registration)};
   // 草稿阶段只落台账行，不动 finalHours 配置：写配置会把活动提前推进到「时长审核」。
   const patch=ledgerPatch({data:ctx.data,event:ctx.event},row,actor,'待批准');
   const current=ctx.data.ledger.find(line=>isFinalLedgerRow(line)&&line['报名行ID']===registration._id);
   if(current)await updateRows(WF.ledger,[current],()=>patch);else await appendRows(WF.ledger,[patch]);
   return {id:registration._id,approval:'pending'};
  }),
  confirmSupplement:(id,body,actor)=>write(async()=>{
   const rowId=typeof body?.rowId==='string'?body.rowId:'';if(!rowId)throw fail(400,'请选择要确认的补录记录');
   const ctx=await supplementContext(id,actor,'reviewer');
   const line=supplementLineOf(ctx,rowId);
   if(!line||!line.manual)throw fail(404,'补录记录不存在');
   const approval=line.manualApproval||'approved';
   if(approval==='revoked')throw fail(409,'该补录已撤回，不能确认');
   if(approval==='approved')return {approval};
   const raw=ctx.data.ledger.find(row=>isFinalLedgerRow(row)&&row['报名行ID']===line.id);
   if(!raw)throw fail(409,'补录台账行缺失，请核对后重试');
   // 主席团成员同时是补录人时允许确认（与「主席团可审自己」的现有口径一致），但留自审标记。
   const next={...line,manualApproval:'approved',approvedBy:actor,approvedAt:new Date(now()).toISOString(),selfReview:actor===line.addedBy};
   await updateRows(WF.ledger,[raw],()=>ledgerPatch({data:ctx.data,event:ctx.event},next,actor,raw['状态']||'待批准'));
   return {approval:'approved',selfReview:next.selfReview};
  }),
  revokeSupplement:(id,body,actor)=>write(async()=>{
   const rowId=typeof body?.rowId==='string'?body.rowId:'';if(!rowId)throw fail(400,'请选择要撤回的补录记录');
   const ctx=await supplementContext(id,actor,'recorder');
   const line=supplementLineOf(ctx,rowId);
   if(!line||!line.manual)throw fail(404,'补录记录不存在');
   if((line.manualApproval||'approved')!=='pending')throw fail(409,'只有待主席团确认的补录可以撤回');
   if(line.addedBy!==actor)throw fail(403,'只有补录人本人可以撤回');
   const raw=ctx.data.ledger.find(row=>isFinalLedgerRow(row)&&row['报名行ID']===line.id);
   const registration=ctx.data.registrations.find(row=>row._id===line.id);
   if(!raw||!registration)throw fail(409,'补录记录不完整，请核对');
   const nowIso=new Date(now()).toISOString();
   await update(WF.registrations,registration,{报名状态:'已撤回',处理说明:`${registration['处理说明']||''}（${nowIso} 由补录人撤回）`});
   await updateRows(WF.ledger,[raw],()=>ledgerPatch({data:ctx.data,event:ctx.event},{...line,manualApproval:'revoked'},actor,'已作废'));
   return {approval:'revoked'};
  }),
  exportFinalHours:(id,body,actor)=>write(async()=>{
   const ctx=await context(id,actor);await authorizeReview(ctx.event,actor);
   if(ctx.status==='exported'){if(body.token===ctx.c.finalHours.requestToken&&actor===ctx.c.finalHours.exportedBy)return {exported:true};throw fail(409,'最终表已导出，请下载归档文件');}
   if(body.token!==ctx.token)throw fail(409,'时长表已更新，请重新预览');
   if(ctx.pendingManual.length)throw fail(409,'存在未完成的人员补录，请先在原补录窗口核对完成');
   // 负责人补录必须由主席团逐条确认：未确认的行不能静默混进导出表。
   const unconfirmed=ctx.rows.filter(row=>row.manual&&supplementApprovalOf(row)==='pending');
   if(unconfirmed.length)throw fail(409,`有 ${unconfirmed.length} 条人员补录待主席团确认，确认后才能导出`);
   const rows=changedRows(ctx,ctx.rows.map(row=>Object.fromEntries(['id',...editKeys].map(key=>[key,row[key]])))),eligible=eligibleRows(rows);
   if(!eligible.length)throw fail(409,'没有审核通过的有效时长，不能导出结束活动');
   // 同一账号的多场次在导出前合并成一行：录入方按人登记，重复行会被当成多次服务。
   const stored=storedFinalHoursRows(rows,ctx.groups);
   // 先按同一份行数据生成一次：模板或数据问题在导出当时就暴露，而不是等下载时才发现。
   const to=await recipient(ctx.event);await finalHoursWorkbook(eligible);
   const token=hash([ctx.token,rows]),exportedAt=new Date(now()).toISOString();
   ctx.c.finalHours={status:'exported',token,requestToken:ctx.token,exportedBy:actor,exportedAt,filename:safeName(ctx.event['活动名称']),eligibleCount:eligible.length,mail:{status:'pending',to:to.email,accountId:to.accountId,...(to.recipients?{recipients:to.recipients.map(row=>({...row,status:'pending'}))}:{}),key:`workflow-hours:${ctx.event._id}:${token}`}};
   const encoded=configuration(ctx);
   // 冻结行数据在台账里，不再回写配置；状态同时转为已批准，便于台账直接查阅。
   await persistRows({...ctx,rows:stored},stored,actor,'已批准');
   await syncManualRows(ctx.data,stored);
   await update(WF.events,ctx.event,{状态:'已结束',报名页配置:encoded});return {exported:true};
  }),
  downloadFinalHours:async(id,actor)=>{const ctx=await context(id,actor);if(ctx.status!=='exported')throw fail(409,'请先由本地区主席团导出最终表');return {buffer:await archivedBuffer(ctx.rows),filename:ctx.c.finalHours.filename};},
  deliverFinalHours:async(id,actor,send)=>{
   const ctx=await context(id,actor);if(ctx.status!=='exported')throw fail(409,'最终表尚未导出');
   const mail=ctx.c.finalHours.mail;if(mail.status==='sent')return {status:'sent'};
   let result;
   const current=await recipient(ctx.event);
   if(current.accountId!==mail.accountId||current.email!==mail.to)throw fail(409,'负责人邮箱已变化，请核对原邮件任务，不能改发给其他地址');
   if(mail.recipients){
    if(JSON.stringify(current.recipients||[{accountId:current.accountId,email:current.email}])!==JSON.stringify(mail.recipients.map(({accountId,email})=>({accountId,email}))))throw fail(409,'负责人名单或邮箱已变化，请核对原邮件任务');
    const recipients=structuredClone(mail.recipients),buffer=await archivedBuffer(ctx.rows),title=String(ctx.event['活动名称']).replace(/[\r\n]+/g,' ').slice(0,300);
    for(const target of recipients){
     if(['sent','unknown'].includes(target.status))continue;
     let response;try{response=await send({to:target.email,subject:`${title}：最终时长表`,text:`活动“${ctx.event['活动名称']}”的时长审核已完成。最终分工时长表见附件，请核对并录入时长；也可在活动管理的已结束页面下载。`,kind:'workflow-hours',idempotencyKey:`${mail.key}:${target.accountId}`,attachments:[{filename:ctx.c.finalHours.filename,content:buffer,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}]});}catch{response={ok:false,code:'mail_delivery_unknown'};}
     target.status=response.ok&&['smtp','idempotent-skip'].includes(response.transport)?'sent':response.code==='mail_delivery_unknown'?'unknown':'failed';
    }
    const status=recipients.every(row=>row.status==='sent')?'sent':recipients.some(row=>row.status==='unknown')?'unknown':'failed';
    await write(async()=>{const fresh=await context(id,actor);if(fresh.c.finalHours.token!==ctx.c.finalHours.token)throw fail(409,'归档版本已变化');if(fresh.c.finalHours.mail.status==='sent')return;fresh.c.finalHours.mail={...fresh.c.finalHours.mail,status,recipients};await update(WF.events,fresh.event,{报名页配置:configuration(fresh)});});return {status};
   }
   try{const buffer=await archivedBuffer(ctx.rows),title=String(ctx.event['活动名称']).replace(/[\r\n]+/g,' ').slice(0,300);result=await send({to:mail.to,subject:`${title}：最终时长表`,text:`活动“${ctx.event['活动名称']}”的时长审核已完成。最终分工时长表见附件，请核对并录入时长；也可在活动管理的已结束页面下载。`,kind:'workflow-hours',idempotencyKey:mail.key,attachments:[{filename:ctx.c.finalHours.filename,content:buffer,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}]});}catch{result={ok:false,code:'mail_delivery_unknown'};}
   const status=result.ok&&['smtp','idempotent-skip'].includes(result.transport)?'sent':result.code==='mail_delivery_unknown'?'unknown':'failed';
   await write(async()=>{const fresh=await context(id,actor);if(fresh.c.finalHours.token!==ctx.c.finalHours.token)throw fail(409,'归档版本已变化');if(fresh.c.finalHours.mail.status==='sent')return;fresh.c.finalHours.mail={...fresh.c.finalHours.mail,status};await update(WF.events,fresh.event,{报名页配置:configuration(fresh)});});return {status};
  },
 };
 service.deliverPendingFinalHours=async send=>{
  const data=await read(),pending=data.events.filter(row=>{const c=workflowConfig(row);return c.finalHours?.status==='exported'&&['pending','failed'].includes(finalState(row._id,c.finalHours)?.mail?.status);}).slice(0,8);
  for(const row of pending){try{await service.deliverFinalHours(row._id,finalState(row._id,workflowConfig(row).finalHours).exportedBy,send);}catch{/* Frozen job remains available for scoped reconciliation. */}}
  return {examined:pending.length};
 };
 return service;
}
