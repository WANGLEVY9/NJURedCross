/** Read-only daily integrity check. Never writes business rows or emits member data. */
import {Base} from 'seatable-api';
import {readPagedRows} from '../lib/http/paged-rows.js';
import {inspectActivityRelationships} from '../lib/events/activity-relationship-integrity.js';
import {ORDINARY_GROUP_COLUMNS,ORDINARY_GROUP_TABLE} from '../lib/events/ordinary-groups.js';
import {WORKFLOW_SCHEMA} from '../lib/events/workflow.js';
import {workflowMode} from '../lib/events/workflow-mode.js';

const token=process.env.SEATABLE_VOLUNTEER_API_TOKEN?.trim();
if(!token)throw new Error('缺少志愿服务 Base Token');
try{
  const expected=workflowMode(process.env).expected;
  const base=new Base({
    server:process.env.SEATABLE_SERVER_URL||'https://table.nju.edu.cn',
    APIToken:token,
  });
  await base.auth();
  if(base.dtableUuid!==expected)throw new Error('志愿服务 Base 不匹配');
  const metadata=await base.getMetadata(),eventTable=metadata.tables.find(table=>table.name===WORKFLOW_SCHEMA[0].name),groupTable=metadata.tables.find(table=>table.name===ORDINARY_GROUP_TABLE);
  const missing=[];
  for(const name of ['活动组ID','父活动ID'])if(!eventTable?.columns?.some(column=>column.name===name))missing.push(`${eventTable?.name||WORKFLOW_SCHEMA[0].name}.${name}`);
  for(const name of ORDINARY_GROUP_COLUMNS)if(!groupTable?.columns?.some(column=>column.name===name))missing.push(`${ORDINARY_GROUP_TABLE}.${name}`);
  if(missing.length)throw new Error(`活动关系 Schema 未完整应用：${missing.join('、')}`);
  const [events,groups]=await Promise.all([
    readPagedRows(base,WORKFLOW_SCHEMA[0].name,{pageSize:500,maxRows:100000,requireComplete:true}),
    readPagedRows(base,ORDINARY_GROUP_TABLE,{pageSize:500,maxRows:100000,requireComplete:true}),
  ]);
  const report=inspectActivityRelationships(events,groups);
  const output={mode:'read-only',writes:0,checkedAt:new Date().toISOString(),ok:report.ok,checked:report.checked,issueCount:report.issueCount,counts:report.counts,issues:report.issues.slice(0,200),issuesTruncated:report.issues.length>200};
  console.log(JSON.stringify(output,null,2));
  if(!report.ok)process.exitCode=1;
}catch(error){
  console.error(error?.message||'活动关系检查失败');
  process.exitCode=1;
}
