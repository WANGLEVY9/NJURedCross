/** Additive migration, explicit fingerprint and private backup. Never sends mail. */
import {Base} from 'seatable-api';
import {mkdir,writeFile} from 'node:fs/promises';
import {isAbsolute,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createSeaTableAccess} from '../lib/seatable-auth.js';
import {workflowMode} from '../lib/events/workflow-mode.js';
import {WF} from '../lib/events/workflow.js';
import {normalizeRegistration} from '../lib/events/registration-schema.js';
import {readPagedRows} from '../lib/http/paged-rows.js';
import {PLACE_TABLE,PLACE_COLUMNS,placePlan,createOrdinaryPlaces} from '../lib/events/ordinary-places.js';
import {NOTIFICATION_TABLE,NOTIFICATION_COLUMNS} from '../lib/events/registration-notifications.js';
import {rosterMailKey,rosterReview} from '../public/app/shared/roster-review.js';
const args=process.argv.slice(2),option=n=>args.find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3);
try{
 const config=workflowMode(process.env),base=new Base({server:process.env.SEATABLE_SERVER_URL,APIToken:process.env.SEATABLE_VOLUNTEER_API_TOKEN});await createSeaTableAccess(base)();if(base.dtableUuid!==config.expected)throw Error('Wrong Base');
 const metadata=await base.getMetadata(),rows=t=>readPagedRows(base,t,{maxRows:100000,requireComplete:true});
 const events=await rows(WF.events),rawRegistrations=await rows(WF.registrations),registrations=rawRegistrations.map(normalizeRegistration);
 const existing=metadata.tables.some(t=>t.name===PLACE_TABLE)?await rows(PLACE_TABLE):[];
 const tasks=metadata.tables.some(t=>t.name===NOTIFICATION_TABLE)?await rows(NOTIFICATION_TABLE):[];
 const plan=placePlan(events,registrations,existing),digest=createHash('sha256').update(JSON.stringify({events,rawRegistrations,existing,tasks})).digest('hex');
 console.log(JSON.stringify({environment:config.mode,baseVerified:true,digest,placeChanges:plan.length,currentPlaces:existing.length,registrations:registrations.length,emails:0}));
 if(args.includes('--apply')){
  if(option('confirm')!=='REGISTRATION-OPERATIONS'||option('digest')!==digest||!isAbsolute(option('backup')||''))throw Error('Explicit confirmation, current digest and absolute private backup required');
  const directory=resolve(option('backup'));await mkdir(directory,{recursive:false,mode:0o700});
  await writeFile(resolve(directory,'before.json'),JSON.stringify({metadata,events,rawRegistrations,existing,tasks}),{mode:0o600});
  for(const [name,columns] of [[PLACE_TABLE,PLACE_COLUMNS],[NOTIFICATION_TABLE,NOTIFICATION_COLUMNS]]){
   const table=metadata.tables.find(t=>t.name===name);
   if(table){if(columns.some(n=>!table.columns.some(c=>c.name===n&&c.type==='text')))throw Error('Incompatible existing operational schema');}
   else await base.addTable(name,'zh-cn',columns.map((name,index)=>({column_name:name,column_type:'text',anchor_column:index?columns[index-1]:''})));
  }
  // Baseline before activating the worker: existing confirmations do not receive surprise mail.
  if(!tasks.some(t=>t['幂等键']==='INIT:REGISTRATION-NOTIFICATIONS')){
   for(const row of registrations.filter(r=>['已确认','已签到'].includes(r['报名状态']))){
    const event=events.find(e=>e['活动ID']===row['活动ID']),published=rosterReview(event)?.published?.[row._id],key=rosterMailKey(row,published);
    if(!tasks.some(t=>t['幂等键']===key))await base.appendRow(NOTIFICATION_TABLE,{幂等键:key,报名ID:row['报名ID'],活动ID:row['活动ID'],状态:'历史未补发',尝试次数:'0',更新时间:new Date().toISOString()});
   }
   await base.appendRow(NOTIFICATION_TABLE,{幂等键:'INIT:REGISTRATION-NOTIFICATIONS',状态:'历史未补发',更新时间:new Date().toISOString()});
  }
  await createOrdinaryPlaces(base).reconcile(events,registrations);
  const after=await rows(WF.registrations);
  // SeaTable system timestamps may be reformatted after metadata/table changes.
  // Compare every business cell and row identity; retain original system cells in the private backup.
  const automatic=new Set(metadata.tables.find(t=>t.name===WF.registrations).columns.filter(c=>['mtime','ctime','last-modifier','creator','auto-number'].includes(c.type)).map(c=>c.name));
  for(const k of ['_mtime','_ctime','_last_modifier','_creator'])automatic.add(k);
  const business=items=>JSON.stringify(items.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>!automatic.has(key)).sort(([a],[b])=>a.localeCompare(b)))).sort((a,b)=>a._id.localeCompare(b._id)));
  if(business(after)!==business(rawRegistrations))throw Error('Registration business history changed during migration; stop and reconcile');
  await writeFile(resolve(directory,'after.json'),JSON.stringify({places:await rows(PLACE_TABLE),tasks:await rows(NOTIFICATION_TABLE)}),{mode:0o600});
  console.log(JSON.stringify({applied:true,places:(await rows(PLACE_TABLE)).length,registrationHistoryUntouched:true,emails:0}));
 }
}catch{console.error('Registration operations migration stopped. Credentials and business rows omitted. Inspect private backup before retry.');process.exitCode=1;}
