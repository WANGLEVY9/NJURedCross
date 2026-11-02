import {activityRelation,legacyActivityRelation,withActivityRelation} from '../../public/app/shared/activity-projects.js';
import {workflowConfigurationInvalid} from './workflow-config-integrity.js';
import {inspectActivityRelationships} from './activity-relationship-integrity.js';

const blocked=(row,code,detail='')=>({
  code,
  eventId:String(row?._id||''),
  activityId:String(row?.['活动ID']||''),
  detail,
});

/** Build identity-only patches from complete legacy configuration. */
export function planActivityRelationshipBackfill(events=[],groups=[]){
  if(!Array.isArray(events)||!Array.isArray(groups))throw new TypeError('关系回填需要活动与项目数组');
  const patches=[],blockedRows=[],targetEvents=[];
  for(const event of events){
    const legacy=legacyActivityRelation(event);
    const nativeGroup=String(event?.['活动组ID']||'').trim();
    const nativeParent=String(event?.['父活动ID']||'').trim();
    const target=withActivityRelation(event);
    if(nativeGroup&&legacy.groupId&&nativeGroup!==legacy.groupId){
      blockedRows.push(blocked(event,'group_relation_conflict','原生活动组与完整配置不一致'));
      targetEvents.push(target);
      continue;
    }
    if(nativeParent&&legacy.parentId&&nativeParent!==legacy.parentId){
      blockedRows.push(blocked(event,'parent_relation_conflict','原生父活动与完整配置不一致'));
      targetEvents.push(target);
      continue;
    }
    const groupId=nativeGroup||legacy.groupId,parentId=nativeParent||legacy.parentId;
    if(workflowConfigurationInvalid(event)&&!groupId&&!parentId){
      blockedRows.push(blocked(event,'configuration_unrecoverable','配置无法解析且没有原生关系'));
      targetEvents.push(target);
      continue;
    }
    if(parentId&&!groupId){
      blockedRows.push(blocked(event,'child_without_group','父活动存在但活动组 ID 无法推导'));
      targetEvents.push(target);
      continue;
    }
    const patch={};
    if(groupId!==nativeGroup)patch['活动组ID']=groupId;
    if(parentId!==nativeParent)patch['父活动ID']=parentId;
    if(Object.keys(patch).length)patches.push({eventId:String(event._id||''),activityId:String(event['活动ID']||''),patch});
    targetEvents.push({...event,...patch});
  }
  patches.sort((a,b)=>a.eventId.localeCompare(b.eventId));
  blockedRows.sort((a,b)=>a.eventId.localeCompare(b.eventId));
  const report=inspectActivityRelationships(targetEvents,groups);
  return {
    patches,
    blocked:blockedRows,
    targetEvents,
    report,
    changedRows:patches.length,
  };
}
