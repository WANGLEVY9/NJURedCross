/** Readiness is shared by the private UI and server; server additionally verifies every ledger's evidence. */
export function hoursReadiness(registrations,ledger,submission={}){
 const entries=new Map();for(const row of ledger){const key=row['报名行ID'];if(!entries.has(key))entries.set(key,[]);entries.get(key).push(row);}
 const required=registrations.filter(row=>['已确认','已签到'].includes(row['报名状态'])&&row['请假状态']!=='已批准');
 const pending=required.filter(row=>{
  if(row['请假状态']==='待审批')return true;
  const hours=entries.get(row._id)||[];
  if(submission.absences?.[row._id])return row['报名状态']==='已签到'||hours.length>0;
  return row['报名状态']!=='已签到'||hours.length!==1||!['待批准','已批准','已入账'].includes(hours[0]['状态']);
 });
 return {required,pending,absent:required.filter(row=>submission.absences?.[row._id]),complete:required.length-pending.length};
}

export function hoursLocked(event){return event?.hoursSubmission?.phase==='submitted';}

/** NJUTable-generated shifts keep their existing attendance/review lifecycle. */
export function supportsHoursSubmission(event){
 try{return JSON.parse(event?.['报名页配置']||'{}').source?.kind!=='generated_blood';}catch{return true;}
}
