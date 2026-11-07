import {rowsByValues} from '../http/rows-by-values.js';
import {randomUUID} from 'node:crypto';
import {hoursPostingHash,hoursPersonKey,hoursActivityNames,roundHours} from './hours-posting-source.js';
import {LEGACY_ACTIVITY_ID_COLUMN,activityIdsOf} from './hours-academic-year.js';
import {createHoursRevisions} from './hours-revisions.js';

export const HOURS_POSTING_TABLES=Object.freeze({legacy:'活动及时长汇总表',website:'网站志愿时长汇总表',profile:'个人主页（编辑版）',websiteProfile:'网站个人主页表'});
const conflict=message=>Object.assign(Error(message),{code:'hours_posting_conflict',statusCode:409});
const same=(row,patch)=>Boolean(row)&&Object.entries(patch).every(([key,value])=>String(row[key]??'')===String(value??''));
const text=row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,String(value??'')]));
const numeric=value=>{const n=Number(value);if(value==null||value===''||!Number.isFinite(n)||n<0)throw conflict('原汇总时长无效，需人工核对');return n;};

/** Private write-ahead receipts. No columns, formulas, scripts or table settings are changed.
 * An uncertain write retries its recorded absolute value, never increments again.
 * External writers have no CAS API: a changed snapshot is a conflict, not a retry.
 */
