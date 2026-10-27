/** Production maintenance only; default is read-only. No account or mail operations. */
import {Base} from 'seatable-api';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join,isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';
import {rowsByValues} from '../lib/http/rows-by-values.js';
import {WF,workflowApprovalHash,workflowEventApproved} from '../lib/events/workflow.js';
import {readPagedRows} from '../lib/http/paged-rows.js';
import {normalizeRegistration,createRegistrationWriter} from '../lib/events/registration-schema.js';
import {ORDINARY_GROUP_TABLE} from '../lib/events/ordinary-groups.js';
import {createWriteCoordinator} from '../lib/materials/write-coordinator.js';
import {createActivityLifecycleStore} from '../lib/events/activity-lifecycle-store.js';
import {planLegacyWorkspaceRecovery,extractLegacyWorkspaceEdit} from '../lib/events/workspace-legacy-recovery.js';
import {workspaceEditDigest} from '../lib/events/workspace-live-edit.js';

const args=process.argv.slice(2),value=name=>args.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3);
const apply=args.includes('--apply'),id=value('parent'),state=process.env.PLATFORM_WRITE_STATE_DIR;
if(args.some(arg=>!/^--(?:parent|expected-digest|backup-dir)=/.test(arg)&&arg!=='--apply')||!id||!state||!isAbsolute(state)
 ||process.env.PLATFORM_WORKFLOW_MODE!=='production'||process.env.SEATABLE_VOLUNTEER_BASE_UUID!=='cc304b1d-a726-4f92-a9be-a6ffcaa54038')throw Error('恢复参数或生产数据源绑定无效');
const base=new Base({server:process.env.SEATABLE_SERVER_URL,APIToken:process.env.SEATABLE_VOLUNTEER_API_TOKEN});await base.auth();
if(base.dtableUuid!==process.env.SEATABLE_VOLUNTEER_BASE_UUID)throw Error('实际数据源与配置不一致');
const work=async()=>{
 const events=await readPagedRows(base,WF.events,{pageSize:1000,maxRows:100000,requireComplete:true});
 const matches=events.filter(row=>row._id===id);if(matches.length!==1)throw Error('目标活动行不唯一');
 const parent=await base.getRow(WF.events,id);events[events.findIndex(row=>row._id===id)]=parent;
 const {old}=extractLegacyWorkspaceEdit(parent),ids=[parent['活动ID'],...old.positionPlan.eventIds];
 const [registrations,checkins,ledger,groups]=await Promise.all([
  ...['registrations','checkins','ledger'].map(key=>rowsByValues(base,WF[key],'活动ID',ids)),
  rowsByValues(base,ORDINARY_GROUP_TABLE,'活动组ID',[old.positionPlan.groupId]),
 ]);
 const data={parent,events,registrations:registrations.map(normalizeRegistration),checkins,ledger,groups};
 const plan=await planLegacyWorkspaceRecovery(data);
 const summary={dryRun:!apply,parent:id,registrations:registrations.length,registrationUpdates:plan.registrationPatches.length,groupUpdates:Object.keys(plan.groupPatch),version:plan.parentPatch['申请版本'],configurationChars:plan.parentPatch['报名页配置'].length,sourceDigest:plan.sourceDigest};
 if(!apply){console.log(JSON.stringify(summary));return;}
 if(value('expected-digest')!==plan.sourceDigest)throw Error('预览后证据已变化，停止恢复');
 const dir=value('backup-dir');if(!dir||!isAbsolute(dir)||resolve(dir)===resolve(state))throw Error('必须指定独立的私有备份目录');
 mkdirSync(dir,{mode:0o700});writeFileSync(join(dir,'before.json'),JSON.stringify(data),{mode:0o600});writeFileSync(join(dir,'plan.json'),JSON.stringify(plan),{mode:0o600});
 const lifecycle='activity-lifecycle-058c8af004709d8f.sqlite',workspace='activity-workspace-058c8af004709d8f.sqlite';
 execFileSync('python3',['-c','import sqlite3,sys,pathlib; s=pathlib.Path(sys.argv[1]); d=pathlib.Path(sys.argv[2]);\nfor name in sys.argv[3:]:\n a=sqlite3.connect("file:"+str(s/name)+"?mode=ro",uri=True);b=sqlite3.connect(str(d/name));a.backup(b);b.close();a.close();(d/name).chmod(0o600)',state,dir,lifecycle,workspace]);
 const store=createActivityLifecycleStore(join(state,lifecycle));
 try{
  store.saveWorkspaceEdit(id,plan.receipt);
  const writer=createRegistrationWriter(base);
  for(const item of plan.registrationPatches)await base.updateRow(WF.registrations,item.id,await writer.encodeTable(WF.registrations,item.patch));
  if(Object.keys(plan.groupPatch).length)await base.updateRow(ORDINARY_GROUP_TABLE,plan.groupId,await writer.encodeTable(ORDINARY_GROUP_TABLE,plan.groupPatch));
  const current=await base.getRow(WF.events,id);if(JSON.stringify(current)!==JSON.stringify(parent))throw Error('主记录在恢复前变化，请核对备份');
  await base.updateRow(WF.events,id,await writer.encodeTable(WF.events,plan.parentPatch));
  const saved=await base.getRow(WF.events,id),savedBookings=(await rowsByValues(base,WF.registrations,'活动ID',ids)).map(normalizeRegistration);
  const expected=structuredClone(data.registrations);for(const item of plan.registrationPatches)Object.assign(expected.find(row=>row._id===item.id),item.patch);
  const ordered=rows=>rows.slice().sort((a,b)=>a._id.localeCompare(b._id));
  if(saved['报名页配置']!==plan.parentPatch['报名页配置']||!workflowEventApproved(saved)||workflowApprovalHash(saved)!==plan.parentPatch['批准摘要']
   ||workspaceEditDigest(ordered(savedBookings))!==workspaceEditDigest(ordered(expected)))throw Error('恢复写入结果待核对，保留所有备份和私有回执');
  // Link-cell representations differ between SQL and listRows; compare the same API.
  const afterEvents=(await readPagedRows(base,WF.events,{pageSize:1000,maxRows:100000,requireComplete:true})).filter(row=>ids.includes(row['活动ID'])),priorChildren=data.events.filter(row=>old.positionPlan.eventIds.includes(row['活动ID']));
  if(workspaceEditDigest(ordered(afterEvents.filter(row=>row._id!==id)))!==workspaceEditDigest(ordered(priorChildren)))throw Error('岗位记录发生变化，需核对');
  writeFileSync(join(dir,'after.json'),JSON.stringify({parent:saved,events:afterEvents,registrations:savedBookings}),{mode:0o600});console.log(JSON.stringify({...summary,dryRun:false,verified:true,backup:dir}));
 }finally{store.close();}
};
if(apply)await (await createWriteCoordinator(join(state,'write-lock.sqlite')))(work);else await work();
