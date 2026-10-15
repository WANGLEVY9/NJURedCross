/** Website-only taxonomy migration. Preview by default; personal-data backups stay private. */
import {Base} from 'seatable-api';
import {mkdir,writeFile} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {createSeaTableAccess} from '../lib/seatable-auth.js';
import {workflowMode} from '../lib/events/workflow-mode.js';
import {readPagedRows} from '../lib/http/paged-rows.js';
import {workflowApprovalHash,workflowEventApproved,WF} from '../lib/events/workflow.js';
import {workflowConfig} from '../lib/events/blood-roster.js';
import {ACTIVITY_CATEGORY_OPTIONS,activityKind} from '../public/app/shared/activity-taxonomy.js';
import {ORDINARY_GROUP_TABLE} from '../lib/events/ordinary-groups.js';
import {modifyColumn,migrationDigest} from '../lib/events/registration-migration.js';
const args=process.argv.slice(2),arg=k=>args.find(x=>x.startsWith(`--${k}=`))?.slice(k.length+3),apply=args.includes('--apply');
let stage='configuration',base,before,plan=[],changed=false,backup;
try{
 const config=workflowMode(process.env);base=new Base({server:process.env.SEATABLE_SERVER_URL,APIToken:process.env.SEATABLE_VOLUNTEER_API_TOKEN});await createSeaTableAccess(base)();if(base.dtableUuid!==config.expected)throw Error();
 const targets=[[WF.events,'组织类别'],[WF.registrations,'活动类别'],[ORDINARY_GROUP_TABLE,'组织类别']];
 const read=async()=>{stage='read metadata';const metadata=await base.getMetadata(),rows={};for(const [table]of targets){stage=`read ${table}`;rows[table]=await readPagedRows(base,table,{maxRows:100000,requireComplete:true});}return {metadata,rows};};
 stage='preview';before=await read();const fingerprint=migrationDigest(before);
 for(const [table,column]of targets){
  stage=`plan ${table}.${column}`;
  const schema=before.metadata.tables.find(t=>t.name===table),old=schema?.columns.find(c=>c.name===column);if(!old||!['text','single-select'].includes(old.type))throw Error();
  const options=ACTIVITY_CATEGORY_OPTIONS.map(name=>{const previous=old.data?.options?.find(o=>activityKind({center:o.name})===name);return {id:previous?.id||migrationDigest([column,name]).slice(0,8),name,color:previous?.color||'#FFDDE5',textColor:previous?.textColor||'#212529'};});
  const changes=before.rows[table].flatMap(row=>{
   const raw=row[column]||'',canonical=activityKind({center:raw}),value=ACTIVITY_CATEGORY_OPTIONS.includes(canonical)?canonical:'';
   const patch={};if(raw!==value){patch[column]=value;if(raw&&!value)patch['历史活动类别']=raw;}
   if(table===WF.events){
    const c=workflowConfig(row),oldJson=JSON.stringify(c);
    if(c.center){const name=activityKind({center:c.center});c.center=ACTIVITY_CATEGORY_OPTIONS.includes(name)?name:'';}
    // Preserve assigned people and submitted time; only rename an unambiguous alias.
    if(c.approval?.category){const name=activityKind({center:c.approval.category});if(ACTIVITY_CATEGORY_OPTIONS.includes(name))c.approval.category=name;}
    if(JSON.stringify(c)!==oldJson)patch['报名页配置']=JSON.stringify(c);
    if(Object.keys(patch).length&&workflowEventApproved(row))patch['批准摘要']=workflowApprovalHash({...row,...patch});
   }
   return Object.keys(patch).length?[{id:row._id,patch}]:[];
  });
  plan.push({table,column,old,options,changes,addHistory:changes.some(x=>x.patch['历史活动类别'])&&!schema.columns.some(c=>c.name==='历史活动类别')});
 }
 console.log(JSON.stringify({mode:apply?'apply':'preview',digest:fingerprint,baseVerified:true,plan:plan.map(p=>({table:p.table,rows:before.rows[p.table].length,changes:p.changes.length,addHistory:p.addHistory,options:p.options.map(o=>o.name)})),mailSends:0,legacyTableWrites:0}));
 if(apply){
  backup=arg('backup-dir');if(arg('confirm')!=='MIGRATE-ACTIVITY-CATEGORIES'||arg('expect-digest')!==fingerprint||!backup||!isAbsolute(backup)||backup==='/'||backup.startsWith(process.cwd()+'/'))throw Error();
  stage='backup';await mkdir(backup,{mode:0o700});await writeFile(join(backup,'before.json'),JSON.stringify(before),{mode:0o600,flag:'wx'});
  if(migrationDigest(await read())!==fingerprint)throw Error();
  for(const p of plan){
   stage=`migrate ${p.table}`;
   changed=true;
   if(p.addHistory)await base.insertColumn(p.table,'历史活动类别','text','');
   // Rename compatible option IDs first; archive unclassified values before pruning.
   for(const change of p.changes)if(change.patch['历史活动类别'])await base.updateRow(p.table,change.id,{'历史活动类别':change.patch['历史活动类别']});
   await modifyColumn(base,p.table,p.old,{type:'single-select'},{options:p.options,enable_fill_default_value:false,default_value:''});
   for(const change of p.changes)await base.updateRow(p.table,change.id,change.patch);
  }
  stage='verify';const after=await read();
  for(const p of plan){
   const original=before.rows[p.table],actual=after.rows[p.table];if(original.length!==actual.length)throw Error();
   if(JSON.stringify(after.metadata.tables.find(t=>t.name===p.table).columns.find(c=>c.name===p.column).data.options.map(o=>o.name))!==JSON.stringify(ACTIVITY_CATEGORY_OPTIONS))throw Error();
   const derived=new Set(before.metadata.tables.find(t=>t.name===p.table).columns.filter(c=>['mtime','last-modifier','formula','link-formula'].includes(c.type)).map(c=>c.name));
   for(const row of original){const result=actual.find(r=>r._id===row._id),patch=p.changes.find(c=>c.id===row._id)?.patch||{};if(!result)throw Error();for(const [key,value]of Object.entries({...row,...patch})){if(key.startsWith('_')||derived.has(key))continue;if(JSON.stringify(result[key]??'')!==JSON.stringify(value??'')){stage=`verify ${p.table}.${key}`;throw Error();}}}
  }
  await writeFile(join(backup,'after.json'),JSON.stringify(after),{mode:0o600,flag:'wx'});console.log(JSON.stringify({verified:true,backup,legacyTableWrites:0,mailSends:0}));
 }
}catch(error){
 console.error(JSON.stringify({failed:true,stage,status:error?.response?.status||error?.statusCode,code:error?.code,backup,rawErrorsSuppressed:true}));process.exitCode=1;
 if(changed){try{
  for(const p of plan){await modifyColumn(base,p.table,p.old,p.old,p.old.data||{});for(const old of before.rows[p.table]){const patch=p.changes.find(c=>c.id===old._id)?.patch||{};const keys=new Set([p.column,...Object.keys(patch).filter(k=>k!=='历史活动类别')]);await base.updateRow(p.table,old._id,Object.fromEntries([...keys].map(k=>[k,old[k]??null])));}}
  for(const p of plan){const actual=await readPagedRows(base,p.table,{maxRows:100000,requireComplete:true});if(actual.length!==before.rows[p.table].length)throw Error();for(const old of before.rows[p.table]){const row=actual.find(r=>r._id===old._id);for(const key of [p.column,'报名页配置','批准摘要'])if((old[key]??'')!==(row?.[key]??''))throw Error();}}
  console.error(JSON.stringify({originalValuesRestored:true,additiveHistoryColumnRetained:true}));
 }catch{console.error(JSON.stringify({restoreNeedsAttention:true,backup}));}}
}
