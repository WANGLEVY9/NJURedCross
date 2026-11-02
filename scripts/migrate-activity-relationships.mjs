/** Preview or apply the native project relationship backfill. */
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {isAbsolute,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Base} from 'seatable-api';
import {assertCoordinatedMaintenance} from '../lib/maintenance/script-runner.js';
import {readPagedRows} from '../lib/http/paged-rows.js';
import {planActivityRelationshipBackfill} from '../lib/events/activity-relationship-backfill.js';
import {inspectActivityRelationships} from '../lib/events/activity-relationship-integrity.js';
import {ORDINARY_GROUP_TABLE} from '../lib/events/ordinary-groups.js';
import {WORKFLOW_SCHEMA} from '../lib/events/workflow.js';
import {workflowMode} from '../lib/events/workflow-mode.js';

const apply=process.argv.includes('--apply');
assertCoordinatedMaintenance({write:apply});
const option=name=>process.argv.find(arg=>arg.startsWith(`--${name}=`))?.slice(name.length+3)||'';
const confirm=option('confirm'),expectedDigest=option('expected-digest'),backupOption=option('backup-dir');
const expected=workflowMode(process.env).expected,token=process.env.SEATABLE_VOLUNTEER_API_TOKEN?.trim();
if(!token)throw new Error('缺少志愿服务 Base Token');
if(apply){
  if(confirm!=='APPLY-ACTIVITY-RELATIONS')throw new Error('缺少确认短语 APPLY-ACTIVITY-RELATIONS');
  if(!/^[a-f0-9]{64}$/.test(expectedDigest))throw new Error('缺少有效的预演摘要');
  if(!backupOption||!isAbsolute(backupOption))throw new Error('备份目录必须使用绝对路径');
  const root=fileURLToPath(new URL('../',import.meta.url)),inside=relative(resolve(root),resolve(backupOption));
  if(inside&&!inside.startsWith('..')&&!isAbsolute(inside))throw new Error('备份目录必须位于仓库之外');
  if(existsSync(backupOption))throw new Error('备份目录已经存在');
}

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
  const digest=createHash('sha256').update(JSON.stringify(plan.patches)).digest('hex');
  const summary={mode:apply?'apply':'preview',baseVerified:true,schemaReady,writes:0,checked:{events:events.length,groups:groups.length},changedRows:plan.changedRows,blockedRows:plan.blocked.length,relationship:plan.report,digest,patches:plan.patches.slice(0,200),patchesTruncated:plan.patches.length>200,blocked:plan.blocked.slice(0,200),blockedTruncated:plan.blocked.length>200};
  if(!apply){
    console.log(JSON.stringify(summary,null,2));
    process.exitCode=schemaReady&&plan.report.ok?0:1;
  }else{
    if(digest!==expectedDigest)throw new Error('预演摘要已变化，请重新预演');
    const originalKeys=new Set(baseline.issues.map(issue=>`${issue.code}|${issue.eventId}`));
    const introduced=plan.report.issues.filter(issue=>!originalKeys.has(`${issue.code}|${issue.eventId}`));
    if(introduced.length)throw new Error('回填计划会引入新的关系问题，已停止');
    await mkdir(backupOption,{recursive:false,mode:0o700});
    await writeFile(resolve(backupOption,'activity-relationships-before.json'),`${JSON.stringify({events,groups,baseline,plan,digest},null,2)}\n`,{mode:0o600});
    for(const item of plan.patches)await base.updateRow(eventTable.name,item.eventId,item.patch);
    const [savedEvents,currentGroups]=await Promise.all([
      readPagedRows(base,eventTable.name,{pageSize:500,maxRows:100000,requireComplete:true}),
      readPagedRows(base,ORDINARY_GROUP_TABLE,{pageSize:500,maxRows:100000,requireComplete:true}),
    ]);
    const savedById=new Map(savedEvents.map(row=>[row._id,row]));
    for(const item of plan.patches){
      const row=savedById.get(item.eventId);
      if(!row||Object.entries(item.patch).some(([key,value])=>String(row[key]||'')!==value))throw new Error('回填结果回读不一致，已停止');
    }
    const after=inspectActivityRelationships(savedEvents,currentGroups);
    const afterIntroduced=after.issues.filter(issue=>!originalKeys.has(`${issue.code}|${issue.eventId}`));
    if(afterIntroduced.length)throw new Error('回填后出现新的关系问题，请按备份核对');
    console.log(JSON.stringify({...summary,writes:plan.changedRows,backupDir:resolve(backupOption),after},null,2));
  }
}catch(error){
  console.error('活动关系回填失败；原始 SDK 错误和凭据已抑制。');
  if(error?.code)console.error(`错误代码：${error.code}`);
  process.exitCode=1;
}
