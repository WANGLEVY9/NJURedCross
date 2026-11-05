import {canonicalCertificate,CERTIFICATE_OPTIONS} from '../../public/app/shared/certificates.js';
import {PROFILE_TABLE,withProfileMutation} from './volunteer-profile.js';
import {readProfileCandidates} from './profile-query.js';

/** Only an explicit One Plus first-aid course with final approved hours qualifies. */
export function isApprovedOnePlusTraining(source){
 return String(source.key||'').startsWith('FINAL:')&&source.totalHours>0&&/一加.{0,12}急救|急救.{0,12}一加/.test(source.activityName||'');
}
const fail=()=>Object.assign(Error('一加培训急救资质更新待重试，请核对个人主页身份和急救证列选项'),{code:'qualification_sync_pending'});
/** Uses the existing source column. Never creates people, changes schema or grants a certificate. */
export function upgradeTrainingQualification(base,source){
 return withProfileMutation(async()=>{
  if(!isApprovedOnePlusTraining(source))return {status:'not_applicable'};
  const rows=await readProfileCandidates(base,source.studentId);
  if(rows.length!==1||String(rows[0]['姓名']||'').trim()!==source.name)throw fail();
  const row=rows[0],current=canonicalCertificate(row['急救证']);
  if(current!==CERTIFICATE_OPTIONS[2])return {status:'unchanged'};
  const column=(await base.getMetadata()).tables?.find(table=>table.name===PROFILE_TABLE)?.columns?.find(column=>column.name==='急救证');
  if(!column||!['text','single-select'].includes(column.type))throw fail();
  const value=column.type==='single-select'?(column.data?.options||[]).find(option=>canonicalCertificate(option.name)===CERTIFICATE_OPTIONS[3])?.name:CERTIFICATE_OPTIONS[3];
  if(!value)throw fail();
  // Re-read after metadata I/O so a newly recorded higher qualification is retained.
  const latest=await readProfileCandidates(base,source.studentId);
  if(latest.length!==1||latest[0]._id!==row._id||String(latest[0]['姓名']||'').trim()!==source.name)throw fail();
  if(canonicalCertificate(latest[0]['急救证'])!==CERTIFICATE_OPTIONS[2])return {status:'unchanged'};
  await base.updateRow(PROFILE_TABLE,row._id,{'急救证':value});
  return {status:'updated',value};
 });
}
