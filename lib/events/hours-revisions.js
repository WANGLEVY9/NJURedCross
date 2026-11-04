import {hoursPostingHash,roundHours} from './hours-posting-source.js';

const fail=message=>Object.assign(Error(message),{code:'hours_posting_conflict',statusCode:409});
const identity=['key','personKey','accountId','registrationId','activityId','eventId','sourceDigest','exportToken'];
const snapshot=row=>row?{id:row._id,hours:row['志愿时长'],activities:row['活动名称'],ids:row['活动ID']}:null;

/** A confirmed correction is a durable delta, not a second posting. */
export function createHoursRevisions({store,findLegacy,writeLegacy,mark,onRevision=async()=>{},now=()=>Date.now()}){
 function pending(source){const item=store.get('revision',source.key);return item?.status==='accepted'&&item.after.version===source.version?item:null;}
 function oldCredit(saved){
  if(saved.legacyStatus!=='done')return 0;
  if(Number.isFinite(saved.legacyCreditHours))return saved.legacyCreditHours;
  const intent=store.get('intent',`legacy:${saved.source.personKey}`);
  if(intent?.status==='done'&&intent.complete?.some(s=>s.key===saved.key)){
   const delta=roundHours(Number(intent.after['志愿时长'])-Number(intent.before?.['志愿时长']||0));
   for(const key of ['serviceHours','totalHours'])if(delta===roundHours(intent.complete.reduce((n,s)=>n+s[key],0)))return saved.source[key];
  }
  return null;
 }
 async function preview(source){
  const accepted=store.get('revision',source.key);if(accepted?.status==='accepted'&&accepted.after.version!==source.version)throw fail('已确认修订执行期间底表再次变化，请先核对并恢复已确认版本');
  if(accepted?.status==='accepted'&&store.get('intent',`legacy:revision:${accepted.token}`)?.status==='pending')throw fail('上次修订写入结果尚未确定，请先核对已确认的目标结果');
  const saved=store.get('receipt',source.key);
  if(!saved||saved.version===source.version&&(oldCredit(saved)===null||oldCredit(saved)===source.serviceHours))throw fail('该明细没有待确认的入账修订');
  if(identity.some(key=>saved.source[key]!==source[key]))throw fail('人员、活动或审批依据已改变，不能直接修订时长');
  if(['serviceHours','trainingHours','travelHours'].some(key=>!Number.isFinite(source[key])||source[key]<0||source[key]>100000))throw fail('修订时长数值无效');
  for(const [kind,id]of [['legacy',source.personKey],['website',source.accountId]]){const intent=store.get('intent',`${kind}:${id}`);if(intent&&intent.status!=='done')throw fail('存在未确定的写入，请先核对原同步结果');}
  const row=await findLegacy(source);if(!row&&saved.legacyStatus==='done')throw fail('原入账汇总记录缺失，不能直接修订');
  const previousCreditedHours=oldCredit(saved),legacySnapshot=snapshot(row),legacyHours=row?Number(row['志愿时长']||0):0;
  if(!Number.isFinite(legacyHours)||legacyHours<0)throw fail('原汇总时长无效，请先核对底表');
  const result={key:source.key,name:source.name,studentId:source.studentId,activityName:source.activityName,
   before:{serviceHours:saved.source.serviceHours,trainingHours:saved.source.trainingHours,travelHours:saved.source.travelHours},
   after:{serviceHours:source.serviceHours,trainingHours:source.trainingHours,travelHours:source.travelHours},
   previousCreditedHours,legacyHours,delta:previousCreditedHours===null?null:roundHours(source.serviceHours-previousCreditedHours)};
  return {...result,token:hoursPostingHash([result,saved.version,source.version,legacySnapshot]),legacySnapshot};
 }
 async function accept(source,body,actor){
  const previous=store.get('revision',source.key);
  if(previous?.token===body.token&&previous.after.version===source.version)return {accepted:true};
  const check=await preview(source);
  if(check.token!==body.token)throw fail('核对期间底表或时长已变化，请重新预览修订');
  const reason=String(body.reason||'').trim();if(!actor||!reason||reason.length>500)throw fail('请填写不超过 500 字的修订原因');
  const credited=check.previousCreditedHours===null?Number(body.previousCreditedHours):check.previousCreditedHours;
  if(!Number.isFinite(credited)||credited<0||credited>100000||check.previousCreditedHours===null&&(!['number','string'].includes(typeof body.previousCreditedHours)||!String(body.previousCreditedHours).trim()))throw fail('请先核对并填写原实际入账时长');
  const target=roundHours(check.legacyHours+source.serviceHours-credited);if(target<0)throw fail('修订后的汇总小于零，请核对原入账值');
  const saved=store.get('receipt',source.key);
  store.set('revision',source.key,{key:source.key,token:body.token,status:'accepted',before:saved.source,after:source,previousCreditedHours:credited,target,legacySnapshot:check.legacySnapshot,actor,reason,confirmedAt:new Date(now()).toISOString()});
  return {accepted:true};
 }
 async function recover(source){
  const item=pending(source);if(!item)return;
  const id=`revision:${item.token}`,intent=store.get('intent',`legacy:${id}`);
  await onRevision(source,item);
  if(intent?.status!=='done')await writeLegacy(id,source,row=>{
   if(hoursPostingHash(snapshot(row))!==hoursPostingHash(item.legacySnapshot))throw fail('确认后原汇总表发生变化，修订暂停，请重新核对');
   return {...(!row?{姓名:source.name,学号:source.studentId,活动名称:source.activityName,活动ID:source.eventId||source.activityId}:{}),志愿时长:item.target};
  });
  mark(source,{legacyStatus:'done',legacyCreditHours:source.serviceHours,websiteStatus:'pending',profileStatus:'pending',postingStatus:'pending',forceProfile:true,revisedAt:item.confirmedAt,error:''});
  const done={...item,status:'done',finishedAt:new Date(now()).toISOString()};
  store.set('revision-history',`${source.key}:${item.token}`,done);store.set('revision',source.key,done);
 }
 const requiresConfirmation=source=>{const saved=store.get('receipt',source.key);return Boolean(saved&&(saved.version!==source.version||saved.legacyStatus==='done'&&oldCredit(saved)!==null&&oldCredit(saved)!==source.serviceHours));};
 return {preview,accept,recover,pending,requiresConfirmation,oldCredit,history:()=>store.all('revision-history')};
}
