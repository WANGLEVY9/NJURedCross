import {createHash} from 'node:crypto';
import {isAbsolute,relative,resolve} from 'node:path';
import {inspectActivityRelationships} from './activity-relationship-integrity.js';

const fail=(message,code='activity_relationship_migration_failed')=>Object.assign(new Error(message),{code});

export const relationshipBackfillDigest=patches=>createHash('sha256').update(JSON.stringify(patches)).digest('hex');

export function validateRelationshipBackfillInvocation({apply,confirm,expectedDigest,backupDir,root}){
  if(!apply)return null;
  if(confirm!=='APPLY-ACTIVITY-RELATIONS')throw fail('缺少确认短语 APPLY-ACTIVITY-RELATIONS','activity_relationship_confirmation_required');
  if(!/^[a-f0-9]{64}$/.test(expectedDigest||''))throw fail('缺少有效的预演摘要','activity_relationship_digest_required');
  if(!backupDir||!isAbsolute(backupDir))throw fail('备份目录必须使用绝对路径','activity_relationship_backup_invalid');
  const inside=relative(resolve(root),resolve(backupDir));
  if(inside&&!inside.startsWith('..')&&!isAbsolute(inside))throw fail('备份目录必须位于仓库之外','activity_relationship_backup_invalid');
  return resolve(backupDir);
}

function introducedIssues(before,after){
  const existing=new Set(before.issues.map(issue=>`${issue.code}|${issue.eventId}`));
  return after.issues.filter(issue=>!existing.has(`${issue.code}|${issue.eventId}`));
}

/** Apply an already reviewed plan with injected backup, write and reload steps. */
export async function executeRelationshipBackfill({plan,baseline,digest,expectedDigest,schemaReady,backup,update,reload}){
  if(!schemaReady)throw fail('请先预览并应用工作流 Schema','activity_relationship_schema_missing');
  if(digest!==expectedDigest)throw fail('预演摘要已变化，请重新预演','activity_relationship_digest_changed');
  const planned=plan.report.issues.filter(issue=>!baseline.issues.some(old=>old.code===issue.code&&old.eventId===issue.eventId));
  if(planned.length)throw fail('回填计划会引入新的关系问题，已停止');
  await backup();
  let appliedRows=0;
  try{
    for(const item of plan.patches){await update(item);appliedRows++;}
  }catch(error){
    error.appliedRows=appliedRows;
    throw error;
  }
  const {events,groups}=await reload();
  const byId=new Map(events.map(row=>[row._id,row]));
  for(const item of plan.patches){
    const row=byId.get(item.eventId);
    if(!row||Object.entries(item.patch).some(([key,value])=>String(row[key]||'')!==value))throw fail('回填结果回读不一致，已停止','activity_relationship_readback_mismatch');
  }
  const after=inspectActivityRelationships(events,groups),introduced=introducedIssues(baseline,after);
  if(introduced.length)throw fail('回填后出现新的关系问题，请按备份核对','activity_relationship_postcheck_failed');
  return {writes:appliedRows,after};
}
