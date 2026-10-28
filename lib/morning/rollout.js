import { MORNING_SCHEMA } from './schema.js';
export const MORNING_PRODUCTION_BASE = '076b49ed-6f04-4ea6-8799-1b9ad71dba88';
export function inspectMorningSchema(metadata) {
 const tables=new Map((metadata?.tables||[]).map(table=>[table.name,table]));
 const checks=MORNING_SCHEMA.map(({name,columns})=>{
  const table=tables.get(name);
  const existing=new Map((table?.columns||[]).map(column=>[column.name,column]));
  const invalidColumns=columns.filter(name=>existing.has(name)&&existing.get(name).type!=='text')
   .map(name=>({name,expected:'text',actual:existing.get(name).type??null}));
  return {name,exists:Boolean(table),missingColumns:columns.filter(name=>!existing.has(name)),invalidColumns};
 });
 return {ready:checks.every(c=>c.exists&&!c.missingColumns.length&&!c.invalidColumns.length),checks};
}

export function planMorningSchema(metadata) {
 const tables=new Map((metadata?.tables||[]).map(table=>[table.name,table]));
 return MORNING_SCHEMA.map(({name,columns})=>{
  const table=tables.get(name);
  for(const column of table?.columns||[])if(columns.includes(column.name)&&column.type!=='text')throw new Error('morning_column_type_mismatch');
  return {name,create:!table,columns:columns.filter(name=>!table?.columns.some(c=>c.name===name))};
 });
}
