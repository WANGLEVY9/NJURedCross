/** Read-only eligibility shared by the personal view and the authoritative mutation. */
export function registrationLeavePolicy(event,row,{now=Date.now(),hasRecordedEvidence=false,reviewLocked=false}={}){
 const no=reason=>({allowed:false,autoApproved:false,reason});
 if(!event||!['报名中','进行中','停点'].includes(event['状态']))return no('活动已关闭，请联系负责人');
 if(!['待筛选','已确认'].includes(row['报名状态'])||row['请假状态']==='待审批')return no('当前报名不能申请请假');
 if(hasRecordedEvidence||reviewLocked||row['签到行ID'])return no('已有签到或审核记录，请联系负责人处理');
 let c;try{c=JSON.parse(event['报名页配置']||'{}');}catch{return no('活动配置需核对，请联系负责人');}
 if(c.rosterReview?.phase==='publishing')return no('名单正在提交');
 const autoApproved=row['报名状态']==='待筛选',window=c.window||c.ordinary||c.blood||{};
 if(autoApproved&&row['签到照片ID'])return no('已提交签到照片，请联系负责人处理');
 const deadline=Date.parse((autoApproved&&event['状态']==='进行中'?window.end:window.start)||`${event['报名日期']}T23:59:59+08:00`);
 if(!Number.isFinite(deadline)||now>=deadline)return no('活动已开始或日期已过，请联系负责人处理');
 return {allowed:true,autoApproved,reason:''};
}
