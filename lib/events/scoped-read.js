import {displayRead} from '../http/display-reads.js';
import {readPagedRows} from '../http/paged-rows.js';

// Identifiers are fixed by the caller; values are quoted, never interpolated raw.
const quote=value=>`'${String(value).replace(/'/g,"''")}'`;
export async function scopedRows(base,table,ids,columns='*') {
  const unique=[...new Set(ids)];
  if(!unique.length)return [];
  return displayRead(base,JSON.stringify(['scopedRows',table,unique,columns]),async()=>{
    // In-memory fixtures have no SQL transport.
    if(!base.query)return (await readPagedRows(base,table,{pageSize:1000,maxRows:100000,requireComplete:true})).filter(r=>unique.includes(r['活动ID']));
    const rows=[];
    for(let start=0;start<unique.length;start+=100){
      const where=unique.slice(start,start+100).map(quote).join(',');
      for(let offset=0;offset<100000;offset+=1000){
        const batch=await base.query(`SELECT ${columns} FROM \`${table}\` WHERE \`活动ID\` IN (${where}) LIMIT 1000 OFFSET ${offset}`);
        if(!Array.isArray(batch)||batch.length>1000)throw new Error('活动记录查询失败');
        rows.push(...batch);
        if(batch.length<1000)break;
        if(offset===99000)throw new Error('活动记录超过读取上限');
      }
    }
    return rows;
  },5_000,[table]);
}
