import {createHash} from 'node:crypto';
import {REGISTRATION_TABLE,REGISTRATION_COLUMNS,REGISTRATION_LINKS,registrationDetails,typedCell,cellText,normalizeRegistration,certificateValue} from './registration-schema.js';
import {activityKind} from '../../public/app/shared/activity-taxonomy.js';

export const MIGRATION_VERSION='registration-types-v1';
export const EVENT_TAXONOMY_COLUMNS=[
 {name:'组织类别',type:'single-select',options:REGISTRATION_COLUMNS.find(c=>c.name==='活动类别').options},
 {name:'活动地区',type:'single-select',options:['南京地区','苏州地区']},
];
export const LEDGER_REQUIRED_ADDITIONS=['工作内容','核对摘要','退回原因','具体工作地点','正式工作日期','备注','修订人','修订时间'];
export const migrationDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function columnData(definition,legacy,rows=[]){
 if(definition.type!=='single-select')return {...(definition.name==='是否报名成功'?{checkbox_style:legacy?.columns?.find(c=>c.name===definition.name)?.data?.checkbox_style||{color:'#FF8000',type:'check'}}:{}),...(definition.data||{})};
 const source=legacy?.columns?.find(c=>c.name===definition.name);
 const oldOptions=source?.data?.options||source?.data?.array_data?.options||[];
 const safe=oldOptions.filter(o=>typeof o.name==='string'&&o.name.trim()&&!/\d{6,}|@/.test(o.name)&&!(definition.name==='报名时段'&&/[-~–]\s*$/.test(o.name)));
 const names=definition.options.length?definition.options:[...safe.map(o=>o.name),...rows.map(r=>cellText(r[definition.name]).trim()).filter(Boolean)];
 return {options:[...new Set(names)].map(name=>{
  const old=safe.find(o=>o.name===name);return {id:old?.id||migrationDigest([definition.name,name]).slice(0,8),name,color:old?.color||'#FFDDE5',textColor:old?.textColor||'#212529'};
 }),enable_fill_default_value:false,default_value:''};
}

export async function modifyColumn(base,table,column,definition,data){
 // Official update-column operation; column_data supplies format alongside the type.
 const gateway=base.apiGateway;
 const req=gateway?.req||base.req;
 if(!req?.put)throw new Error('Column transport unavailable');
 return req.put(`${gateway?'/api/v2':'/api/v1'}/dtables/${base.dtableUuid}/columns/`,{
  op_type:'modify_column_type',table_name:table,column:column.key,new_column_type:definition.type,column_data:data,
 });
}

export function migrationRows(rows,events,profiles=[],{legacyCategory=true}={}){
 return rows.map(input=>{
  const row=normalizeRegistration(input);
  const event=events.find(e=>e['活动ID']===row['活动ID']);
  if(!event)throw new Error('Registration event binding missing');
  const details=registrationDetails(event);
  const patch={...row};
  for(const [name,v]of Object.entries(details))if((!Object.hasOwn(row,name)||legacyCategory&&!row[name])&&!['部门','性别','年级','电话','QQ号','急救证','资料来源'].includes(name))patch[name]=v;
  if(legacyCategory){const existingKind=activityKind({type:row['活动类别']});patch['活动类别']=existingKind!=='未分类'?existingKind:details['活动类别'];patch['活动类型']=row['活动类型']||(existingKind!=='未分类'?event['活动类别']:row['活动类别'])||event['活动类别']||'';}
  // Add only missing contact/qualification fields. Never overwrite historical identity/campus/department snapshots.
  const matches=profiles.filter(p=>cellText(p['学号']).trim()===row['学号']&&cellText(p['姓名']).trim()===row['姓名']);
  if(matches.length===1&&!row['资料来源']){
   const p=matches[0],values={部门:p['部门'],性别:p['性别'],年级:p['年级'],电话:p['手机号'],QQ号:p['QQ'],急救证:certificateValue(p['急救证'])};
   for(const [name,v]of Object.entries(values))if(!row[name]&&v!==null&&v!==undefined)patch[name]=cellText(v);
   if(!row['资料来源']){patch['资料来源']='个人主页（编辑版）精确匹配补录';patch['资料补录时间']=new Date(Math.floor(Date.now()/60000)*60000).toISOString();}
  }
  for(const name of ['创建时间','请假申请时间','签到提交时间'])if(row[name])patch[`${name}原值`]=row[name];
  return {_id:row._id,values:Object.fromEntries(REGISTRATION_COLUMNS.filter(c=>!['auto-number','mtime','last-modifier','ctime','image'].includes(c.type))
   .filter(c=>Object.hasOwn(patch,c.name)).map(c=>[c.name,typedCell(c,patch[c.name])]))};
 });
}

