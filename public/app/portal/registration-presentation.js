// Presentation only: permissions and mutation eligibility remain server-owned.
export function registrationPresentation(record) {
 const confirmed=['已确认','已签到'].includes(record.status);
 const checked=record.status==='已签到'||record.hours?.attendanceConfirmed===true;
 const entered=record.hours?record.hours.summarySynced===true:record.entryStatus==='网站已入账';
 const stopped=record.result==='报名失败'||record.eventStatus==='停点'||record.eventStatus==='已结束'||['待审批','已批准'].includes(record.leaveStatus)||record.status==='已请假';
 let label='待审核',tone='warning',symbol='clock',hint='报名待审核。';
 if(record.result==='报名失败'){label='报名未通过';tone='danger';symbol='info';hint='报名未通过。';}
 else if(entered){label='时长已入账';tone='success';symbol='check';hint='时长已入账。';}
 else if(checked){label='签到已核验';tone='success';symbol='check';hint='签到已核验。';}
 else if(record.attendanceSubmitted){label='签到待核验';tone='info';hint='签到待核验。';}
 else if(confirmed){label='报名成功';tone='success';symbol='check';hint='报名成功。';}
 if(record.blood&&record.attendanceOpen&&confirmed&&!record.attendanceSubmitted&&!checked){label='待补签到';tone='warning';symbol='camera';hint='结束后仍可补传签到凭证。';}
 if(record.eventStatus==='已结束'&&!record.attendanceOpen&&!checked&&!entered){label='活动已结束';tone='neutral';symbol='calendar';hint='活动已结束。';}
 if(record.eventStatus==='停点'){label='班次已停点';tone='warning';symbol='info';hint='班次已停点。';}
 if(record.status==='已请假'){label='已请假';tone='neutral';symbol='calendar';hint='已请假。';}
 else if(record.leaveStatus){hint=`请假${record.leaveStatus}。`;}
 if(record.hours&&(record.hours.hours||record.hours.attendanceConfirmed||['conflict','rejected','initial_rejected','revision_pending'].includes(record.hours.code))){label=record.hours.label;tone=record.hours.tone;symbol=record.hours.profileSynced?'check':'clock';hint=record.hours.hours?`核定志愿时长 ${record.hours.hours.serviceHours} 小时；培训 ${record.hours.hours.trainingHours}、交通 ${record.hours.hours.travelHours} 另列。${record.hours.profileSynced?'个人主页已更新。':''}`:record.hours.label;}
 if(record.absence){label='未到场';tone='neutral';symbol='info';hint='未到场：'+record.absence;}
 const completed=[true,confirmed,checked,entered];
 const current=stopped||entered?-1:completed.findIndex(done=>!done);
 return {label,tone,symbol,hint,steps:['提交审核','报名确认',record.hours?.attendanceConfirmed?'到场确认':'签到核验','时长入账'].map((text,index)=>({text,done:completed[index],current:index===current}))};
}
