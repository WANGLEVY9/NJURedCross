import {createHash} from 'node:crypto';
import {isRunningLedgerRow,isFinalLedgerRow,finalLedgerEntries} from './running-review.js';
import {workflowConfig} from './blood-roster.js';
import {readHoursConfig} from './hours-config-state.js';

export const hoursPostingHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const hoursPersonKey=(name,studentId)=>JSON.stringify([String(name||'').trim(),String(studentId||'').trim()]);
export const hoursActivityNames=value=>[...new Set(String(value||'').split(/[、；;\n]/).map(s=>s.trim()).filter(Boolean))];
export const roundHours=value=>Number(value.toFixed(6));
const invalid=message=>Object.assign(Error(message),{code:'hours_source_conflict',statusCode:409});

/** Approved FINAL and SERVICE sources only; RUNNING is never counted. */
export function approvedHoursSources(data,{stateStore,onIssue}={}){
 const events=new Map(data.events.map(row=>[row['活动ID'],row])),byId=new Map(data.events.map(row=>[row._id,row]));
 const registrations=new Map(data.registrations.map(row=>[row._id,row]));
 if(events.size!==data.events.length||registrations.size!==data.registrations.length)throw invalid('活动或报名标识重复，请先核对');
 const blocked=new Set();
 const issue=(error,person)=>{if(!onIssue)throw error;const personKey=hoursPersonKey(person?.['姓名']||person?.name,person?.['学号']||person?.studentId);blocked.add(personKey);onIssue({personKey,message:error.code==='hours_source_conflict'?error.message:'时长来源暂时无法核对'});};
 const archived=[];
 // Older releases froze final rows in the activity configuration. Read that
 // archive without rewriting its settings or fabricating online attendance.
 for(const event of data.events){
  const c=workflowConfig(event);if(c.parentActivityId||c.finalHours?.status!=='exported'||!['已结束','已归档'].includes(event['状态']))continue;
  const resolved=readHoursConfig(event,stateStore),final=resolved.finalHours;
  for(const row of final.rows||[]){
   try{
   if(row.decision!=='pass'||data.ledger.some(line=>line['报名行ID']===row.id&&isFinalLedgerRow(line)))continue;
   const reg=registrations.get(row.id);if(!reg)throw invalid('历史最终表缺少原报名，需核对');
   const job=events.get(reg['活动ID']);if(!job||job!==event&&workflowConfig(job).parentActivityId!==event['活动ID']&&workflowConfig(job).parentActivityId!==event._id)throw invalid('历史最终表的活动归属不一致');
   if(row.name&&row.name!==reg['姓名']||row.studentId&&row.studentId!==reg['学号']||(row.memberIds||[]).length>1)throw invalid('历史最终表的合并人员需核对');
   archived.push({报名行ID:reg._id,活动ID:reg['活动ID'],账号ID:reg['账号ID'],姓名:reg['姓名'],学号:reg['学号'],幂等键:`FINAL:${reg._id}`,状态:'已批准',服务时长:row.serviceHours,培训时长:row.trainingHours,交通时长:row.travelHours,批准人:final.exportedBy,批准时间:final.exportedAt,来源摘要:resolved.runningReview?.sourceDigest,正式工作日期:row.dates,备注:JSON.stringify({v:2,d:'pass'}),archivedConfig:true});
   }catch(error){issue(error,registrations.get(row.id)||row);}
  }
 }
 const candidates=[...data.ledger,...archived].filter(row=>!isRunningLedgerRow(row)&&['已批准','已入账'].includes(row['状态']));
 const finals=new Set(candidates.filter(isFinalLedgerRow).map(row=>row['报名行ID'])),seen=new Set(),result=[];
 for(const line of candidates){
  try{
  if(!isFinalLedgerRow(line)&&finals.has(line['报名行ID']))continue;
  const reg=registrations.get(line['报名行ID']),event=events.get(line['活动ID']);if(!reg||!event)throw invalid('已批准时长缺少原报名或活动');
  if(['姓名','学号','账号ID','活动ID'].some(key=>!reg[key]||reg[key]!==line[key]))throw invalid('已批准时长的人员身份不一致');
  if(!line['批准人']||!Number.isFinite(Date.parse(line['批准时间']))||!line['来源摘要'])throw invalid('已批准时长缺少完整批准依据');
  if(seen.has(reg._id))throw invalid('同一报名存在重复有效时长');seen.add(reg._id);
  const config=workflowConfig(event),root=config.parentActivityId?(events.get(config.parentActivityId)||byId.get(config.parentActivityId)):event;
  if(!root)throw invalid('时长明细所属主活动缺失');
  let exportToken='';
  if(isFinalLedgerRow(line)){
   const c=root&&readHoursConfig(root,stateStore);
   if(!root||c.finalHours?.status!=='exported'||!['已结束','已归档'].includes(root['状态']))continue;
   if(finalLedgerEntries({ledger:[line]})[0]?.decision!=='pass')continue;
   exportToken=c.finalHours.token;
  }else if(!String(line['幂等键']||'').startsWith('SERVICE:'))throw invalid('时长来源类型无法核对');
  const values=['服务时长','培训时长','交通时长'].map(key=>{const value=line[key];if(value==null||value===''||!Number.isFinite(Number(value))||Number(value)<0||Number(value)>100000)throw invalid('已批准时长数值无效');return Number(value);});
  const [serviceHours,trainingHours,travelHours]=values,totalHours=roundHours(values.reduce((a,b)=>a+b,0));
  if(!totalHours)continue;
  const source={key:String(line['幂等键']),ledgerId:line._id||null,archive:line.archivedConfig===true,registrationId:reg._id,eventId:root?._id||event._id,activityId:line['活动ID'],accountId:reg['账号ID'],name:reg['姓名'],studentId:String(reg['学号']),activityName:root?.['活动名称']||event['活动名称'],dates:line['正式工作日期']||reg['报名日期']||'',serviceHours,trainingHours,travelHours,totalHours,creditHours:totalHours,approvedAt:line['批准时间'],approvedBy:line['批准人'],sourceDigest:line['来源摘要'],exportToken};
  source.personKey=hoursPersonKey(source.name,source.studentId);
  // Renaming an activity is an information edit, not a second contribution.
  const approvedSource={...source};delete approvedSource.activityName;source.version=hoursPostingHash(approvedSource);result.push(source);
  }catch(error){issue(error,registrations.get(line['报名行ID'])||line);}
 }
 return result.filter(source=>!blocked.has(source.personKey)).sort((a,b)=>a.key.localeCompare(b.key));
}
