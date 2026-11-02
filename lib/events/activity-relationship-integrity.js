import {activityRelation,legacyActivityRelation} from '../../public/app/shared/activity-projects.js';
import {workflowConfig} from './blood-roster.js';
import {workflowConfigurationInvalid} from './workflow-config-integrity.js';

const publishedStatuses=new Set(['报名中','进行中','停点','已结束']);

function indexBy(rows,keyOf){
  const groups=new Map();
  for(const row of rows){
    const key=String(keyOf(row)||'').trim();
    if(!key)continue;
    const bucket=groups.get(key);
    if(bucket)bucket.push(row);
    else groups.set(key,[row]);
  }
  return groups;
}

/**
 * Read-only project graph inspection. It emits identifiers and codes only, so
 * the same result can be logged by a daily job without exposing member data.
 */
export function inspectActivityRelationships(events=[],groups=[]){
  if(!Array.isArray(events)||!Array.isArray(groups))throw new TypeError('活动关系检查需要活动与项目数组');
  const issues=[];
  const add=(code,severity,row,detail='')=>issues.push({
    code,
    severity,
    eventId:String(row?._id||''),
    activityId:String(row?.['活动ID']||''),
    detail,
  });
  const eventById=indexBy(events,row=>row?._id);
  const eventByActivity=indexBy(events,row=>row?.['活动ID']);
  const groupById=indexBy(groups,row=>row?.['活动组ID']);

  for(const [id,rows]of eventById)if(rows.length>1)add('duplicate_event_row','error',rows[0],`记录标识 ${id} 重复 ${rows.length} 次`);
  for(const [id,rows]of eventByActivity)if(rows.length>1)add('duplicate_activity_id','error',rows[0],`活动ID ${id} 重复 ${rows.length} 次`);
  for(const [id,rows]of groupById)if(rows.length>1)add('duplicate_group_row','error',{...rows[0],'活动组ID':id},`活动组 ${id} 重复 ${rows.length} 次`);
  for(const group of groups)if(!String(group?.['活动组ID']||'').trim())add('group_without_id','error',group);

  for(const event of events){
    const relation=activityRelation(event),legacy=legacyActivityRelation(event);
    const nativeGroup=String(event?.['活动组ID']||'').trim();
    const nativeParent=String(event?.['父活动ID']||'').trim();
    if(nativeGroup&&legacy.groupId&&nativeGroup!==legacy.groupId)add('group_relation_mismatch','error',event,'原生活动组与配置不一致');
    if(nativeParent&&legacy.parentId&&nativeParent!==legacy.parentId)add('parent_relation_mismatch','error',event,'原生父活动与配置不一致');
    if(workflowConfigurationInvalid(event))add('configuration_invalid','error',event);
    if(!relation.groupId&&!relation.parentId)continue;

    if(relation.parentId){
      if(!relation.groupId)add('child_without_group','error',event);
      if(relation.groupId&&!groupById.has(relation.groupId))add('group_record_missing','error',event,relation.groupId);
      const parents=eventByActivity.get(relation.parentId)||[];
      if(parents.length!==1){
        add('parent_not_unique','error',event,`父活动 ${relation.parentId} 对应 ${parents.length} 条记录`);
      }else{
        const parent=parents[0],parentRelation=activityRelation(parent);
        if(!parentRelation.groupId)add('parent_without_group','error',parent);
        else if(relation.groupId&&parentRelation.groupId!==relation.groupId)add('parent_group_mismatch','error',event,`${parentRelation.groupId} != ${relation.groupId}`);
        const plan=workflowConfig(parent).positionPlan;
        if(Array.isArray(plan?.eventIds)&&!plan.eventIds.includes(event['活动ID'])&&!['已结束','已归档'].includes(event['状态']))add('child_outside_parent_plan','error',event);
      }
      continue;
    }

    if(publishedStatuses.has(event['状态'])&&!groupById.has(relation.groupId)){
      add('group_record_missing','error',event,relation.groupId);
    }
  }

  const counts={};
  for(const issue of issues)counts[issue.code]=(counts[issue.code]||0)+1;
  return {
    ok:!issues.some(issue=>issue.severity==='error'),
    checked:{events:events.length,groups:groups.length},
    issueCount:issues.length,
    counts,
    issues,
  };
}
