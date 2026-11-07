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
 // 签到窗口仍开放的已确认记录（含班次已结束但在宽限期内）留在「正在进行」，
 // 否则补签入口会被历史分组藏起来；请假/未入选等终态仍按原规则归档。
 if(record.attendanceOpen===true&&record.status==='已确认'&&!record.attendanceSubmitted&&!record.leaveStatus)return false;
 return record.blood ? record.weekArchived===true||record.eventStatus==='停点'||['已请假','未入选','已取消'].includes(record.status)
  : ['已结束','已归档','停点'].includes(record.eventStatus)||['已请假','未入选','已取消'].includes(record.status);
}
