// Presentation only: permissions and mutation eligibility remain server-owned.
export function registrationPresentation(record) {
 const confirmed=['已确认','已签到'].includes(record.status);
 const checked=record.status==='已签到';
 const entered=record.entryStatus==='网站已入账';
 const stopped=record.result==='报名失败'||record.eventStatus==='停点'||record.eventStatus==='已结束'||['待审批','已批准'].includes(record.leaveStatus)||record.status==='已请假';
 let label='待审核',tone='warning',symbol='clock',hint='报名已收到，等待负责人审核。';
 if(record.result==='报名失败'){label='报名未通过';tone='danger';symbol='info';hint='请查看审核说明，或选择其他班次。';}
 else if(entered){label='时长已入账';tone='success';symbol='check';hint='本次服务时长已完成录入。';}
 else if(checked){label='签到已核验';tone='success';symbol='check';hint='到场记录已核验，服务时长等待录入。';}
 else if(record.attendanceSubmitted){label='签到待核验';tone='info';hint='签到照片已提交，等待负责人核验。';}
 else if(confirmed){label='报名成功';tone='success';symbol='check';hint='请按时到场，在活动时段内提交签到照片。';}
 if(record.eventStatus==='已结束'&&!checked&&!entered){label='活动已结束';tone='neutral';symbol='calendar';hint='活动已结束，可查看报名与签到处理记录。';}
 if(record.eventStatus==='停点'){label='班次已停点';tone='warning';symbol='info';hint='请查看停点说明，联系负责人确认后续安排。';}
 if(record.status==='已请假'){label='已请假';tone='neutral';symbol='calendar';hint='请假已处理，可查看本次报名记录。';}
 else if(record.leaveStatus){hint=`请假${record.leaveStatus}，请关注负责人处理结果。`;}
 const completed=[true,confirmed,checked,entered];
 const current=stopped||entered?-1:completed.findIndex(done=>!done);
 return {label,tone,symbol,hint,steps:['提交审核','报名确认','签到核验','时长入账'].map((text,index)=>({text,done:completed[index],current:index===current}))};
}
