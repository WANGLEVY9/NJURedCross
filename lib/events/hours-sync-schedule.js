const HOUR=3_600_000,DAY=24*HOUR,WEEK=7*DAY,OFFSET=8*HOUR;
const time=value=>{const result=typeof value==='number'?value:Date.parse(value);if(!Number.isFinite(result))throw new TypeError('Invalid hours synchronization time');return result;};

/** Latest Monday 06:00 in Asia/Shanghai, independent of the server timezone.
 * Work completed after the cutoff waits until the following Monday; a missed
 * run can catch up without including this week's later approvals prematurely.
 */
export function hoursProfileSyncWindow(now=Date.now()){
 const instant=time(now),local=new Date(instant+OFFSET),daysSinceMonday=(local.getUTCDay()+6)%7;
 let cutoff=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-daysSinceMonday*DAY+6*HOUR-OFFSET;
 if(cutoff>instant)cutoff-=WEEK;
 return {key:new Date(cutoff+OFFSET).toISOString().slice(0,10),cutoff:new Date(cutoff).toISOString(),nextAt:new Date(cutoff+WEEK).toISOString()};
}

export function nextHoursProfileSync(approvedAt){
 const instant=time(approvedAt),window=hoursProfileSyncWindow(instant);
 return Date.parse(window.cutoff)===instant?window.cutoff:window.nextAt;
}

export function eligibleForWeeklyHoursSync(approvedAt,now=Date.now()){
 return time(approvedAt)<=Date.parse(hoursProfileSyncWindow(now).cutoff);
}
