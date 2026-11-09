import {needsHoursPostingReview} from './hours-posting.js';
import {isRunningLedgerRow,isFinalLedgerRow,finalLedgerEntries,runningLedgerEntries} from './running-review.js';

const number=value=>value!==''&&value!=null&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
const pending=(code,label,extra={})=>({code,label,tone:'info',summarySynced:false,profileSynced:false,...extra});

/** A private per-registration projection shared by member and management APIs.
 * Initial review is never an approved contribution. Official profile totals
 * stay separate from confirmed hours waiting for the weekly profile update.
 */
export function registrationHoursProgress(registration,ledger,receipt){
 const rows=ledger.filter(row=>row['报名行ID']===registration._id);
 if(rows.some(row=>['账号ID','学号','姓名','活动ID'].some(key=>row[key]!==registration[key])))return pending('conflict','时长记录需核对',{tone:'warning'});
 const finals=rows.filter(isFinalLedgerRow),service=rows.filter(row=>!isRunningLedgerRow(row)&&!isFinalLedgerRow(row));
 const applicable=finals.length?finals:service;
 if(applicable.length>1)return pending('conflict','时长记录需核对',{tone:'warning'});
 const final=applicable[0];
 if(final){
  if(receipt?.source&&(['key','registrationId','sourceDigest','approvedAt'].some((key,index)=>receipt.source[key]!==final[['幂等键','报名行ID','来源摘要','批准时间'][index]])||['serviceHours','trainingHours','travelHours'].some((key,index)=>Number(receipt.source[key])!==Number(final[['服务时长','培训时长','交通时长'][index]]))))return receipt.revisionAccepted?pending('revision_pending','超管已确认修订 · 同步中'):pending('conflict','已入账明细变化，需超管核对',{tone:'warning'});
  const detail=finals.length?finalLedgerEntries({ledger:[final]})[0]:null;
  if(final['状态']==='已退回'||detail?.decision==='fail')return pending('rejected','时长审核未通过',{tone:'warning',reason:String(final['退回原因']||'')});
  if(!['已批准','已入账'].includes(final['状态'])||detail&&detail.decision!=='pass')return pending('final_review','主席团终审中');
  const values=['服务时长','培训时长','交通时长'].map(key=>number(final[key]));
  if(values.some(value=>value===null))return pending('conflict','时长记录需核对',{tone:'warning'});
  const [serviceHours,trainingHours,travelHours]=values,hours={serviceHours,trainingHours,travelHours,totalHours:values.reduce((a,b)=>a+b,0)};
  const approved={hours,attendanceConfirmed:true,approvedAt:final['批准时间']||''};
  if(!hours.totalHours)return pending('zero','核定时长为零',approved);
  const summarySynced=receipt?.websiteStatus==='done'&&receipt?.legacyStatus==='done';
  if(!summarySynced){
   const failed=receipt?.websiteStatus==='failed'||receipt?.legacyStatus==='failed';
   // 带上失败原因与明细键：终审时长页面据此说明「为什么没录入」，并可逐条确认入账。
   return pending(failed?'summary_failed':'summary_pending',failed?'汇总表同步待重试':'已核定 · 等待写入汇总表',
     {...approved,needsPostingReview:needsHoursPostingReview(receipt),sourceKey:String(receipt?.key||''),reason:failed?String(receipt?.error||''):''});
  }
  return {...pending('summary_done','已写入汇总表 · 个人主页由 NJUTable 更新',approved),summarySynced:true,tone:'success',profileSyncMode:'table_automation'};
 }
 const initial=runningLedgerEntries({ledger:rows});
 if(initial.length>1)return pending('conflict','时长记录需核对',{tone:'warning'});
 if(initial[0]?.decision==='fail')return pending('initial_rejected','负责人初审未通过',{tone:'warning',reason:initial[0].reason});
 if(initial[0]?.decision==='pass')return pending('final_review','待主席团终审',{attendanceConfirmed:true});
 return pending('initial_review','待负责人确认');
}