export function createHoursPosting({base,store,now=()=>Date.now(),withGroup=task=>task(),onPosted=async()=>{},onRevision=async()=>{},allowConcurrentReviews=false}){
 const owner=randomUUID();
 const stamp=()=>new Date(now()).toISOString();
 async function find(table,person,accountId){
  let rows=await rowsByValues(base,table,accountId?'账号ID':'学号',[accountId||person.studentId]);
  // A later campus registration adopts only this student's synthetic manual
  // mirror. Never merge or reassign two real accounts.
  if(!rows.length&&accountId&&!accountId.startsWith('manual:'))rows=await rowsByValues(base,table,'账号ID',[`manual:${person.studentId}`]);
  if(rows.length>1)throw conflict('同一人员存在多条汇总记录，请先核对');
  const row=rows[0];if(row&&hoursPersonKey(row['姓名'],row['学号'])!==person.personKey)throw conflict('汇总记录的姓名与学号不一致');
  return row||null;
 }
 async function write(kind,id,person,patch,{accountId,complete}={}){
  if(!['legacy','website'].includes(kind))throw conflict('个人主页由 NJUTable 自动化维护，禁止网站写入');
  if(!store.acquire(owner,Date.now()))throw conflict('其他进程正在同步，请稍后刷新');
  const table=HOURS_POSTING_TABLES[kind],old=store.get('intent',`${kind}:${id}`);
  let intent=old;
  if(intent&&intent.status!=='done'){
   const row=await find(table,person,accountId);
   if(same(row,intent.after)){
    intent={...intent,status:'done',finishedAt:stamp()};store.set('intent',`${kind}:${id}`,intent);return intent.complete;
   }
   if(intent.before===null?row!==null:!same(row,intent.before)||row?._id!==intent.rowId)throw conflict('上次写入结果与当前汇总不一致，请核对后重试');
  }else{
   const row=await find(table,person,accountId);
   const after=typeof patch==='function'?patch(row):patch;
   intent={kind,id,rowId:row?._id||null,before:row?Object.fromEntries(Object.keys(after).map(key=>[key,row[key]??''])):null,after,complete,status:'pending',createdAt:stamp()};
   store.set('intent',`${kind}:${id}`,intent);
  }
  // A second fresh comparison avoids overwriting changes since the intent was prepared.
  const current=await find(table,person,accountId);
  if(intent.before===null?current!==null:current?._id!==intent.rowId||!same(current,intent.before))throw conflict('汇总表已被其他操作更新，本次未覆盖');
  if(!store.acquire(owner,Date.now()))throw conflict('同步任务租约已失效，请稍后核对');
  if(intent.rowId)await base.updateRow(table,intent.rowId,intent.after);else await base.appendRow(table,intent.after);
  const saved=await find(table,person,accountId);
  if(!same(saved,intent.after))throw conflict('写入回读尚未一致，请核对结果');
  store.set('intent',`${kind}:${id}`,{...intent,status:'done',finishedAt:stamp()});return intent.complete;
 }
 function receipt(source){return store.get('receipt',source.key);}
 function mark(source,patch){const previous=receipt(source)||{};return store.set('receipt',source.key,{...previous,key:source.key,version:source.version,source,...patch});}
 const revisions=createHoursRevisions({store,now,mark,onRevision,findLegacy:source=>find(HOURS_POSTING_TABLES.legacy,source),writeLegacy:(id,source,patch)=>write('legacy',id,source,patch)});
 async function legacy(sources,{force=false}={}){
  const person=sources[0],id=person.personKey;
  // Recover the previous operation before calculating any new delta.
  const pending=store.get('intent',`legacy:${id}`);
  if(pending&&pending.status!=='done'){
   const completed=await write('legacy',id,person,null);
   for(const source of completed)mark(source,{legacyStatus:'done',legacySyncedAt:stamp(),legacyCreditHours:revisions.oldCredit({key:source.key,source,legacyStatus:'done'})});
  }else if(pending?.complete){
   // A crash between readback and receipt writes must also be harmless.
   for(const source of pending.complete)if(receipt(source)?.legacyStatus!=='done')mark(source,{legacyStatus:'done',legacySyncedAt:pending.finishedAt,legacyCreditHours:revisions.oldCredit({key:source.key,source,legacyStatus:'done'})});
  }
  const todo=sources.filter(source=>receipt(source)?.legacyStatus!=='done');if(!todo.length)return;
  const ownNames=new Set(store.all('receipt').filter(r=>r.source?.personKey===id&&r.legacyStatus==='done').map(r=>r.source.activityName));
  const knownIds=new Set(store.all('receipt').filter(r=>r.source?.personKey===id&&r.legacyStatus==='done').flatMap(r=>[r.source.eventId,r.source.activityId]).filter(Boolean));
  await write('legacy',id,person,row=>{
   const names=hoursActivityNames(row?.['活动名称']);
   const existingIds=activityIdsOf(row?.[LEGACY_ACTIVITY_ID_COLUMN]);
   // force 仅跳过「同名活动」防重复提示：超管在核对原表后显式确认按本次入账。
   // 其余校验（版本、修订、汇总表写入）仍然生效。
   if(!force&&todo.some(source=>(names.includes(source.activityName)||existingIds.includes(source.eventId||source.activityId))&&!ownNames.has(source.activityName)&&!knownIds.has(source.eventId||source.activityId)))throw conflict('原汇总表已有同名活动或活动ID，请确认是否已人工入账，避免重复累计');
   const previous=row&&row['志愿时长']!==''&&row['志愿时长']!=null?numeric(row['志愿时长']):0;
   const original=String(row?.['活动名称']||''),added=[...new Set(todo.map(s=>s.activityName))].filter(name=>!names.includes(name));
   const activities=original+(original&&added.length&&!/[、；;\n]$/.test(original)?'、':'')+added.join('、');
   // 口径：旧汇总表只有「志愿时长」一列，只写服务时长；培训/交通留在平台台账。
   // 新增「活动ID」列供机器匹配，避免仅靠活动名称判断是否已入账。
   const known=activityIdsOf(row?.[LEGACY_ACTIVITY_ID_COLUMN]);
   const addedIds=[...new Set(todo.map(s=>s.eventId||s.activityId).filter(Boolean))].filter(id=>!known.includes(id));
   return {...(!row?{姓名:person.name,学号:person.studentId}:{}),志愿时长:roundHours(previous+todo.reduce((sum,s)=>sum+s.serviceHours,0)),活动名称:activities,[LEGACY_ACTIVITY_ID_COLUMN]:[...known,...addedIds].join(',')};
  },{complete:todo});
  for(const source of todo)mark(source,{legacyStatus:'done',legacySyncedAt:stamp(),legacyCreditHours:source.serviceHours});
 }
 async function website(sources){
  const person=personOf(sources),sum=key=>roundHours(sources.reduce((n,s)=>n+s[key],0));
  const pending=store.get('intent',`website:${person.accountId}`);
  if(pending&&pending.status!=='done')await write('website',person.accountId,person,null,{accountId:person.accountId});
  if(sources.every(s=>receipt(s)?.websiteStatus==='done'))return;
  const patch=text({账号ID:person.accountId,姓名:person.name,学号:person.studentId,服务时长:sum('serviceHours'),培训时长:sum('trainingHours'),交通时长:sum('travelHours'),明细摘要:hoursPostingHash(sources.map(s=>[s.key,s.version])),更新时间:stamp()});
  await write('website',person.accountId,person,patch,{accountId:person.accountId,complete:sources});
  for(const source of sources)mark(source,{websiteStatus:'done',websiteSyncedAt:stamp()});
 }
 let active=null;
 const personOf=sources=>({...sources[0],accountId:sources.find(s=>!s.accountId.startsWith('manual:'))?.accountId||sources[0].accountId});
 async function existingCredit(key,{token,confirmed=false}={}){
  if(active&&!allowConcurrentReviews)throw conflict('同步正在进行，请稍后核对');
  const selected=store.get('receipt',key);if(!selected||selected.legacyStatus==='done')throw conflict('该明细不在待核对状态');
  const source=selected.source,related=store.all('receipt').filter(r=>r.source.personKey===source.personKey&&r.source.activityName===source.activityName&&r.legacyStatus!=='done');
  const intent=store.get('intent',`legacy:${source.personKey}`);if(intent&&intent.status!=='done')throw conflict('存在未确定的写入，请先重试核对，不能手工标记');
  const row=await find(HOURS_POSTING_TABLES.legacy,source),total=roundHours(related.reduce((n,r)=>n+r.source.serviceHours,0));
  if(!row||!hoursActivityNames(row['活动名称']).includes(source.activityName)&&!activityIdsOf(row[LEGACY_ACTIVITY_ID_COLUMN]).includes(source.eventId||source.activityId)||numeric(row['志愿时长'])<total)throw conflict('原表没有足够的同名活动入账依据');
  const snapshot={key,name:source.name,studentId:source.studentId,activityName:source.activityName,totalHours:total,legacyHours:numeric(row['志愿时长']),count:related.length};
  const expected=hoursPostingHash([snapshot,row._id,row['活动名称'],related.map(r=>[r.key,r.version])]);
  if(!confirmed)return {...snapshot,token:expected};
  if(token!==expected)throw conflict('核对期间原表或明细已变化，请重新核对');
  for(const receipt of related)mark(receipt.source,{legacyStatus:'done',legacySyncedAt:stamp(),legacyAcknowledged:true,legacyCreditHours:receipt.source.serviceHours});
  return {acknowledged:true,count:related.length};
 }
 async function run(sources,{manual=false,force=false}={}){
  if(active)return active;
  if(!store.acquire(owner,Date.now()))throw conflict('其他进程正在同步，请稍后刷新');
  const heartbeat=setInterval(()=>store.acquire(owner,Date.now()),10000);heartbeat.unref();
  active=(async()=>{
   store.set('run','latest',{at:stamp(),manual,inProgress:true,failures:[]});
   const groups=new Map(),failures=[],blocked=new Set();
   for(const source of sources){
    if(!source.totalHours&&!receipt(source))continue;
    if(revisions.pending(source))try{await withGroup(()=>revisions.recover(source));}catch(error){blocked.add(source.personKey);failures.push({key:source.key,step:'revision',message:error.code==='hours_posting_conflict'?error.message:'已确认修订待重试'});continue;}
    const old=receipt(source);if(revisions.requiresConfirmation(source)){blocked.add(source.personKey);failures.push({key:source.key,step:'revision',message:'底表明细或入账口径变化，等待超管核对修订'});continue;}
    if(!old)mark(source,{legacyStatus:'pending',websiteStatus:'pending',profileStatus:'pending'});
    if(!groups.has(source.personKey))groups.set(source.personKey,[]);groups.get(source.personKey).push(source);
   }
   const keys=new Set(sources.map(s=>s.key));
   for(const previous of store.all('receipt'))if(!keys.has(previous.key)){blocked.add(previous.source.personKey);failures.push({key:previous.key,message:'原入账明细缺失或审核状态已改变，请核对冲销'});}
   for(const group of groups.values()){
    if(blocked.has(group[0].personKey))continue;
    if(new Set(group.filter(s=>!s.accountId.startsWith('manual:')).map(s=>s.accountId)).size>1||group.some(s=>s.accountId.startsWith('manual:')&&s.accountId!==`manual:${s.studentId}`)){failures.push({key:group[0].key,message:'同一人员存在多个账号，请核对'});continue;}
    await withGroup(async()=>{for(const [step,fn]of [['legacy',()=>legacy(group,{force})],['website',()=>website(group)]]){
     try{await fn();}
     catch(error){const message=error?.code==='hours_posting_conflict'?error.message:'同步暂未完成，请核对连接和写入权限后重试';for(const source of group)mark(source,{[`${step}Status`]:'failed',error:message});failures.push({key:group[0].key,step,message});break;}
    }
    const posted=group.filter(s=>receipt(s)?.legacyStatus==='done'&&receipt(s)?.websiteStatus==='done'&&receipt(s)?.postingStatus!=='done');
    if(posted.length)try{await onPosted(posted);for(const source of posted)mark(source,{postingStatus:'done'});}catch{failures.push({key:group[0].key,step:'posting',message:'汇总表已写入，报名入账状态待回写重试'});}
    });
   }
   const result={at:stamp(),manual,failures,profileSyncMode:'table_automation'};store.set('run','latest',result);return result;
  })();try{return await active;}finally{active=null;clearInterval(heartbeat);store.release(owner);}
 }
 // Workflow callers share the same per-person mutation queue. In that mode an
 // administrator can review between batches without releasing the worker lease.
 async function exclusive(task){if(active){if(!allowConcurrentReviews||!store.acquire(owner,Date.now()))throw conflict('其他进程正在同步，请稍后核对');return task();}if(!store.acquire(owner,Date.now()))throw conflict('其他进程正在同步，请稍后核对');try{return await task();}finally{store.release(owner);}}
 return {run,receipt,pendingRevision:revisions.pending,previewRevision:source=>exclusive(()=>revisions.preview(source)),acceptRevision:(source,body,actor)=>exclusive(()=>revisions.accept(source,body,actor)),previewYearBase:async()=>{throw conflict('个人主页时长由 NJUTable 自动化维护，网站不再修改学年基数');},acceptYearBase:async()=>{throw conflict('个人主页时长由 NJUTable 自动化维护，网站不再修改学年基数');},existingCredit:(...args)=>exclusive(()=>existingCredit(...args)),status:()=>({lastRun:(()=>{const run=store.get('run','latest');return run?{...run,nextProfileSyncAt:null,failures:(run.failures||[]).filter(f=>f.step!=='profile')}:null;})(),receipts:store.all('receipt'),revisions:revisions.history(),pendingRevisions:store.all('revision').filter(row=>row.status==='accepted').map(row=>({key:row.key,at:row.confirmedAt})),profileSyncMode:'table_automation'})};
}
