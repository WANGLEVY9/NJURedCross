/** Guarded native-type migration. Operational backups contain personal data and stay private. */
import {Base} from 'seatable-api';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,isAbsolute} from 'node:path';
import {createSeaTableAccess} from '../lib/seatable-auth.js';
import {workflowMode} from '../lib/events/workflow-mode.js';
import {createWorkflow,WF} from '../lib/events/workflow.js';
import {readPagedRows} from '../lib/http/paged-rows.js';
import {normalizeRegistration,REGISTRATION_TABLE,REGISTRATION_COLUMNS} from '../lib/events/registration-schema.js';
import {syncRegistrationLinks,registrationLinkTargets} from '../lib/events/registration-links.js';
import {migrationPlan,applyMigration,modifyColumn,migrationDigest,LEDGER_REQUIRED_ADDITIONS} from '../lib/events/registration-migration.js';
import {ORDINARY_GROUP_TABLE,ordinaryConfig} from '../lib/events/ordinary-groups.js';
const args=process.argv.slice(2),arg=name=>args.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const apply=args.includes('--apply');let base,backup,stage='configuration',oldMetadata,oldRows,changed=false;
const originalClassification=[];
const rows=table=>readPagedRows(base,table,{maxRows:100000,requireComplete:true});
const fingerprint=(metadata,data,groups)=>migrationDigest({schema:metadata.tables.filter(t=>[REGISTRATION_TABLE,'活动报名总表',ORDINARY_GROUP_TABLE,...Object.values(WF)].includes(t.name)).map(t=>({name:t.name,columns:t.columns.map(c=>({key:c.key,name:c.name,type:c.type,data:c.data}))})),rows:data,groups});
try{
 const config=workflowMode(process.env);base=new Base({server:process.env.SEATABLE_SERVER_URL,APIToken:process.env.SEATABLE_VOLUNTEER_API_TOKEN});await createSeaTableAccess(base)();if(base.dtableUuid!==config.expected)throw Error();
 stage='read full schema and rows';oldMetadata=await base.getMetadata();oldRows=await rows(REGISTRATION_TABLE);
 const workflow=createWorkflow(base,{mode:config.mode,bloodSourceTable:config.bloodSourceTable});
 const events=(await workflow.publicRead()).events;
 const groups=oldMetadata.tables.some(t=>t.name===ORDINARY_GROUP_TABLE)?await rows(ORDINARY_GROUP_TABLE):[];
 const classification=[];
 if(args.includes('--classify-current-programmes')){
  const matches=groups.filter(g=>g['活动名称']==='献血周志愿服务活动');if(matches.length!==1)throw Error('Programme identification ambiguous');
  const group=matches[0],sessions=events.filter(e=>ordinaryConfig(e)?.groupId===group['活动组ID']);if(sessions.length!==16)throw Error('Programme session count changed');
  for(const e of sessions){e['组织类别']='主席团';e['活动地区']='南京地区';classification.push({table:WF.events,id:e._id,values:{组织类别:'主席团',活动地区:'南京地区'}});}
  classification.push({table:ORDINARY_GROUP_TABLE,id:group._id,values:{组织类别:'主席团',活动地区:'南京地区'}});
 }
 const profileTable=oldMetadata.tables.find(t=>t.name==='个人主页（编辑版）'),profiles=[];
 if(profileTable&&typeof base.query==='function'){
  const columns=['学号','姓名','部门','性别','年级','手机号','QQ','急救证'].filter(name=>profileTable.columns.some(c=>c.name===name));
  for(const sid of [...new Set(oldRows.map(r=>r['学号']))].filter(v=>/^\d{6,20}$/.test(v))){
   const found=await base.query(`SELECT ${columns.map(c=>'`'+c+'`').join(',')} FROM \`个人主页（编辑版）\` WHERE \`学号\` = '${sid}' LIMIT 3`);
   if(!Array.isArray(found))throw Error();profiles.push(...found);
  }
 }
 const plan=migrationPlan(oldMetadata,oldRows,events,profiles),digest=fingerprint(oldMetadata,oldRows,groups);
 stage='preflight website bindings';const bindingData={events,checkins:await rows(WF.checkins),ledger:await rows(WF.ledger),profiles:await rows(WF.profiles)};
 for(const row of oldRows)registrationLinkTargets(normalizeRegistration(row),bindingData);
 console.log(JSON.stringify({mode:apply?'apply':'preview',baseVerified:true,environment:config.mode,table:REGISTRATION_TABLE,rows:oldRows.length,digest,
  categories:Object.fromEntries([...new Set(plan.rows.map(r=>r.values['活动类别']))].map(value=>[value,plan.rows.filter(r=>r.values['活动类别']===value).length])),
  columns:plan.columns.map(c=>({name:c.name,type:c.type,action:c.action,options:c.data.options?.map(o=>o.name),format:c.data.format})),
  links:['活动名称2','签到表','时长明细','个人主页'],classificationRows:classification.length,hoursReviewMissing:LEDGER_REQUIRED_ADDITIONS.filter(name=>!oldMetadata.tables.find(t=>t.name===WF.ledger)?.columns.some(c=>c.name===name)),legacyTableWrites:0,mailSends:0}));
 if(!apply)process.exit(0);
 if(arg('confirm')!=='MIGRATE-WEBSITE-REGISTRATIONS'||arg('expect-digest')!==digest||!arg('backup-dir')||!isAbsolute(arg('backup-dir')))throw Error();
 backup=resolve(arg('backup-dir'));if(backup==='/'||backup.startsWith(resolve(process.cwd())+'/'))throw Error();
 stage='private backup';await mkdir(backup,{mode:0o700});
 const related=Object.fromEntries(await Promise.all([...new Set([...Object.values(WF),ORDINARY_GROUP_TABLE])].filter(t=>t!==REGISTRATION_TABLE&&oldMetadata.tables.some(x=>x.name===t)).map(async t=>[t,await rows(t)])));
 for(const c of classification){const original=related[c.table]?.find(r=>r._id===c.id);if(!original)throw Error();originalClassification.push({table:c.table,id:c.id,values:Object.fromEntries(Object.keys(c.values).map(k=>[k,original[k]??null]))});}
 await writeFile(resolve(backup,'before.json'),JSON.stringify({baseUuid:base.dtableUuid,at:new Date().toISOString(),metadata:oldMetadata,registrations:oldRows,related,migrationValues:plan.rows},null,2),{mode:0o600,flag:'wx'});
 if(fingerprint(await base.getMetadata(),await rows(REGISTRATION_TABLE),await rows(ORDINARY_GROUP_TABLE))!==digest)throw Error();
 stage='native types and formats';changed=true;const after=await applyMigration(base,plan,oldMetadata);
 stage='confirmed programme classification';for(const change of classification)await base.updateRow(change.table,change.id,change.values);
 stage='website-only links';const data={events:await rows(WF.events),checkins:await rows(WF.checkins),ledger:await rows(WF.ledger),profiles:await rows(WF.profiles)};
 for(const row of await rows(REGISTRATION_TABLE)){if(await syncRegistrationLinks(base,after,normalizeRegistration(row),data)==='关联待核对')throw Error();}
 stage='verify every cell';const actual=await rows(REGISTRATION_TABLE);if(actual.length!==oldRows.length||new Set(actual.map(r=>r._id)).size!==oldRows.length)throw Error();
 for(const table of [...new Set(classification.map(c=>c.table))]){const actual=await rows(table);for(const c of classification.filter(c=>c.table===table)){const row=actual.find(r=>r._id===c.id);if(!row||Object.entries(c.values).some(([k,v])=>row[k]!==v))throw Error('Classification verification failed');}}
 for(const expected of plan.rows){const a=normalizeRegistration(actual.find(r=>r._id===expected._id)),e=normalizeRegistration(expected.values);for(const key of Object.keys(expected.values))if(JSON.stringify(a[key])!==JSON.stringify(e[key])){stage=`verify cell: ${key}`;throw Error();}}
 await writeFile(resolve(backup,'after.json'),JSON.stringify({baseUuid:base.dtableUuid,at:new Date().toISOString(),metadata:await base.getMetadata(),registrations:actual},null,2),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({verified:true,rows:actual.length,columns:REGISTRATION_COLUMNS.length+4,backup,legacyTableWrites:0,mailSends:0}));
}catch(error){
 console.error(JSON.stringify({migrationFailed:true,stage,httpStatus:error.response?.status||null,backup:backup||null,rawErrorsSuppressed:true}));process.exitCode=1;
 if(changed&&base&&oldRows&&oldMetadata){
  try{
   for(const old of oldMetadata.tables.find(t=>t.name===REGISTRATION_TABLE).columns){const current=(await base.getMetadata()).tables.find(t=>t.name===REGISTRATION_TABLE).columns.find(c=>c.name===old.name);if(current&&current.type!==old.type)await modifyColumn(base,REGISTRATION_TABLE,current,old,old.data||{});}
   const writable=oldMetadata.tables.find(t=>t.name===REGISTRATION_TABLE).columns.filter(c=>!['auto-number','mtime','ctime','last-modifier','link','link-formula'].includes(c.type)).map(c=>c.name);
   for(const row of oldRows)await base.updateRow(REGISTRATION_TABLE,row._id,Object.fromEntries(Object.entries(row).filter(([k])=>writable.includes(k))));
   for(const c of originalClassification)await base.updateRow(c.table,c.id,c.values);
   const restored=await rows(REGISTRATION_TABLE);if(restored.length!==oldRows.length)throw Error();
   for(const old of oldRows){const actual=restored.find(r=>r._id===old._id);for(const key of writable)if(JSON.stringify(actual[key]??null)!==JSON.stringify(old[key]??null))throw Error();}
   console.error(JSON.stringify({originalRowsRestored:true,newAdditiveColumnsRetained:true}));
  }catch{console.error(JSON.stringify({restoreNeedsAttention:true,backup}));}
 }
}
