import {rowsByValues} from '../http/rows-by-values.js';
import {randomUUID} from 'node:crypto';
import {hoursPostingHash,hoursPersonKey,hoursActivityNames,roundHours} from './hours-posting-source.js';
import {eligibleForWeeklyHoursSync,nextHoursProfileSync,hoursProfileSyncWindow} from './hours-sync-schedule.js';

export const HOURS_POSTING_TABLES=Object.freeze({legacy:'活动及时长汇总表',website:'网站志愿时长汇总表',profile:'个人主页（编辑版）',websiteProfile:'网站个人主页表'});
const conflict=message=>Object.assign(Error(message),{code:'hours_posting_conflict',statusCode:409});
const same=(row,patch)=>Boolean(row)&&Object.entries(patch).every(([key,value])=>String(row[key]??'')===String(value??''));
const text=row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,String(value??'')]));
const numeric=value=>{const n=Number(value);if(value==null||value===''||!Number.isFinite(n)||n<0)throw conflict('原汇总时长无效，需人工核对');return n;};

/** Private write-ahead receipts. No columns, formulas, scripts or table settings are changed.
 * An uncertain write retries its recorded absolute value, never increments again.
 * External writers have no CAS API: a changed snapshot is a conflict, not a retry.
 */
export function createHoursPosting({base,store,now=()=>Date.now(),onProfilesChanged=()=>{},withGroup=task=>task(),onPosted=async()=>{}}){
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
 function mark(source,patch){const previous=receipt(source)||{};return store.set('receipt',source.key,{...previous,key:source.key,version:source.version,source,nextProfileSyncAt:nextHoursProfileSync(source.approvedAt),...patch});}
 async function legacy(sources){
  const person=sources[0],id=person.personKey;
  // Recover the previous operation before calculating any new delta.
  const pending=store.get('intent',`legacy:${id}`);
  if(pending&&pending.status!=='done'){
   const completed=await write('legacy',id,person,null);
   for(const source of completed)mark(source,{legacyStatus:'done',legacySyncedAt:stamp()});
  }else if(pending?.complete){
   // A crash between readback and receipt writes must also be harmless.
   for(const source of pending.complete)if(receipt(source)?.legacyStatus!=='done')mark(source,{legacyStatus:'done',legacySyncedAt:pending.finishedAt});
  }
  const todo=sources.filter(source=>receipt(source)?.legacyStatus!=='done');if(!todo.length)return;
  const ownNames=new Set(store.all('receipt').filter(r=>r.source?.personKey===id&&r.legacyStatus==='done').map(r=>r.source.activityName));
  await write('legacy',id,person,row=>{
   const names=hoursActivityNames(row?.['活动名称']);
   if(todo.some(source=>names.includes(source.activityName)&&!ownNames.has(source.activityName)))throw conflict('原汇总表已有同名活动，请确认是否已人工入账，避免重复累计');
   const previous=row&&row['志愿时长']!==''&&row['志愿时长']!=null?numeric(row['志愿时长']):0;
   const original=String(row?.['活动名称']||''),added=[...new Set(todo.map(s=>s.activityName))].filter(name=>!names.includes(name));
   const activities=original+(original&&added.length&&!/[、；;\n]$/.test(original)?'、':'')+added.join('、');
   return {...(!row?{姓名:person.name,学号:person.studentId}:{}),志愿时长:roundHours(previous+todo.reduce((sum,s)=>sum+s.totalHours,0)),活动名称:activities};
  },{complete:todo});
  for(const source of todo)mark(source,{legacyStatus:'done',legacySyncedAt:stamp()});
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
 async function profiles(sources,{manual=false}={}){
  const person=personOf(sources);if(!sources.every(s=>receipt(s)?.legacyStatus==='done'&&receipt(s)?.websiteStatus==='done'))return;
  const eligible=sources.filter(s=>manual||eligibleForWeeklyHoursSync(s.approvedAt,now()));
  const window=hoursProfileSyncWindow(now());
  if(!eligible.length||!manual&&eligible.every(s=>receipt(s)?.profileStatus==='done')&&store.get('profile-window',person.personKey)?.key===window.key)return;
  const summary=await find(HOURS_POSTING_TABLES.legacy,person);if(!summary)throw conflict('原汇总记录不存在');
  // Match the original summary-to-profile script: current period only. Historical
  // hours and the total-hours formula are intentionally absent from this patch.
  for(const kind of ['profile','websiteProfile']){const id=kind==='profile'?person.personKey:person.accountId;const pending=store.get('intent',`${kind}:${id}`);if(pending&&pending.status!=='done')await write(kind,id,person,null,{accountId:kind==='websiteProfile'?person.accountId:undefined});}
  const deferred=sources.filter(s=>!eligible.includes(s)&&receipt(s)?.profileStatus!=='done');
  const currentHours=roundHours(numeric(summary['志愿时长'])-deferred.reduce((n,s)=>n+s.totalHours,0));
  if(currentHours<0)throw conflict('汇总时长与待同步记录不一致');
  const visible=sources.filter(s=>eligible.includes(s)||receipt(s)?.profileStatus==='done');
  const withheld=new Set(deferred.map(s=>s.activityName).filter(name=>!visible.some(s=>s.activityName===name)));
  const activities=withheld.size?hoursActivityNames(summary['活动名称']).filter(name=>!withheld.has(name)).join('、'):String(summary['活动名称']||'');
  await write('profile',person.personKey,person,row=>({...(!row?{姓名:person.name,学号:person.studentId}:{}),志愿时长:currentHours,活动名称:activities}),{complete:eligible});
  const sum=key=>roundHours(visible.reduce((n,s)=>n+s[key],0));
  await write('websiteProfile',person.accountId,person,text({账号ID:person.accountId,姓名:person.name,学号:person.studentId,志愿时长:sum('totalHours'),培训时长:sum('trainingHours'),交通时长:sum('travelHours'),明细摘要:`hours-v2:${hoursPostingHash(visible.map(s=>[s.key,s.version]))}`,更新时间:stamp()}),{accountId:person.accountId,complete:eligible});
  for(const source of eligible)mark(source,{profileStatus:'done',profileSyncedAt:stamp()});await onProfilesChanged();
  store.set('profile-window',person.personKey,{key:window.key,at:stamp()});
 }
 let active=null;
 const personOf=sources=>({...sources[0],accountId:sources.find(s=>!s.accountId.startsWith('manual:'))?.accountId||sources[0].accountId});
 async function existingCredit(key,{token,confirmed=false}={}){
  if(active)throw conflict('同步正在进行，请稍后核对');
  const selected=store.get('receipt',key);if(!selected||selected.legacyStatus==='done')throw conflict('该明细不在待核对状态');
  const source=selected.source,related=store.all('receipt').filter(r=>r.source.personKey===source.personKey&&r.source.activityName===source.activityName&&r.legacyStatus!=='done');
  const intent=store.get('intent',`legacy:${source.personKey}`);if(intent&&intent.status!=='done')throw conflict('存在未确定的写入，请先重试核对，不能手工标记');
  const row=await find(HOURS_POSTING_TABLES.legacy,source),total=roundHours(related.reduce((n,r)=>n+r.source.totalHours,0));
  if(!row||!hoursActivityNames(row['活动名称']).includes(source.activityName)||numeric(row['志愿时长'])<total)throw conflict('原表没有足够的同名活动入账依据');
  const snapshot={key,name:source.name,studentId:source.studentId,activityName:source.activityName,totalHours:total,legacyHours:numeric(row['志愿时长']),count:related.length};
  const expected=hoursPostingHash([snapshot,row._id,row['活动名称'],related.map(r=>[r.key,r.version])]);
  if(!confirmed)return {...snapshot,token:expected};
  if(token!==expected)throw conflict('核对期间原表或明细已变化，请重新核对');
  for(const receipt of related)mark(receipt.source,{legacyStatus:'done',legacySyncedAt:stamp(),legacyAcknowledged:true});
  return {acknowledged:true,count:related.length};
 }
 async function run(sources,{manual=false}={}){
  if(active)return active;
  if(!store.acquire(owner,Date.now()))throw conflict('其他进程正在同步，请稍后刷新');
  const heartbeat=setInterval(()=>store.acquire(owner,Date.now()),10000);heartbeat.unref();
  active=(async()=>{
   store.set('run','latest',{at:stamp(),manual,inProgress:true,failures:[]});
   const groups=new Map(),failures=[],blocked=new Set();
   for(const source of sources){
    const old=receipt(source);if(old&&old.version!==source.version){blocked.add(source.personKey);failures.push({key:source.key,message:'已入账来源发生变化，请人工核对冲销，禁止重复累计'});continue;}
    if(!old)mark(source,{legacyStatus:'pending',websiteStatus:'pending',profileStatus:'pending'});
    if(!groups.has(source.personKey))groups.set(source.personKey,[]);groups.get(source.personKey).push(source);
   }
   const keys=new Set(sources.map(s=>s.key));
   for(const previous of store.all('receipt'))if(!keys.has(previous.key)){blocked.add(previous.source.personKey);failures.push({key:previous.key,message:'原入账明细缺失或审核状态已改变，请核对冲销'});}
   for(const group of groups.values()){
    if(blocked.has(group[0].personKey))continue;
    if(new Set(group.filter(s=>!s.accountId.startsWith('manual:')).map(s=>s.accountId)).size>1||group.some(s=>s.accountId.startsWith('manual:')&&s.accountId!==`manual:${s.studentId}`)){failures.push({key:group[0].key,message:'同一人员存在多个账号，请核对'});continue;}
    await withGroup(async()=>{for(const [step,fn]of [['legacy',()=>legacy(group)],['website',()=>website(group)],['profile',()=>profiles(group,{manual})]]){
     try{await fn();}
     catch(error){const message=error?.code==='hours_posting_conflict'?error.message:'同步暂未完成，请核对连接和写入权限后重试';for(const source of group)mark(source,{[`${step}Status`]:'failed',error:message});failures.push({key:group[0].key,step,message});break;}
    }
    const posted=group.filter(s=>receipt(s)?.legacyStatus==='done'&&receipt(s)?.websiteStatus==='done'&&receipt(s)?.postingStatus!=='done');
    if(posted.length)try{await onPosted(posted);for(const source of posted)mark(source,{postingStatus:'done'});}catch{failures.push({key:group[0].key,step:'posting',message:'汇总表已写入，报名入账状态待回写重试'});}
    });
   }
   const result={at:stamp(),manual,failures,nextProfileSyncAt:hoursProfileSyncWindow(now()).nextAt};store.set('run','latest',result);return result;
  })();try{return await active;}finally{active=null;clearInterval(heartbeat);store.release(owner);}
 }
 return {run,receipt,existingCredit:async(...args)=>{if(active||!store.acquire(owner,Date.now()))throw conflict('其他进程正在同步，请稍后核对');try{return await existingCredit(...args);}finally{store.release(owner);}},status:()=>({lastRun:store.get('run','latest'),receipts:store.all('receipt'),nextProfileSyncAt:hoursProfileSyncWindow(now()).nextAt})};
}