export function migrationPlan(metadata,rows,events,profiles=[]){
 const table=metadata.tables.find(t=>t.name===REGISTRATION_TABLE);if(!table)throw new Error('Registration table missing');
 const legacy=metadata.tables.find(t=>t.name==='活动报名总表');if(!legacy)throw new Error('Legacy options missing');
 const desired=migrationRows(rows,events,profiles,{legacyCategory:table.columns.find(c=>c.name==='活动类别')?.type==='text'});
 const columns=REGISTRATION_COLUMNS.map(definition=>{
  const current=table.columns.find(c=>c.name===definition.name);
  if(current&&current.type!=='text'&&current.type!==definition.type)throw new Error('Unexpected existing column type');
  const data=columnData(definition,legacy,[...desired.map(r=>r.values),...events.map(e=>({报名时段:e['报名时段'],岗位:e['岗位']}))]);
  if(definition.type==='single-select')for(const row of desired){const v=row.values[definition.name];if(v&&!data.options.some(o=>o.name===v))throw new Error('Unsupported select value');}
  const oldWidth=legacy.columns.find(c=>c.name===definition.name)?.width;
  const width=Math.round(Math.max(100,Math.min(320,oldWidth||(['number','checkbox','auto-number'].includes(definition.type)?120:definition.type==='date'?180:200))));
  const formatMismatch=current&&current.type===definition.type&&['date','number'].includes(definition.type)&&['format','precision','enable_precision'].some(k=>Object.hasOwn(data,k)&&current.data?.[k]!==data[k]);
  return {name:definition.name,type:definition.type,action:!current?'add':current.type!==definition.type?'convert':formatMismatch?'configure':'keep',key:current?.key,data,width};
 });
 for(const link of REGISTRATION_LINKS){if(!metadata.tables.find(t=>t.name===link.target))throw new Error('Related website table missing');const current=table.columns.find(c=>c.name===link.name);if(current&&current.type!=='link')throw new Error('Unexpected link type');}
 return {columns,rows:desired,legacyTableWrites:0,table:REGISTRATION_TABLE,version:MIGRATION_VERSION};
}

export async function applyMigration(base,plan,metadata){
 const step=async(label,task)=>{try{return await task();}catch(error){error.migrationOperation=label;throw error;}};
 for(const column of plan.columns){
  if(column.action==='add')await step(`add ${column.name}`,()=>base.insertColumn(REGISTRATION_TABLE,column.name,column.type,'',column.data));
  else if(['convert','configure'].includes(column.action))await step(`convert ${column.name}`,()=>modifyColumn(base,REGISTRATION_TABLE,{key:column.key},column,column.data));
  else if(column.type==='single-select'){
   const existing=metadata.tables.find(t=>t.name===REGISTRATION_TABLE).columns.find(c=>c.name===column.name);
   const missing=column.data.options.filter(o=>!(existing.data?.options||[]).some(x=>x.name===o.name));
   if(missing.length)await base.addColumnOptions(REGISTRATION_TABLE,column.name,missing);
  }
 }
 // Type conversion may clear cells. Restore every validated value using native types.
 for(const row of plan.rows)await base.updateRow(REGISTRATION_TABLE,row._id,row.values);
 let after=await base.getMetadata();
 for(const link of REGISTRATION_LINKS){
  if(!after.tables.find(t=>t.name===REGISTRATION_TABLE).columns.some(c=>c.name===link.name)){
   const target=after.tables.find(t=>t.name===link.target);
   await base.insertColumn(REGISTRATION_TABLE,link.name,'link','',{table:REGISTRATION_TABLE,other_table:link.target,display_column_key:target.columns.find(c=>c.name===link.display)?.key||'0000'});
   after=await base.getMetadata();
  }
 }
 const actual=after.tables.find(t=>t.name===REGISTRATION_TABLE);
 if(plan.columns.some(c=>!actual.columns.some(a=>a.name===c.name&&a.type===c.type)))throw new Error('Type verification failed');
 for(const c of plan.columns){const a=actual.columns.find(a=>a.name===c.name);if(['date','number'].includes(c.type)&&['format','precision','enable_precision'].some(k=>Object.hasOwn(c.data,k)&&a.data?.[k]!==c.data[k]))throw new Error('Format verification failed');if(c.type==='single-select'&&c.data.options.some(o=>!a.data?.options?.some(x=>x.name===o.name&&x.id)))throw new Error('Select option verification failed');}
 for(const c of plan.columns){const existing=actual.columns.find(a=>a.name===c.name);if(existing.width!==c.width)await base.resizeColumn(REGISTRATION_TABLE,existing.key,c.width);}
 const ledger=after.tables.find(t=>t.name==='网站服务时长明细表');
 for(const name of LEDGER_REQUIRED_ADDITIONS){
  const c=ledger?.columns.find(c=>c.name===name);if(c&&c.type!=='text')throw new Error('Hours review schema mismatch');
  if(ledger&&!c)await base.insertColumn(ledger.name,name,'text','');
 }
 for(const tableName of ['网站活动流程表','网站普通活动项目表']){
  const table=after.tables.find(t=>t.name===tableName);if(!table)continue;
  for(const definition of EVENT_TAXONOMY_COLUMNS){
   const existing=table.columns.find(c=>c.name===definition.name);
   if(existing&&existing.type!==definition.type)throw new Error('Event taxonomy column mismatch');
   if(!existing)await base.insertColumn(tableName,definition.name,definition.type,'',columnData(definition,null));
  }
 }
 return base.getMetadata();
}
/** NJUTable can return system creation timestamps with or without milliseconds.
 * Compare at the lower reported precision, never ignore a changed second. */
export function migrationCellEqual(expected,actual,type){
 if(JSON.stringify(expected??'')===JSON.stringify(actual??''))return true;
 if(type!=='ctime'||typeof expected!=='string'||typeof actual!=='string')return false;
 const a=Date.parse(expected),b=Date.parse(actual);
 if(!Number.isFinite(a)||!Number.isFinite(b))return false;
 const precise=value=>/\.\d+(?:Z|[+-]\d{2}:\d{2})$/.test(value);
 return precise(expected)&&precise(actual)?a===b:Math.floor(a/1000)===Math.floor(b/1000);
}
