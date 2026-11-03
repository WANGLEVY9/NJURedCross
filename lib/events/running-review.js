import {createHash,createHmac} from 'node:crypto';
import {projectEvents} from '../../public/app/shared/activity-projects.js';
import {runningHourDefaults} from '../../public/app/shared/activity-running.js';
import {workflowConfig} from './blood-roster.js';
import {matchRunningImport} from './running-import.js';
import {runningTemplateWorkbook} from './running-template.js';
const fail=(statusCode,message)=>Object.assign(new Error(message),{statusCode,code:'running_review_conflict'});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keys=['serviceHours','trainingHours','travelHours'];

/**
 * 初审明细存在「网站服务时长明细表」（WF.ledger）的独立行上，用幂等键前缀与旧的
 * 时长流程隔离；活动的「报名页配置」只保留流程状态。
 *
 * 原先明细整包塞进「报名页配置」，而该文本列上限 10000 字符：一条初审记录约 231
 * 字符，四十余条就会撞顶，NJUTable 静默截断后整行配置永久不可读。献血周按周一归
 * 周，16 个场次合计三百余条参与记录，从一开始就不可能存下。明细改为一人一行后
 * 不再受单字段容量限制，且汇总只认「已批准／已入账」，不会污染志愿时长。
 */
export const RUNNING_LEDGER_PREFIX='RUNNING:';
export const FINAL_LEDGER_PREFIX='FINAL:';
export const runningLedgerKey=registrationId=>`${RUNNING_LEDGER_PREFIX}${registrationId}`;
export const finalLedgerKey=registrationId=>`${FINAL_LEDGER_PREFIX}${registrationId}`;
const WORKSPACE_PREFIXES=[RUNNING_LEDGER_PREFIX,FINAL_LEDGER_PREFIX];
/** 新版时长链路（初审 + 终审）写入的台账行，旧流程的导出/审批/退回都必须绕开。 */
export const isWorkspaceHoursRow=row=>WORKSPACE_PREFIXES.some(prefix=>String(row?.['幂等键']||'').startsWith(prefix));
export const isRunningLedgerRow=row=>String(row?.['幂等键']||'').startsWith(RUNNING_LEDGER_PREFIX);
export const isFinalLedgerRow=row=>String(row?.['幂等键']||'').startsWith(FINAL_LEDGER_PREFIX);
const META_VERSION=2;
/** 判定类信息没有专属列，压缩成 JSON 写进「备注」；时长本身走数值列。 */
const encodeMeta=item=>JSON.stringify({v:META_VERSION,d:item.decision||'',e:item.evidenceChecked===true,...(item.attendanceUrl?{u:item.attendanceUrl}:{})});
function decodeMeta(raw){
 const text=String(raw||'');
 if(text.startsWith('{')){
  try{
   const meta=JSON.parse(text);
   if(meta&&meta.v===META_VERSION)return {decision:['pass','fail'].includes(meta.d)?meta.d:'',evidenceChecked:meta.e===true,...(meta.u?{attendanceUrl:meta.u}:{})};
  }catch{/* 落到旧格式 */ }
  return {decision:'',evidenceChecked:false};
 }
 // 早期草稿用管道分隔，读取时继续兼容。
 const [version,decision,evidence,...rest]=text.split('|');
 if(version!=='v1')return {decision:'',evidenceChecked:false};
 const url=rest.join('|');
 return {decision:['pass','fail'].includes(decision)?decision:'',evidenceChecked:evidence==='1',...(url?{attendanceUrl:url}:{})};
}
const toNumber=value=>Number.isFinite(Number(value))?Number(value):0;
/** 固定字段顺序后再比较，避免「配置内旧数据」与「台账还原数据」因键序不同被判成不同。 */
const canonical=item=>JSON.stringify([item.id,toNumber(item.serviceHours),toNumber(item.trainingHours),toNumber(item.travelHours),item.decision||'',item.reason||'',item.evidenceChecked===true,item.attendanceUrl||'']);
/** 从台账行还原初审明细；jobIds 用于限定到本项目。 */
export function runningLedgerEntries(data,jobIds){
 const ids=jobIds instanceof Set?jobIds:new Set(jobIds||[]);
 return (data?.ledger||[]).filter(row=>isRunningLedgerRow(row)&&(!ids.size||ids.has(row['活动ID']))).map(row=>({
  id:row['报名行ID'],serviceHours:toNumber(row['服务时长']),trainingHours:toNumber(row['培训时长']),travelHours:toNumber(row['交通时长']),
  ...decodeMeta(row['备注']),reason:row['退回原因']||'',sourceDigest:row['来源摘要']||'',
 }));
}
/** 单条判断：某报名行是否已有初审记录（请假策略等处使用）。 */
export function hasRunningEntry(data,registrationId){return (data?.ledger||[]).some(row=>isRunningLedgerRow(row)&&row['报名行ID']===registrationId);}
/**
 * 终审明细行：与初审分开存（`FINAL:` 前缀），保证初审判定与来源摘要冻结不被终审覆盖。
 * 备注列存 JSON，含终审结论、证据核验、初审结论、备注与补录信息。
 */
