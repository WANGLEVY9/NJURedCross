import {createHash} from 'node:crypto';
import {activityProjectKey,compatibleStoredActivityGroup,legacyActivityRelation,storedActivityGroup} from '../../public/app/shared/activity-projects.js';
import {inspectActivityRelationships} from './activity-relationship-integrity.js';
import {workflowConfigurationInvalid} from './workflow-config-integrity.js';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const groupCell=row=>row['活动组ID']??'';
const rowProof=row=>digest([row._id,row['活动ID'],row['状态'],row['报名日期'],row['报名页配置']]);

/** Plan against all rows, but allow an isolated rehearsal to select one explicit activity ID. */
export function planActivityGroupMigration(events,groups,{activityId=''}={}){
 const selected=activityId?events.filter(row=>row['活动ID']===activityId):null;
 if(selected&&selected.length!==1)throw Error('样本活动 ID 不存在或重复');
 const sample=selected?.[0],sampleRelation=sample&&legacyActivityRelation(sample),key=sample&&activityProjectKey(sample);
 const related=sample?events.filter(row=>row===sample||
  (sampleRelation.groupId&&legacyActivityRelation(row).groupId===sampleRelation.groupId)||
  legacyActivityRelation(row).parentId===sample['活动ID']||activityProjectKey(row)===key):events;
 const ids=new Set(related.map(row=>row._id));
 const relevantGroups=new Set(related.map(row=>legacyActivityRelation(row).groupId).filter(Boolean));
 const groupRows=groups.filter(row=>relevantGroups.has(row['活动组ID']));
 const inspections=inspectActivityRelationships(events,groups);
 const issueCodes=new Set(inspections.issues.filter(issue=>ids.has(issue.eventId)||relevantGroups.has(issue.groupId)).map(issue=>issue.code));
 const counters=new Map();
 for(const row of events)if(row['活动ID'])counters.set(row['活动ID'],(counters.get(row['活动ID'])||0)+1);
 const changes=[];
 for(const row of related){
  if(!row._id||workflowConfigurationInvalid(row)||!compatibleStoredActivityGroup(row)){issueCodes.add('invalid_activity_row');continue;}
  const value=storedActivityGroup(row,{legacyDates:true});
  if(!value)continue;
  if(counters.get(row['活动ID'])!==1){issueCodes.add('ambiguous_activity_id');continue;}
  const group=legacyActivityRelation(row).groupId;
  if(group&&groupRows.filter(item=>item['活动组ID']===group).length!==1){issueCodes.add('ordinary_group_not_unique');continue;}
  if(!groupCell(row))changes.push({id:row._id,proof:rowProof(row),before:'',after:value});
 }
 changes.sort((a,b)=>a.id.localeCompare(b.id));
 const issues=[...issueCodes].sort();
 const evidence=related.map(row=>[rowProof(row),groupCell(row)]).sort((a,b)=>a[0].localeCompare(b[0]));
 const bindings=groupRows.map(row=>[row._id,row['活动组ID']]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
 return {version:1,activityId,scanned:related.length,issues,changes,bindings,digest:digest([activityId,evidence,bindings,issues,changes])};
}

/** Check every target before writing. Each write is resumable and verified on read-back. */
export async function applyActivityGroupCells(snapshot,{read,update,rollback=false}){
 if(snapshot.version!==1||!Array.isArray(snapshot.changes)||new Set(snapshot.changes.map(item=>item.id)).size!==snapshot.changes.length||
  snapshot.changes.some(item=>!item.id||!/^[a-f0-9]{64}$/.test(item.proof)||item.before!==''||typeof item.after!=='string'||!item.after))throw Error('迁移快照无效');
 const from=rollback?'after':'before',to=rollback?'before':'after';
 const verify=async item=>{
  const row=await read(item.id);
  if(!row||rowProof(row)!==item.proof||storedActivityGroup(row,{legacyDates:true})!==item.after||![item[from],item[to]].includes(groupCell(row)))throw Error('活动数据已变化，请先核对');
  return row;
 };
 for(const item of snapshot.changes)await verify(item);
 let written=0;
 for(const item of snapshot.changes){
  const row=await verify(item);
  if(groupCell(row)===item[to])continue;
  await update(item.id,{'活动组ID':item[to]});
  if(groupCell(await verify(item))!==item[to])throw Error('活动组记录回读未确认');
  written++;
 }
 return {written,verified:snapshot.changes.length};
}
