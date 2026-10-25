import {assertRequestActive} from './request-budget.js';
import {readPagedRows} from './paged-rows.js';

const identifier=value=>`\`${String(value).replace(/`/g,'``')}\``;
const quote=value=>`'${String(value).replace(/'/g,"''")}'`;

/** Server-owned table/column names; bounded, fresh, exact-value reads. */
export async function rowsByValues(client,table,column,values,columns='*'){
 const unique=[...new Set(values)];
 if(!unique.length)return [];
 // Memory fixtures and older non-SQL adapters only; never fall back on SQL errors.
 if(!client.query)return (await readPagedRows(client,table,{pageSize:1000,maxRows:100000,requireComplete:true})).filter(row=>unique.includes(row[column]));
 const rows=[];
 for(let start=0;start<unique.length;start+=100){
  const where=unique.slice(start,start+100).map(quote).join(',');
  for(let offset=0;offset<100000;offset+=1000){
   assertRequestActive();
   const batch=await client.query(`SELECT ${columns} FROM ${identifier(table)} WHERE ${identifier(column)} IN (${where}) LIMIT 1000 OFFSET ${offset}`);
   assertRequestActive();
   if(!Array.isArray(batch)||batch.length>1000||batch.readMeta?.truncated||batch.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error('条件查询失败或数据不完整');
   rows.push(...batch);
   if(batch.length<1000)break;
   if(offset===99000)throw new Error('条件查询超过读取上限');
  }
 }
 return rows;
}
