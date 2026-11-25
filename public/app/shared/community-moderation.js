export const MODERATION_STATES = Object.freeze({
 submission:Object.freeze({pending:'待审核',accepted:'已通过',changes:'需修改',rejected:'已拒绝'}),
 report:Object.freeze({pending:'待处理',accepted:'已处理',rejected:'已驳回'}),
});

export function moderationPhase(source,status){
 return Object.entries(MODERATION_STATES[source]||{}).find(([,label])=>label===status)?.[0]||null;
}

export function moderationDecision(source,status,decision){
 const phase=moderationPhase(source,status);
 const next=source==='submission'
  ?(phase==='pending'?{approve:'accepted',return:'changes',reject:'rejected'}[decision]:phase==='rejected'&&decision==='reopen'?'pending':null)
  :source==='report'&&phase?{handle:'accepted',dismiss:'rejected'}[decision]:null;
 return next?MODERATION_STATES[source][next]:null;
}

export function hasBlockingCommunityReports(reports){
 return reports.some(report=>moderationPhase('report',report.status)!=='rejected');
}
