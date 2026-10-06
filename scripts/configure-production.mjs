/** Preview/apply additive schema only. Credentials come from server-side environment. */
import {Base} from 'seatable-api';
import {mkdir,writeFile} from 'node:fs/promises';
import {EVENT_SCHEMA,NOTICE_SCHEMA,STATE_SCHEMA,MATERIAL_SCHEMA} from '../lib/production-schema.js';
import {WISHLIST_SCHEMA} from '../lib/events/wishlist.js';
import {WORKFLOW_SCHEMA} from '../lib/events/workflow.js';
import {workflowMode} from '../lib/events/workflow-mode.js';
import {BLOOD_BOOKING_COLUMNS} from '../lib/events/blood-booking.js';
const MANAGEMENT_BASE='076b49ed-6f04-4ea6-8799-1b9ad71dba88';
const apply=process.argv.includes('--apply');
try{
 const config=workflowMode(process.env);if(config.mode!=='production'||process.env.SEATABLE_BUSINESS_BASE_UUID!==MANAGEMENT_BASE)throw Error('Production configuration mismatch');
 const clients=[];
 for(const [kind,token,uuid,definitions] of [['management',process.env.SEATABLE_API_TOKEN,MANAGEMENT_BASE,[...EVENT_SCHEMA,...NOTICE_SCHEMA,...STATE_SCHEMA,...MATERIAL_SCHEMA]],['volunteer',process.env.SEATABLE_VOLUNTEER_API_TOKEN,config.expected,[...WORKFLOW_SCHEMA,WISHLIST_SCHEMA,{name:config.bloodSourceTable,columns:BLOOD_BOOKING_COLUMNS,requireExisting:true}]]]){
  const base=new Base({server:process.env.SEATABLE_SERVER_URL||'https://table.nju.edu.cn',APIToken:token});await base.auth();if(base.dtableUuid!==uuid)throw Error('Base mismatch');
  const metadata=await base.getMetadata();const plan=definitions.map(d=>{const existing=metadata.tables.find(t=>t.name===d.name);if(d.requireExisting&&!existing)throw Error('Blood source missing');for(const column of d.columns){const [name,type]=Array.isArray(column)?column:[column,'text'];const c=existing?.columns.find(c=>c.name===name);if(c&&c.type!==type)throw Error('Website column type mismatch');}return {...d,create:!existing,columns:d.columns.filter(n=>!existing?.columns.some(c=>c.name===(Array.isArray(n)?n[0]:n)))};});
  console.log(JSON.stringify({kind,uuid,mode:apply?'apply':'preview',plan:plan.map(p=>({name:p.name,create:p.create,columns:p.columns})),historicalRowWrites:0}));clients.push({kind,base,metadata,plan,definitions});
 }
 if(!apply)process.exit(0);
 await mkdir('.private-identity-schema-backups',{recursive:true,mode:0o700});
 for(const {kind,base,metadata,plan,definitions} of clients){await writeFile(`.private-identity-schema-backups/production-${kind}-${Date.now()}.json`,JSON.stringify(metadata),{mode:0o600});for(const p of plan){if(p.create)await base.addTable(p.name,'zh-cn',p.columns.map((n,i)=>({column_name:Array.isArray(n)?n[0]:n,column_type:Array.isArray(n)?n[1]:'text',anchor_column:i?(Array.isArray(p.columns[i-1])?p.columns[i-1][0]:p.columns[i-1]):''})));else for(const n of p.columns)await base.insertColumn(p.name,Array.isArray(n)?n[0]:n,Array.isArray(n)?n[1]:'text','');}const after=await base.getMetadata();if(definitions.some(d=>d.columns.some(n=>!after.tables.find(t=>t.name===d.name)?.columns.some(c=>c.name===(Array.isArray(n)?n[0]:n)&&c.type===(Array.isArray(n)?n[1]:'text')))))throw Error('Schema verification failed');console.log(JSON.stringify({kind,verified:true}));}
}catch{console.error('Production configuration failed; SDK details suppressed');process.exitCode=1;}
