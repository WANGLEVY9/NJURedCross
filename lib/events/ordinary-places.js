/** Seat inventory is a reconciled projection; registration history is never overwritten. */
import {readPagedRows} from '../http/paged-rows.js';
import {ordinaryConfig} from './ordinary-groups.js';
export const PLACE_TABLE='网站普通活动名额表';
export const PLACE_COLUMNS=['名额ID','活动组ID','活动ID','活动名称','报名日期','地点','报名时段','岗位','名额序号','名额状态','报名ID','报名行ID','更新时间'];
const active=r=>['待筛选','已确认','已签到'].includes(r['报名状态']);
const fail=()=>Object.assign(new Error('名额底表与报名记录不一致，请管理员核对'),{statusCode:409});
export function placePlan(events,registrations,existing=[]){
 const result=[],seen=new Set();
 for(const event of events.filter(ordinaryConfig)){
  const config=ordinaryConfig(event),id=event['活动ID'],capacity=Number(event['容量']);
  if(!id||seen.has(id)||!Number.isSafeInteger(capacity)||capacity<1||capacity>10000)throw fail();seen.add(id);
  const rows=existing.filter(r=>r['活动ID']===id),bookings=registrations.filter(r=>r['活动ID']===id&&active(r));
  if(bookings.some(r=>!r._id||!r['报名ID'])||bookings.length>capacity||new Set(bookings.map(r=>r['报名ID'])).size!==bookings.length)throw fail();
  const byNumber=new Map();for(const row of rows){const n=Number(row['名额序号']);if(!row._id||!Number.isSafeInteger(n)||n<1||n>10000||byNumber.has(n)||row['名额ID']!==`${id}:${n}`)throw fail();byNumber.set(n,row);}
  // Keep existing seat numbers where possible; cancelled registrations retain their own history.
  const assigned=new Map(),taken=new Set();
  for(const b of bookings){const matches=rows.filter(r=>r['报名ID']===b['报名ID']&&Number(r['名额序号'])<=capacity);if(matches.length>1)throw fail();if(matches.length){const n=Number(matches[0]['名额序号']);assigned.set(n,b);taken.add(b['报名ID']);}}
  for(const b of bookings.filter(b=>!taken.has(b['报名ID'])).sort((a,b)=>a['报名ID'].localeCompare(b['报名ID']))){let n=1;while(assigned.has(n))n++;assigned.set(n,b);}
  for(let n=1;n<=Math.max(capacity,...byNumber.keys());n++){
   const booking=assigned.get(n),previous=byNumber.get(n),values={名额ID:`${id}:${n}`,活动组ID:config.groupId,活动ID:id,活动名称:event['活动名称'],报名日期:event['报名日期'],地点:event['地点'],报名时段:event['报名时段'],岗位:event['岗位'],名额序号:String(n),名额状态:n>capacity?'已停用':booking?(booking['请假状态']==='待审批'?'取消待审批':'已占用'):'空闲',报名ID:booking?.['报名ID']||'',报名行ID:booking?._id||''};
   if(!previous||Object.entries(values).some(([key,value])=>String(previous[key]??'')!==String(value??'')))result.push({id:previous?._id,values});
  }
 }
 return result;
}
const quotePlaceId=value=>`'${String(value??'').replace(/'/g,"''")}'`;
/**
 * 只回读本次写入的名额行。定向查询不可用（无 SQL、被截断、列缺失）时返回
 * null，调用方退回整表读，语义与原来完全一致。
 */
async function readPlacesByIds(base,ids){
 if(!ids.length)return [];
 if(typeof base.query!=='function')return null;
 const rows=[];
 for(let start=0;start<ids.length;start+=100){
  const where=ids.slice(start,start+100).map(quotePlaceId).join(',');
  const batch=await base.query(`SELECT * FROM \`${PLACE_TABLE}\` WHERE \`名额ID\` IN (${where}) LIMIT 1000`);
  if(!Array.isArray(batch)||batch.length>=1000||batch.readMeta?.truncated)return null;
  rows.push(...batch);
 }
 return rows;
}
/**
 * 名额行写入：SDK 支持批量接口时一次提交并核对行数，否则逐行写入。
 * 两种方式都会由调用方回读核对，因此批量失败只需退回逐行，不改变结果。
 */
async function applyChanges(base,changes,{batchSize=100}={}){
 if(!changes.length)return;
 const updates=changes.filter(change=>change.id),created=changes.filter(change=>!change.id);
 const batched=typeof base.batchUpdateRows==='function'&&typeof base.batchAppendRows==='function';
 if(batched){
  try{
   for(let start=0;start<updates.length;start+=batchSize){
    const chunk=updates.slice(start,start+batchSize);
    const result=await base.batchUpdateRows(PLACE_TABLE,chunk.map(change=>({row_id:change.id,row:change.values})));
    if(result&&Array.isArray(result.failed)&&result.failed.length)throw Error('partial place update');
   }
   for(let start=0;start<created.length;start+=batchSize){
    const chunk=created.slice(start,start+batchSize);
    const result=await base.batchAppendRows(PLACE_TABLE,chunk.map(change=>change.values));
    if(result&&Number.isFinite(Number(result.inserted_row_count))&&Number(result.inserted_row_count)!==chunk.length)throw Error('partial place append');
   }
   return;
  }catch{/* 退回逐行写入 */}
 }
 for(const change of updates)await base.updateRow(PLACE_TABLE,change.id,change.values);
 for(const change of created){const row=await base.appendRow(PLACE_TABLE,change.values);if(!row?._id)throw fail();}
}
export function createOrdinaryPlaces(base,{now=Date.now}={}){
 async function reconcile(events,registrations,{maxChanges=Infinity}={}){
  if(maxChanges!==Infinity&&(!Number.isSafeInteger(maxChanges)||maxChanges<1))throw new TypeError('Invalid reconciliation batch size');
  const existing=await readPagedRows(base,PLACE_TABLE,{maxRows:100000,requireComplete:true});
  const plan=placePlan(events,registrations,existing);
  const batch=plan.slice(0,maxChanges);
  await applyChanges(base,batch.map(change=>({...change,values:{...change.values,更新时间:new Date(now()).toISOString()}})));
  // Readback detects ambiguous writes; a retry computes the missing portion, never blind appends.
  const appliedIds=[...new Set(batch.map(change=>String(change.values['名额ID'])))];
  let after=null;
  try{after=await readPlacesByIds(base,appliedIds);}catch{after=null;}
  if(!after)after=await readPagedRows(base,PLACE_TABLE,{maxRows:100000,requireComplete:true});
  // 只回读了本次写入的行：与写前快照合并，保持"剩余待办"的口径与整表回读一致。
  else after=existing.filter(row=>!appliedIds.includes(String(row['名额ID']))).concat(after);
  const remaining=placePlan(events,registrations,after);
  const applied=new Set(batch.map(change=>change.values['名额ID']));
  if(remaining.some(change=>applied.has(change.values['名额ID'])))throw fail();
  return {changed:batch.length,places:after.length,remaining:remaining.length};
 }
 return {reconcile};
}
