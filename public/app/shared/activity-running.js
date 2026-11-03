const config=event=>{try{return JSON.parse(event['报名页配置']||'{}');}catch{return {};}};

/** Resolve a participation to exactly one position; ambiguous source rows stay unassigned. */
export function runningPositions(data){
 return data.events.filter(event=>config(event).bookingMode!=='grouped');
}
export function runningParticipants(data,positionId,entries=[]){
 const jobs=runningPositions(data);
 return data.registrations.filter(row=>['已确认','已签到'].includes(row['报名状态'])&&row['请假状态']!=='已批准').flatMap(row=>{
  const matches=jobs.filter(event=>event['活动ID']===row['活动ID']||(config(event).sourceActivityIds||[]).includes(row['活动ID']));
  if(matches.length!==1||matches[0]['活动ID']!==positionId)return [];
  const ledger=data.ledger.filter(entry=>entry['报名行ID']===row._id&&entry['活动ID']===row['活动ID']);
  // Final approval is not the director's first review. No inferred first-round result.
  const firstReview=entries.find(item=>item.id===row._id);
  return [{registration:row,entry:ledger.length===1?ledger[0]:null,firstReview,review:firstReview?.decision==='pass'?'初审通过':firstReview?.decision==='fail'?'初审不通过':'待初审',ambiguous:ledger.length>1}];
 });
}
export function runningHours(entry){
 if(!entry)return '—';
 return ['服务时长','培训时长','交通时长'].map((key,index)=>`${['服务','培训','交通'][index]} ${entry[key]??'—'}`).join(' · ');
}
const numeric=value=>{
 if(value===undefined||value===null)return undefined;
 if(typeof value==='string'&&value.trim()==='')return undefined;
 const number=Number(value);
 return Number.isFinite(number)?number:undefined;
};
/**
 * 岗位配置的预设时长：岗位自身 → 活动行字段 → 活动级默认。
 * 用于时长初审自动带出，避免负责人逐人手填或留下 0/0/0 的空表。
 */
export function runningHourDefaults(event){
 const settings=event?config(event):{},hours=settings.positionHours||{};
 return {
  serviceHours:numeric(hours.serviceHours)??numeric(event?.['服务时长'])??numeric(settings.service),
  trainingHours:numeric(hours.trainingHours)??numeric(event?.['培训时长'])??numeric(settings.training),
  travelHours:numeric(hours.travelHours)??numeric(event?.['交通时长'])??numeric(settings.travel),
 };
}
/** 未初审时展示岗位预设的服务/培训/交通时长，而不是一个破折号。 */
export function runningPresetHours(defaults){
 const preset=defaults&&['serviceHours','trainingHours','travelHours'].some(key=>defaults[key]!==undefined);
 if(!preset)return '—';
 return [['serviceHours','服务'],['trainingHours','培训'],['travelHours','交通']].map(([key,label])=>`${label} ${defaults[key]??'—'}`).join(' · ');
}
/**
 * 尚未给出初审结果的记录排到最前，已审核的保持原顺序。
 *
 * 上传或重新打开名单时，负责人要处理的是还没判定的人；已通过的混在中间会把
 * 未处理的人挤到需要滚动才能看到的位置。判定为「未审核」即 decision 为空。
 */
export function pendingReviewFirst(items,decisionOf=item=>item?.decision){
 const pending=[],settled=[];
 for(const item of items)(decisionOf(item)?settled:pending).push(item);
 return [...pending,...settled];
}
