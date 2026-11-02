/** Preview or apply the native project relationship backfill. */
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Base} from 'seatable-api';
import {assertCoordinatedMaintenance} from '../lib/maintenance/script-runner.js';
import {readPagedRows} from '../lib/http/paged-rows.js';
import {planActivityRelationshipBackfill} from '../lib/events/activity-relationship-backfill.js';
import {inspectActivityRelationships} from '../lib/events/activity-relationship-integrity.js';
import {executeRelationshipBackfill,relationshipBackfillDigest,validateRelationshipBackfillInvocation} from '../lib/events/activity-relationship-migration.js';
import {ORDINARY_GROUP_TABLE} from '../lib/events/ordinary-groups.js';
import {WORKFLOW_SCHEMA} from '../lib/events/workflow.js';
import {workflowMode} from '../lib/events/workflow-mode.js';

const apply=process.argv.includes('--apply');
assertCoordinatedMaintenance({write:apply});
const option=name=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3)||'';
const confirm=option('confirm'),expectedDigest=option('expected-digest'),backupOption=option('backup-dir');
const expected=workflowMode(process.env).expected,token=process.env.SEATABLE_VOLUNTEER_API_TOKEN?.trim();
if(!token)throw new Error('缺少志愿服务 Base Token');
const root=fileURLToPath(new URL('../',import.meta.url)),backupDir=validateRelationshipBackfillInvocation({apply,confirm,expectedDigest,backupDir:backupOption,root});
if(backupDir&&existsSync(backupDir))throw new Error('备份目录已经存在');

try{
  const base=new Base({server:process.env.SEATABLE_SERVER_URL||'https://table.nju.edu.cn',APIToken:token});
  await base.auth();
  if(base.dtableUuid!==expected)throw new Error('志愿服务 Base 不匹配');
  const metadata=await base.getMetadata(),eventTable=metadata.tables.find(table=>table.name===WORKFLOW_SCHEMA[0].name);
  const schemaReady=['活动组ID','父活动ID'].every(name=>eventTable?.columns?.some(column=>column.name===name));
  if(apply&&!schemaReady)throw new Error('请先预览并应用工作流 Schema');
  const [events,groups]=await Promise.all([
    readPagedRows(base,eventTable?.name||WORKFLOW_SCHEMA[0].name,{pageSize:500,maxRows:100000,requireComplete:true}),
    readPagedRows(base,ORDINARY_GROUP_TABLE,{pageSize:500,maxRows:100000,requireComplete:true}),
  ]);
  const baseline=inspectActivityRelationships(events,groups),plan=planActivityRelationshipBackfill(events,groups);
  const digest=relationshipBackfillDigest(plan.patches);
  const summary={mode:apply?'apply':'preview',baseVerified:true,schemaReady,writes:0,checked:{events:events.length,groups:groups.length},changedRows:plan.changedRows,blockedRows:plan.blocked.length,relationship:plan.report,digest,patches:plan.patches.slice(0,200),patchesTruncated:plan.patches.length>200,blocked:plan.blocked.slice(0,200),blockedTruncated:plan.blocked.length>200};
  if(!apply){
    console.log(JSON.stringify(summary,null,2));
    process.exitCode=schemaReady&&plan.report.ok?0:1;
  }else{
    const result=await executeRelationshipBackfill({
      plan,baseline,digest,expectedDigest,schemaReady,
      backup:async()=>{
        await mkdir(backupDir,{recursive:false,mode:0o700});
        await writeFile(resolve(backupDir,'activity-relationships-before.json'),`${JSON.stringify({events,groups,baseline,plan,digest},null,2)}\n`,{mode:0o600});
      },
      update:item=>base.updateRow(eventTable.name,item.eventId,item.patch),
      reload:async()=>{
        const [savedEvents,currentGroups]=await Promise.all([
          readPagedRows(base,eventTable.name,{pageSize:500,maxRows:100000,requireComplete:true}),
          readPagedRows(base,ORDINARY_GROUP_TABLE,{pageSize:500,maxRows:100000,requireComplete:true}),
        ]);
        return {events:savedEvents,groups:currentGroups};
      },
    });
    console.log(JSON.stringify({...summary,writes:result.writes,backupDir,after:result.after},null,2));
  }
}catch(error){
  console.error('活动关系回填失败；原始 SDK 错误和凭据已抑制。');
  if(error?.code)console.error(`错误代码：${error.code}`);
  if(Number.isSafeInteger(error?.appliedRows))console.error(`已写入行数：${error.appliedRows}；请使用预演与备份核对，勿直接重跑。`);
  process.exitCode=1;
}