export function finalLedgerEntries(data,jobIds){
 const ids=jobIds instanceof Set?jobIds:new Set(jobIds||[]);
 return (data?.ledger||[]).filter(row=>isFinalLedgerRow(row)&&(!ids.size||ids.has(row['活动ID']))).map(row=>{
  let meta={};
  try{const parsed=JSON.parse(String(row['备注']||''));if(parsed&&parsed.v===META_VERSION)meta=parsed;}catch{/* 保底按空处理 */}
  return {id:row['报名行ID'],studentId:row['学号']||'',location:row['具体工作地点']||'',dates:row['正式工作日期']||'',work:row['工作内容']||'',
   remark:meta.r||'',serviceHours:toNumber(row['服务时长']),trainingHours:toNumber(row['培训时长']),travelHours:toNumber(row['交通时长']),
   decision:['pass','fail'].includes(meta.d)?meta.d:'',reason:row['退回原因']||'',evidenceChecked:meta.e===true,firstDecision:meta.f||'',
   ...(meta.m?{manual:true,requestId:meta.m.requestId,fingerprint:meta.m.fingerprint,addedBy:meta.m.addedBy}:{}),status:row['状态']||'',sourceDigest:row['来源摘要']||''};
 });
}
export function runningSourceDigest(events,registrations,checkins,ledger){const ids=new Set(events.filter(row=>workflowConfig(row).bookingMode!=='grouped').map(row=>row['活动ID']));return hash([events.map(row=>[row._id,row['活动ID'],row['状态'],row['申请版本'],row['批准摘要']]),registrations,checkins.filter(row=>ids.has(row['活动ID'])),ledger.filter(row=>ids.has(row['活动ID'])&&!isWorkspaceHoursRow(row))]);}
export function normalizeRunningItem(item){
 if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(key=>!['id',...keys,'decision','reason','evidenceChecked','attendanceUrl'].includes(key))||typeof item.id!=='string'||!item.id)throw fail(400,'初审记录无效');
 const result={id:item.id};
 for(const key of keys){if(!['string','number'].includes(typeof item[key])||String(item[key]).trim()===''||!Number.isFinite(Number(item[key]))||Number(item[key])<0||Number(item[key])>100000)throw fail(400,'请填写有效的非负时长');result[key]=Number(item[key]);}
 if(!['','pass','fail'].includes(item.decision))throw fail(400,'请选择初审结果');
 result.decision=item.decision;result.reason=typeof item.reason==='string'?item.reason.trim():'';result.evidenceChecked=item.evidenceChecked===true;
 if(result.reason.length>500||result.decision==='fail'&&!result.reason)throw fail(400,'初审不通过需填写原因，最多500字');
 if(item.attendanceUrl!==undefined&&item.attendanceUrl!==''){
  if(typeof item.attendanceUrl!=='string'||item.attendanceUrl.length>2000)throw fail(400,'签到链接无效');
  let url;try{url=new URL(item.attendanceUrl);}catch{throw fail(400,'签到链接无效');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw fail(400,'签到链接只支持网页地址');result.attendanceUrl=url.href;
 }
 return result;
}

