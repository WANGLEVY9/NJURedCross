/** Display-only cross-Base projection. Never changes seats, bookings or accounts. */
import {readPagedRows} from '../http/paged-rows.js';
import {updateRows} from '../http/batch-write.js';
import {PLACE_TABLE} from './ordinary-places.js';
import {REGISTRATION_TABLE} from './registration-schema.js';

export const PLACE_PROFILE_COLUMNS=['姓名','学号'];
const text=value=>String(value??'').trim();
const invalid=()=>new Error('名额人员关联不唯一或不完整，请核对底表');
const rows=(base,table)=>readPagedRows(base,table,{maxRows:100000,requireComplete:true});

export function placeProfilePlan(places,registrations,accounts){
 const unique=(items,key)=>{const map=new Map();for(const row of items){const id=text(row[key]);if(!id)continue;if(map.has(id))throw invalid();map.set(id,row);}return map;};
 const bookings=unique(registrations,'报名ID'),people=unique(accounts,'账号ID');
 return places.flatMap(place=>{
  const bookingId=text(place['报名ID']),booking=bookings.get(bookingId);
  // Row identity and activity must agree; never fall back to a matching name/student ID.
  if(bookingId&&(!booking||booking._id!==place['报名行ID']||booking['活动ID']!==place['活动ID']))throw invalid();
  const occupied=['已占用','取消待审批'].includes(place['名额状态']);
  const current=booking&&['待筛选','已确认','已签到'].includes(booking['报名状态']);
  const account=occupied&&current?people.get(text(booking['账号ID'])):null;
  const fields={姓名:text(account?.['真实姓名']),学号:text(account?.['学号'])};
  return PLACE_PROFILE_COLUMNS.some(key=>text(place[key])!==fields[key])?[{rowId:place._id,fields}]:[];
 });
}

export async function syncPlaceProfiles(base,identity){
 const metadata=await base.getMetadata(),table=metadata.tables.find(t=>t.name===PLACE_TABLE);
 // Additive schema is installed separately before rollout. No automatic schema writes.
 if(!table||!PLACE_PROFILE_COLUMNS.every(name=>table.columns.some(c=>c.name===name&&c.type==='text')))return {skipped:true,changed:0};
 const places=await rows(base,PLACE_TABLE),registrations=await rows(base,REGISTRATION_TABLE);
 const ids=[...new Set(registrations.filter(r=>places.some(p=>p['报名ID']===r['报名ID'])).map(r=>text(r['账号ID'])).filter(Boolean))];
 const accounts=[];
 for(let start=0;start<ids.length;start+=50){
  const literals=ids.slice(start,start+50).map(id=>`'${id.replace(/'/g,"''")}'`).join(',');
  // Only these three approved profile cells leave the private identity Base.
  const batch=await identity.query(`SELECT \`账号ID\`, \`真实姓名\`, \`学号\` FROM \`平台账号表\` WHERE \`账号ID\` IN (${literals}) LIMIT 1000`);
  if(!Array.isArray(batch)||batch.length>=1000||batch.readMeta?.truncated)throw invalid();
  accounts.push(...batch);
 }
 const plan=placeProfilePlan(places,registrations,accounts);
 await updateRows(base,PLACE_TABLE,plan);
 if(plan.length){
  const after=new Map((await rows(base,PLACE_TABLE)).map(row=>[row._id,row]));
  if(plan.some(change=>PLACE_PROFILE_COLUMNS.some(key=>text(after.get(change.rowId)?.[key])!==change.fields[key])))throw invalid();
 }
 return {changed:plan.length,places:places.length,matchedAccounts:accounts.length};
}
