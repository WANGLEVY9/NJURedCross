import {ACADEMIC_YEAR_COLUMN,inAcademicYear} from './hours-academic-year.js';
import {hoursPostingHash,roundHours} from './hours-posting-source.js';

const fail=message=>Object.assign(Error(message),{code:'hours_posting_conflict',statusCode:409});
const yearValue=row=>{const value=row?.[ACADEMIC_YEAR_COLUMN];if(value==null||value==='')return 0;const number=Number(value);if(!Number.isFinite(number)||number<0)throw fail('原学年时长无效，请先核对底表');return number;};

/** Keep external year adjustments separate from the site's own contribution. */
export function createHoursYearBalance({store,findProfile,writeProfile,mark,now=()=>Date.now()}){
 const entries=person=>store.all('receipt').filter(r=>r.source.personKey===person.personKey&&r.legacyStatus==='done'&&r.websiteStatus==='done'&&inAcademicYear(r.source.dates,r.source.approvedAt));
 function previousSite(person,row){
  const intent=store.get('intent',`profile:${person.personKey}`);
  const base=store.get('year-base',person.personKey);
  if(base?.priorIntentFingerprint===hoursPostingHash(intent||null))return base.includedHours;
  if(intent?.status==='done'&&Object.hasOwn(intent.after,ACADEMIC_YEAR_COLUMN))return typeof intent.complete?.siteHours==='number'?intent.complete.siteHours:Number(intent.after[ACADEMIC_YEAR_COLUMN]);
  if(base)return base.includedHours;
  return yearValue(row)===0?0:null;
 }
 async function sync(person,siteHours,sources){
  const row=await findProfile(person),before=yearValue(row),oldSite=previousSite(person,row);
  if(oldSite===null)throw fail('原26–27学年列已有时长，请超管先核对学年基数，避免覆盖历史或重复累计');
  const baseline=roundHours(before-oldSite);if(baseline<0)throw fail('学年列小于原本站入账，请超管核对学年基数');
  await writeProfile(person,current=>{
   if(yearValue(current)!==before||current?._id!==row?._id)throw fail('学年底表已更新，请重新核对后同步');
   return {...(!current?{姓名:person.name,学号:person.studentId}:{}),...(!String(current?.['部门']||'').trim()?{部门:'志愿者'}:{}),[ACADEMIC_YEAR_COLUMN]:roundHours(baseline+siteHours)};
  },{sources,siteHours,baseline});
  store.set('year-balance',person.personKey,{siteHours,baseline,at:new Date(now()).toISOString()});
 }
 async function preview(person){
  const row=await findProfile(person),records=entries(person),siteHours=roundHours(records.reduce((n,r)=>n+r.source.serviceHours,0));
  const result={key:person.key,name:person.name,studentId:person.studentId,yearHours:yearValue(row),siteHours,records:records.map(r=>({key:r.key,name:r.source.activityName,serviceHours:r.source.serviceHours,dates:r.source.dates}))};
  return {...result,token:hoursPostingHash([result,row?._id,records.map(r=>r.version)])};
 }
 async function accept(person,body,actor){
  const check=await preview(person);if(body.token!==check.token)throw fail('核对期间学年值或入账明细已变化，请重新核对');
  const included=Number(body.includedHours),reason=String(body.reason||'').trim();
  if(!['number','string'].includes(typeof body.includedHours)||!String(body.includedHours).trim()||!Number.isFinite(included)||included<0||included>check.siteHours||included>check.yearHours||!actor||!reason||reason.length>500)throw fail('请填写有效的已包含本站时长和核对原因');
  // Supersede only the comparison checkpoint, never the original audit intent.
  const prior=store.get('intent',`profile:${person.personKey}`);if(prior&&prior.status!=='done')throw fail('存在未确定的主页写入，请先核对结果');
  const record={includedHours:included,actor,reason,confirmedAt:new Date(now()).toISOString(),token:check.token,priorIntentFingerprint:hoursPostingHash(prior||null)};
  store.set('year-base',person.personKey,record);store.set('year-base-history',`${person.personKey}:${check.token}`,record);
  for(const entry of entries(person))mark(entry.source,{forceProfile:true,profileStatus:'pending'});
  return {accepted:true};
 }
 return {sync,preview,accept};
}
