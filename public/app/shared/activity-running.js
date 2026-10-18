const config=event=>{try{return JSON.parse(event['报名页配置']||'{}');}catch{return {};}};

/** Resolve a participation to exactly one position; ambiguous source rows stay unassigned. */
export function runningPositions(data){
 return data.events.filter(event=>config(event).bookingMode!=='grouped');
}
export function runningParticipants(data,positionId){
 const jobs=runningPositions(data);
 return data.registrations.filter(row=>['已确认','已签到'].includes(row['报名状态'])&&row['请假状态']!=='已批准').flatMap(row=>{
  const matches=jobs.filter(event=>event['活动ID']===row['活动ID']||(config(event).sourceActivityIds||[]).includes(row['活动ID']));
  if(matches.length!==1||matches[0]['活动ID']!==positionId)return [];
  const entries=data.ledger.filter(entry=>entry['报名行ID']===row._id&&entry['活动ID']===row['活动ID']);
  // Final approval is not the director's first review. No inferred first-round result.
  return [{registration:row,entry:entries.length===1?entries[0]:null,review:'待初审',ambiguous:entries.length>1}];
 });
}
export function runningHours(entry){
 if(!entry)return '—';
 return ['服务时长','培训时长','交通时长'].map((key,index)=>`${['服务','培训','交通'][index]} ${entry[key]??'—'}`).join(' · ');
}
