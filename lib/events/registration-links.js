import {REGISTRATION_TABLE,REGISTRATION_LINKS} from './registration-schema.js';
const sameIdentity=(a,b)=>['账号ID','学号','姓名'].every(key=>a[key]&&String(a[key])===String(b[key]));
export function registrationLinkTargets(row,data){
 const exactly=(items,label)=>{if(items.length>1)throw new Error(`Duplicate website ${label} binding`);return items[0]?._id||null;};
 const event=exactly((data.events||[]).filter(e=>e['活动ID']===row['活动ID']&&!String(e._id).startsWith('BS-')),'event');
 const check=exactly((data.checkins||[]).filter(c=>c._id===row['签到行ID']&&c['报名行ID']===row._id&&c['活动ID']===row['活动ID']&&sameIdentity(c,row)),'checkin');
 if(row['签到行ID']&&!check)throw new Error('Website checkin binding mismatch');
 const ledger=(data.ledger||[]).filter(c=>c['报名行ID']===row._id&&c['活动ID']===row['活动ID']&&sameIdentity(c,row)).map(c=>c._id);
 const profile=exactly((data.profiles||[]).filter(p=>sameIdentity(p,row)),'profile');
 return {'活动名称2':event?[event]:[],'签到表':check?[check]:[],'时长明细':ledger,'个人主页':profile?[profile]:[]};
}

/** Optional table-navigation links never turn an already-saved signup into a false failure. */
export async function syncRegistrationLinks(base,metadata,row,data){
 const table=metadata?.tables?.find(t=>t.name===REGISTRATION_TABLE);
 if(!table?.columns?.some(c=>c.name==='关联状态')||typeof base.updateLink!=='function')return;
 let status='已关联';
 try{
  const targets=registrationLinkTargets(row,data);
  for(const definition of REGISTRATION_LINKS){
   const c=table.columns.find(c=>c.name===definition.name&&c.type==='link');
   const target=metadata.tables.find(t=>t.name===definition.target);
   if(!c?.data?.link_id||!target||![c.data.table_id,c.data.other_table_id].includes(target._id))throw Error('Website link schema mismatch');
   const ids=targets[definition.name];
   const old=(row[definition.name]||[]).map(v=>typeof v==='string'?v:v.row_id);
   if(JSON.stringify([...old].sort())!==JSON.stringify([...ids].sort()))await base.updateLink(c.data.link_id,REGISTRATION_TABLE,definition.target,row._id,ids);
  }
 }catch{status='关联待核对';}
 if(row['关联状态']!==status)try{await base.updateRow(REGISTRATION_TABLE,row._id,{关联状态:status});row['关联状态']=status;}catch{/* Core registration remains durable. */}
 return status;
}