/**
 * 负责人初审（独立于终审与入账）。
 *
 * 逐人明细写在「网站服务时长明细表」的独立行上（幂等键 `RUNNING:` 前缀），
 * 不创建签到、不写正式台账、不进已批准汇总；活动「报名页配置」只保留流程状态。
 */
export function createRunningReview({read,write,update,append,appendRows,updateRows,WF,approved,authorize,secret,now=()=>Date.now()}){
 function recordDigest(ctx,id){const row=ctx.registrations.find(row=>row._id===id),event=ctx.jobs.find(event=>event['活动ID']===row?.['活动ID']);return hash([event?.['批准摘要'],row,ctx.data.checkins.filter(check=>check['报名行ID']===id)]);}
 function ledgerPatch(ctx,item,actor,status){
  const reg=ctx.registrations.find(row=>row._id===item.id),job=ctx.jobs.find(row=>row['活动ID']===reg?.['活动ID']);
  return {幂等键:runningLedgerKey(item.id),报名行ID:item.id,签到行ID:reg?.['签到行ID']||'',活动ID:reg?.['活动ID']||'',
   账号ID:reg?.['账号ID']||'',学号:reg?.['学号']||'',姓名:reg?.['姓名']||'',规则版本:String(ctx.event['申请版本']||''),
   服务时长:item.serviceHours,培训时长:item.trainingHours,交通时长:item.travelHours,状态:status,
   核对人:actor,批准人:'',批准时间:'',入账时间:'',退回原因:item.decision==='fail'?item.reason:'',
   工作内容:job?.['工作内容']||'',具体工作地点:job?.['地点']||'',正式工作日期:job?.['报名日期']||'',
   备注:encodeMeta(item),来源摘要:recordDigest(ctx,item.id),修订人:actor,修订时间:new Date(now()).toISOString()};
 }
 async function context(id,actor,writing=false,authorityEvents){
  const data=await read(id,authorityEvents),event=data.events.find(row=>row._id===id),c=workflowConfig(event||{});
  if(!event)throw fail(404,'活动不存在');
  if(!c.workspaceSubmission||c.parentActivityId||c.approval?.mode!=='workspace-regional')throw fail(409,'请从新版项目活动进入时长初审');
  const events=projectEvents(data.events,event),jobs=events.filter(row=>workflowConfig(row).bookingMode!=='grouped');
  const state=c.finalHours?.status==='exported'?'已结束':'进行中';
  if(!events.length)throw fail(409,'项目内没有可审核的岗位');
  // 逐条列出不一致的班次：否则界面上只看到一句「项目状态已变化」，无法判断该去改哪一场。
  const misaligned=events.filter(row=>row['状态']!==state||!approved(row));
  if(misaligned.length){
   const detail=misaligned.map(row=>`${row['岗位']||row['活动名称']}（${row['状态']}${approved(row)?'':'·未批准'}）`).join('、');
   throw fail(409,`项目内班次状态不一致：${detail}；请先在活动管理里把该班次对齐到「${state}」`);
  }
  // 项目级授权：项目内任一目标通过即可。献血周这类 16 场次项目常由多人分担，
  // 若逐场次取交集，没有任何一个账号能提交整份初审——表现就是「待初审」却点不动。
  let canRecord=false,canRecordError=null;
  for(const target of events){
   try{await authorize(target,actor);canRecord=true;break;}
   catch(error){canRecordError=canRecordError||error;}
  }
  if(writing&&!canRecord){
   if(canRecordError)throw canRecordError;
   throw fail(403,'仅本项目负责人或超级管理员可以进行时长初审');
  }
  if(writing&&c.runningReview?.status==='submitted')throw fail(409,'时长已提交主席团审核');
  const ids=new Set(jobs.map(row=>row['活动ID']));
  const registrations=data.registrations.filter(row=>ids.has(row['活动ID'])&&['已确认','已签到'].includes(row['报名状态'])&&row['请假状态']!=='已批准');
  if(new Set(registrations.map(row=>row._id)).size!==registrations.length)throw fail(409,'参与记录重复，请核对');
  // Bind preview to every identity, outcome, attendance and existing ledger revision.
  const sourceDigest=runningSourceDigest(events,registrations,data.checkins,data.ledger);
  const reviewing=data.ledger.filter(isRunningLedgerRow).filter(row=>ids.has(row['活动ID']));
  const token=hash([sourceDigest,c.runningReview||null,reviewing.map(row=>[row._id,row['修订时间'],row['状态'],row['服务时长'],row['培训时长'],row['交通时长'],row['备注'],row['退回原因'],row['来源摘要']]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
  const ledgerRows=new Map(reviewing.map(row=>[row['报名行ID'],row]));
  const legacyEntries=Array.isArray(c.runningReview?.entries)?c.runningReview.entries:[];
  // 终审修改后的时长以台账 `FINAL:` 行为准，供已提交后的只读视图展示。
  const finalRows=new Map(finalLedgerEntries(data,ids).map(row=>[row.id,row]));
  return {data,event,c,events,jobs,registrations,sourceDigest,token,canRecord,ledgerRows,finalRows,legacyEntries,
   canRecordReason:canRecordError?.message||(canRecord?'':'当前账号不能进行时长初审')};
 }
 const savedEntries=ctx=>[...new Map([
   ...ctx.legacyEntries.map(item=>[item.id,{row:null,entry:{...item}}]),
   ...[...ctx.ledgerRows.values()].map(row=>[row['报名行ID'],{row,entry:{id:row['报名行ID'],serviceHours:toNumber(row['服务时长']),trainingHours:toNumber(row['培训时长']),travelHours:toNumber(row['交通时长']),...decodeMeta(row['备注']),reason:row['退回原因']||'',sourceDigest:row['来源摘要']||''}}])
  ]).values()]
  .filter(({entry})=>ctx.registrations.some(row=>row._id===entry.id))
  .map(({row,entry})=>{
   const {sourceDigest,...item}=entry;
   if(ctx.c.runningReview?.status==='submitted'){
    const final=ctx.finalRows?.get(item.id)||ctx.c.finalHours?.rows?.find(line=>line.id===item.id);
    return {row,entry:final?{...item,serviceHours:final.serviceHours,trainingHours:final.trainingHours,travelHours:final.travelHours}:item};
   }
   return {row,entry:sourceDigest===recordDigest(ctx,item.id)?item:{...item,decision:'',evidenceChecked:false}};
  });
 const entriesOf=ctx=>savedEntries(ctx).map(({entry})=>entry);
 function itemsFor(ctx,items,{complete=false}={}){
  if(!Array.isArray(items)||items.length>5000||!items.length&&ctx.registrations.length)throw fail(400,'初审名单无效');
  const normalized=items.map(normalizeRunningItem),ids=new Set(normalized.map(row=>row.id));
  if(ids.size!==items.length||normalized.some(item=>!ctx.registrations.some(row=>row._id===item.id)))throw fail(409,'参与名单已变化，请刷新');
  if(complete&&(ids.size!==ctx.registrations.length||normalized.some(item=>!item.decision)))throw fail(409,'请完成全部岗位参与人员的初审');
  return normalized.sort((a,b)=>a.id.localeCompare(b.id));
 }
 async function persist(ctx,items,actor,status){
  const known=new Map(savedEntries(ctx).filter(({row})=>row).map(({row,entry})=>[entry.id,row]));
  const patches=[],appends=[];
  for(const item of items){
   const row=known.get(item.id)||ctx.ledgerRows.get(item.id);
   if(row)patches.push({row,patch:ledgerPatch(ctx,item,actor,status)});
   else appends.push(ledgerPatch(ctx,item,actor,status));
  }
  if(patches.length){const byRow=new Map(patches.map(line=>[line.row,line.patch]));await updateRows(WF.ledger,patches.map(line=>line.row),row=>byRow.get(row));}
  // 新行一次性批量追加：300+ 人的项目逐行提交会跨境往返数百次。
  if(appends.length)await appendRows(WF.ledger,appends);
 }
 const sign=(ctx,items,actor)=>createHmac('sha256',secret).update(JSON.stringify([ctx.event._id,ctx.token,items,actor])).digest('hex');
 /**
  * 模板行与 `matchRunningImport` 取同一来源：「岗位」优先活动行、回退报名行；
  * 「日期／时段」只认报名行。列值一旦与匹配逻辑分叉，模板自己就会传不回去。
  */
 function templateRows(ctx){
  const saved=new Map(entriesOf(ctx).map(item=>[item.id,item]));
  return ctx.registrations.map(reg=>{
   const job=ctx.jobs.find(row=>row['活动ID']===reg['活动ID'])||{};
   const defaults=runningHourDefaults(job),entry=saved.get(reg._id)||{};
   const hours=key=>entry[key]!==undefined?entry[key]:defaults[key]??'';
   return {姓名:reg['姓名']||'',学号:reg['学号']||'',岗位:job['岗位']||reg['岗位']||'',日期:reg['报名日期']||'',时段:reg['报名时段']||'',
    报名ID:reg._id||'',服务时长:hours('serviceHours'),培训时长:hours('trainingHours'),交通时长:hours('travelHours')};
  }).sort((a,b)=>`${a.日期} ${a.岗位} ${a.姓名}`.localeCompare(`${b.日期} ${b.岗位} ${b.姓名}`,'zh-Hans-CN'));
 }
 const view=ctx=>({token:ctx.token,canRecord:ctx.canRecord&&ctx.c.runningReview?.status!=='submitted',canRecordReason:ctx.c.runningReview?.status==='submitted'?'时长已提交主席团审核':ctx.canRecord?'':ctx.canRecordReason||'',status:ctx.c.runningReview?.status||'draft',entries:entriesOf(ctx),submittedAt:ctx.c.runningReview?.submittedAt||''});
 return {
  runningReview:async(id,actor,authorityEvents)=>view(await context(id,actor,false,authorityEvents)),
  runningTemplate:async(id,actor,authorityEvents)=>{
   const ctx=await context(id,actor,false,authorityEvents);
   if(!ctx.canRecord)throw fail(403,ctx.canRecordReason||'仅本项目负责人或超级管理员可以下载时长表模板');
   const name=String(ctx.event['活动名称']||'活动').replace(/[\\/:*?"<>|\r\n]+/g,' ').trim().slice(0,60)||'活动';
   return {buffer:await runningTemplateWorkbook(templateRows(ctx)),filename:`${name}-时长初审名单.xlsx`};
  },
  importRunningReview:async(id,rows,actor)=>{
   const ctx=await context(id,actor,true);
   return {token:ctx.token,items:matchRunningImport(rows,ctx.registrations,ctx.jobs,entriesOf(ctx))};
  },
  saveRunningReview:(id,body,actor)=>write(async()=>{
   const ctx=await context(id,actor,true);if(body.token!==ctx.token)throw fail(409,'名单或初审已更新，请刷新后再保存');
   const incoming=itemsFor(ctx,body.items),entries=new Map(entriesOf(ctx).map(item=>[item.id,item]));
   for(const item of incoming)entries.set(item.id,item);
   const keep=[...entries.values()].filter(item=>ctx.registrations.some(row=>row._id===item.id));
   // 只落本次提交涉及的行：整份名单一起写会让每次保存都产生数百次远程写入。
   // 旧配置首次迁移时保留未选中的历史明细，避免只保存一人就丢掉其余人。
   await persist(ctx,ctx.legacyEntries.length?keep:incoming,actor,ctx.c.runningReview?.status==='submitted'?'待批准':'草稿');
   const nowIso=new Date(now()).toISOString();
   ctx.c.runningReview={status:ctx.c.runningReview?.status==='submitted'?'submitted':'draft',entryCount:keep.length,updatedBy:actor,updatedAt:nowIso};
   await update(WF.events,ctx.event,{报名页配置:JSON.stringify(ctx.c)});return {saved:true};
  }),
  previewRunningReview:async(id,body,actor)=>{
   const ctx=await context(id,actor,true);if(body.token!==ctx.token)throw fail(409,'名单或初审已更新，请刷新后重新预览');
   if(!ctx.registrations.length)throw fail(409,'没有可提交的参与记录');
   const items=itemsFor(ctx,body.items,{complete:true});
   return {token:ctx.token,previewToken:sign(ctx,items,actor),items,rows:items.map(item=>{const row=ctx.registrations.find(row=>row._id===item.id),job=ctx.jobs.find(job=>job['活动ID']===row['活动ID']);return {...item,name:row['姓名'],studentId:row['学号'],position:job['岗位']||job['活动名称'],date:row['报名日期']||job['报名日期'],slot:row['报名时段']||job['报名时段']};})};
  },
  // 初审提交后若发现漏了班次/人员（例如某场次状态没跟上项目），需要有受控的退回口，
 // 否则只能改数据库。退回保留已保存的台账明细，重新提交会重新走完整预览与签名。
 reopenRunningReview:(id,body,actor)=>write(async()=>{
  const data=await read(),event=data.events.find(row=>row._id===id);
  if(!event)throw fail(404,'活动不存在');
  const c=workflowConfig(event),current=c.runningReview||{};
  if(current.status!=='submitted')throw fail(409,'当前没有已提交的时长初审');
  if(['reviewing','exported'].includes(c.finalHours?.status))throw fail(409,'终审已开始或已完成，不能退回初审');
  const reason=typeof body?.reason==='string'?body.reason.trim():'';
  if(!reason)throw fail(400,'请填写退回原因');
  if(reason.length>500)throw fail(400,'退回原因不能超过500字');
  const events=projectEvents(data.events,event);
  let allowed=false,denied=null;
  for(const target of events){try{await authorize(target,actor);allowed=true;break;}catch(error){denied=denied||error;}}
  if(!allowed)throw denied||fail(403,'仅本项目负责人或主席团可以退回初审');
  const nowIso=new Date(now()).toISOString();
  c.runningReview={...current,status:'draft',reopenedBy:actor,reopenedAt:nowIso,reopenReason:reason,updatedBy:actor,updatedAt:nowIso};
  delete c.runningReview.submittedAt;delete c.runningReview.previewToken;
  await update(WF.events,event,{报名页配置:JSON.stringify(c)});
  return {reopened:true};
 }),
 submitRunningReview:(id,body,actor)=>write(async()=>{
   // An identical lost-response retry only reads the already committed submission.
   const before=await context(id,actor);
   // 与查看、保存、预览使用同一项目授权；重试也必须重新检查当前权限。
   if(!before.canRecord)throw fail(403,before.canRecordReason);
   if(before.c.runningReview?.status==='submitted'){
    if(before.c.runningReview.previewToken===body.previewToken&&before.c.runningReview.submittedBy===actor&&hash(entriesOf(before).sort((a,b)=>a.id.localeCompare(b.id)).map(canonical))===hash((body.items||[]).map(normalizeRunningItem).sort((a,b)=>a.id.localeCompare(b.id)).map(canonical)))return {submitted:true};
    throw fail(409,'时长已提交，请刷新查看');
   }
   const ctx=before;if(body.token!==ctx.token)throw fail(409,'名单或初审已更新，请重新预览');
   const items=itemsFor(ctx,body.items,{complete:true});if(typeof body.previewToken!=='string'||body.previewToken!==sign(ctx,items,actor))throw fail(409,'请先预览最新完整时长表');
   if(!ctx.registrations.length)throw fail(409,'没有可提交的参与记录');
   await persist(ctx,items,actor,'待批准');
   const nowIso=new Date(now()).toISOString();
   ctx.c.runningReview={status:'submitted',entryCount:items.length,entriesDigest:hash(items.map(item=>item.id).sort()),submittedBy:actor,submittedAt:nowIso,sourceDigest:ctx.sourceDigest,previewToken:body.previewToken,updatedBy:actor,updatedAt:nowIso};
   await update(WF.events,ctx.event,{报名页配置:JSON.stringify(ctx.c)});return {submitted:true};
  }),
 };
}
