/** Owner-authorized maintenance import. Secrets arrive via stdin, never files/logs. Default is read-only. */
import {Base} from 'seatable-api';
import {createSeaTableAccess} from '../lib/seatable-auth.js';
import {readPagedRows} from '../lib/http/paged-rows.js';
import {createWorkflow,WF,workflowApprovalHash} from '../lib/events/workflow.js';
import {ORDINARY_GROUP_TABLE,ORDINARY_GROUP_COLUMNS,ordinaryConfig} from '../lib/events/ordinary-groups.js';
import {bloodWeekPlan} from './preview-blood-week-plan.mjs';
const expected={volunteer:'cc304b1d-a726-4f92-a9be-a6ffcaa54038',business:'076b49ed-6f04-4ea6-8799-1b9ad71dba88',identity:'3f593da5-e315-4c54-88f2-03c50fa716aa'};
const apply=process.argv.includes('--apply'),confirm=process.argv.includes('--confirm=PUBLISH-BLOOD-WEEK-2026');
const actor='owner-authorized-maintenance:WANGLEVY9';
const plan=bloodWeekPlan();
try {
 if(apply&&!confirm)throw new Error('Apply confirmation required');
 let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>16384)throw new Error('Invalid configuration envelope');}
 const cfg=JSON.parse(input);
 if(cfg.server!=='https://table.nju.edu.cn')throw new Error('Unexpected server');
 const bases={};
 for(const kind of Object.keys(expected)){
  if(cfg[kind]?.expected!==expected[kind])throw new Error('Unexpected configured UUID');
  const b=new Base({server:cfg.server,APIToken:cfg[kind].token.trim()});await createSeaTableAccess(b)();
  if(b.dtableUuid!==expected[kind])throw new Error('Authenticated UUID mismatch');bases[kind]=b;
 }
 const base=bases.volunteer,metadata=await base.getMetadata();
 for(const table of Object.values(WF))if(!metadata.tables.some(t=>t.name===table))throw new Error('Workflow schema missing');
 // Query only the specifically requested owner, and never output password/email/identity data.
 const owners=await bases.identity.query("SELECT `账号ID`, `真实姓名`, `状态`, `角色` FROM `平台账号表` WHERE `真实姓名` = '金中宸' LIMIT 3");
 if(!Array.isArray(owners)||owners.length!==1||!owners[0]['账号ID']||/禁用|冻结|删除/.test(owners[0]['状态']||''))throw new Error('Owner is missing, ambiguous or disabled');
 const owner=owners[0]['账号ID'];
 let parentTable=metadata.tables.find(t=>t.name===ORDINARY_GROUP_TABLE);
 if(parentTable&&ORDINARY_GROUP_COLUMNS.some(c=>!parentTable.columns.some(x=>x.name===c&&x.type==='text')))throw new Error('Parent schema mismatch');
 const rows=await readPagedRows(base,WF.events,{maxRows:100000,requireComplete:true});
 let existing=rows.filter(e=>ordinaryConfig(e)?.groupId===plan.projectId);
 const parents=parentTable?await readPagedRows(base,ORDINARY_GROUP_TABLE,{maxRows:100000,requireComplete:true}):[];
 const parentMatches=parents.filter(p=>p['活动组ID']===plan.projectId);
 if(existing.length||parentMatches.length){
  if(existing.length!==16||parentMatches.length!==1||Number(parentMatches[0]['班次数'])!==16||parentMatches[0]['负责人账号ID']!==owner)throw new Error('Existing partial or duplicate import requires manual recovery');
  for(const s of plan.sessions){const matches=existing.filter(e=>{const c=ordinaryConfig(e);return c.start===s.startAt&&c.end===s.endAt&&e['地点']===s.location;});if(matches.length!==1||Number(matches[0]['容量'])!==30||matches[0]['工作内容']!==plan.work||matches[0]['负责人账号ID']!==owner||ordinaryConfig(matches[0]).hoursPending!==true)throw new Error('Existing session differs from approved plan');}
 }
 console.log(JSON.stringify({mode:apply?'apply':'preview',uuidVerified:true,projectId:plan.projectId,ownerMatched:true,sessions:16,totalCapacity:480,registrationEnd:plan.registrationEnd,parentTableExists:Boolean(parentTable),existingSessions:existing.length,writes:apply,emails:0}));
 if(!apply)process.exit(0);
 if(!parentTable){
  await base.addTable(ORDINARY_GROUP_TABLE,'zh-cn',ORDINARY_GROUP_COLUMNS.map((column_name,i)=>({column_name,column_type:'text',anchor_column:i?ORDINARY_GROUP_COLUMNS[i-1]:''})));
  parentTable=(await base.getMetadata()).tables.find(t=>t.name===ORDINARY_GROUP_TABLE);if(!parentTable)throw new Error('Parent table creation unconfirmed');
 }
 const w=createWorkflow(base,{mode:'production',assertWritable:async()=>{if(base.dtableUuid!==expected.volunteer)throw new Error('Scope changed');}});
 if(!existing.length){const made=await w.createOrdinaryGroup({groupId:plan.projectId,name:plan.name,work:plan.work,registrationEnd:plan.registrationEnd,sessions:plan.sessions},owner);existing=made.events;}
 // Run the same lifecycle validators; the maintenance approver is explicit, not a fabricated staff identity.
 for(const item of existing){
  let row=(await readPagedRows(base,WF.events,{maxRows:100000,requireComplete:true})).find(r=>r._id===item._id);
  if(row['状态']==='草稿'){await w.submit(row._id);row['状态']='待审核';}
  if(row['状态']==='待审核'){await w.approve(row._id,actor);row['状态']='可发布';}
  if(row['状态']==='可发布')await w.publish(row._id);
 }
 await w.ordinarySettings(existing[0]._id,{deadline:plan.registrationEnd,enabled:true},actor);
 const verified=(await w.publicRead()).events.filter(e=>ordinaryConfig(e)?.groupId===plan.projectId);
 if(verified.length!==16||verified.some(e=>e['状态']!=='报名中'||e['批准摘要']!==workflowApprovalHash(e)||!e.registrationControl?.enabled)||verified.reduce((n,e)=>n+Number(e['容量']),0)!==480)throw new Error('Post-write verification failed');
 await bases.business.appendRow('操作审计表',{审计ID:`BLOOD-WEEK-PUBLISH-${Date.now()}`,时间:new Date().toISOString(),操作人:actor,角色:'Owner授权维护',动作:'ordinary.group.publish',对象:plan.projectId,结果:'success',IP:'SSH控制会话',备注:JSON.stringify({sessions:16,capacity:480,registrationEnd:plan.registrationEnd,hours:'待确定'})});
 console.log(JSON.stringify({ok:true,projectId:plan.projectId,verifiedSessions:16,totalCapacity:480,publicPath:`/workflow-events?event=${encodeURIComponent(verified[0]._id)}`,adminEventId:verified[0]._id,hoursRule:'待确定',emails:0}));
}catch {
 console.error(JSON.stringify({ok:false,message:'Publication stopped; credentials/raw SDK errors suppressed. Inspect persisted draft state before retry.',partialWritesPossible:apply}));process.exitCode=1;
}
