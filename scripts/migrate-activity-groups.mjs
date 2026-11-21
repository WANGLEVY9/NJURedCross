import {readFile,writeFile} from 'node:fs/promises';
import {isAbsolute,relative,resolve,sep} from 'node:path';
import {Base} from 'seatable-api';
import {assertCoordinatedMaintenance} from '../lib/maintenance/script-runner.js';
import {planActivityGroupMigration,applyActivityGroupCells} from '../lib/events/activity-group-migration.js';
import {WF} from '../lib/events/workflow.js';
import {TEST_WORKFLOW_BASE,workflowMode} from '../lib/events/workflow-mode.js';
import {ORDINARY_GROUP_TABLE} from '../lib/events/ordinary-groups.js';
import {readPagedRows} from '../lib/http/paged-rows.js';

const args=process.argv.slice(2);
const arg=name=>args.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const apply=args.includes('--apply'),rollback=args.includes('--rollback'),resume=args.includes('--resume');
assertCoordinatedMaintenance({write:apply||rollback||resume});
let stage='configuration';
try{
 if([apply,rollback,resume].filter(Boolean).length>1)throw Error();
 const env=workflowMode(process.env);
 if(!process.env.SEATABLE_VOLUNTEER_API_TOKEN||!process.env.SEATABLE_SERVER_URL)throw Error();
 if((apply||rollback||resume)&&(env.mode!=='test'||env.expected!==TEST_WORKFLOW_BASE||arg('confirm')!=='ACTIVITY-GROUP-TEST'))throw Error();
 const base=new Base({server:process.env.SEATABLE_SERVER_URL,APIToken:process.env.SEATABLE_VOLUNTEER_API_TOKEN});
 await base.auth();
 if(base.dtableUuid!==env.expected)throw Error();
 const metadata=await base.getMetadata(),table=metadata.tables.find(item=>item.name===WF.events);
 if(!table)throw Error();
 const column=table.columns.find(item=>item.name==='活动组ID');
 if(column&&column.type!=='text')throw Error();
 const deps={read:id=>base.getRow(WF.events,id),update:(id,patch)=>base.updateRow(WF.events,id,patch)};
 if(apply||rollback||resume){
  stage='check snapshot location';
  if(!isAbsolute(arg('snapshot')||''))throw Error();
  const file=resolve(arg('snapshot')),outside=relative(process.cwd(),file);
  if(!(isAbsolute(outside)||outside.startsWith('..'+sep)))throw Error();
  let snapshot;
  if(rollback||resume){
   stage='load original snapshot';
   snapshot=JSON.parse(await readFile(file,'utf8'));
   if(snapshot.baseUuid!==base.dtableUuid)throw Error();
  }else{
   stage='recheck selected rows';
   const planned=await scan();
   if(planned.issues.length||planned.digest!==arg('expect-digest'))throw Error();
   snapshot={...planned,baseUuid:base.dtableUuid};
   await writeFile(file,JSON.stringify(snapshot,null,2),{flag:'wx',mode:0o600});
  }
  if(!rollback){
   stage='verify project references';
   if(!Array.isArray(snapshot.bindings))throw Error();
   const projects=snapshot.bindings.length?await readPagedRows(base,ORDINARY_GROUP_TABLE,{maxRows:100000,requireComplete:true}):[];
   for(const [rowId,groupId] of snapshot.bindings){
    const matches=projects.filter(row=>row['活动组ID']===groupId);
    if(matches.length!==1||matches[0]._id!==rowId)throw Error();
   }
  }
  stage='verify schema';
  if(!column&&!rollback)await base.insertColumn(WF.events,'活动组ID','text','');
  const verified=(await base.getMetadata()).tables.find(t=>t.name===WF.events)?.columns.find(c=>c.name==='活动组ID'&&c.type==='text');
  if(!verified)throw Error();
  stage=rollback?'rollback cells':'write and verify cells';
  console.log(JSON.stringify({mode:rollback?'rollback':resume?'resume':'apply',...await applyActivityGroupCells(snapshot,{...deps,rollback})}));
 }else{
  stage='read-only scan';
  const plan=await scan();
  console.log(JSON.stringify({mode:'preview',environment:env.mode,scanned:plan.scanned,pending:plan.changes.length,issues:plan.issues,digest:plan.digest,columnExists:Boolean(column)}));
 }
 async function scan(){
  const rows=name=>readPagedRows(base,name,{maxRows:100000,requireComplete:true});
  const [events,groups]=await Promise.all([rows(WF.events),metadata.tables.some(t=>t.name===ORDINARY_GROUP_TABLE)?rows(ORDINARY_GROUP_TABLE):[]]);
  return planActivityGroupMigration(events,groups,{activityId:arg('activity-id')});
 }
}catch{
 console.error(JSON.stringify({failed:true,stage,rawErrorsSuppressed:true}));
 process.exitCode=1;
}
