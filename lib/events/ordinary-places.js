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
export function createOrdinaryPlaces(base,{now=Date.now}={}){
 async function reconcile(events,registrations,{maxChanges=Infinity}={}){
  if(maxChanges!==Infinity&&(!Number.isSafeInteger(maxChanges)||maxChanges<1))throw new TypeError('Invalid reconciliation batch size');
  const existing=await readPagedRows(base,PLACE_TABLE,{maxRows:100000,requireComplete:true});
  const plan=placePlan(events,registrations,existing);
  const batch=plan.slice(0,maxChanges);
  for(const change of batch){const values={...change.values,更新时间:new Date(now()).toISOString()};if(change.id)await base.updateRow(PLACE_TABLE,change.id,values);else{const created=await base.appendRow(PLACE_TABLE,values);if(!created?._id)throw fail();}}
  // Readback detects ambiguous writes; a retry computes the missing portion, never blind appends.
  const after=await readPagedRows(base,PLACE_TABLE,{maxRows:100000,requireComplete:true});
  const remaining=placePlan(events,registrations,after);
  const applied=new Set(batch.map(change=>change.values['名额ID']));
  if(remaining.some(change=>applied.has(change.values['名额ID'])))throw fail();
  return {changed:batch.length,places:after.length,remaining:remaining.length};
 }
 return {reconcile};
}
