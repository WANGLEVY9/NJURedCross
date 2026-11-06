/** Source shifts may finish before attendance evidence is available. */
export const bloodConfig = event => {try{return JSON.parse(event?.['报名页配置']||'{}');}catch{return {};}};
export const generatedBlood = event => bloodConfig(event).source?.kind==='generated_blood';
export const bloodWeekArchived = event => Boolean(bloodConfig(event).bloodWeekArchive);
export function bloodAttendanceOpen(event,events,now=Date.now()) {
 const c=bloodConfig(event);
 if(!generatedBlood(event)||!['报名中','进行中','已结束'].includes(event?.['状态'])||c.bloodWeekArchive||c.workspaceRemoval)return false;
 const start=Date.parse(c.blood?.start);
 return Number.isFinite(start)&&now>=start&&!events.some(row=>bloodConfig(row).runningReview?.status==='submitted');
}
export function registrationIsHistorical(record) {
 return record.blood ? record.weekArchived===true||record.eventStatus==='停点'||['已请假','未入选','已取消'].includes(record.status)
  : ['已结束','已归档','停点'].includes(record.eventStatus)||['已请假','未入选','已取消'].includes(record.status);
}
