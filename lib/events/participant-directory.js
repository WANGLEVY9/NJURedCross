/** Read-only enrichment; never calls the profile synchronizer (which can write). */
import {certificateStatus} from '../../public/app/shared/registration-profile.js';
const PROFILE_TABLE='个人主页（编辑版）';
/** 可参与"姓名＋学号"精确匹配的人：已验证邮箱、学号合规、有真实姓名。 */
function matchableStudentId(account){
  const sid=account.studentId||String(account.email||'').split('@')[0];
  return account.emailVerified&&/^\d{6,20}$/.test(sid)&&account.realName?sid:'';
}
/**
 * 逐人查询会把名单人数直接放大成同样多的往返；改为按学号 `IN (...)` 分批取回，
 * 再做同样的精确匹配。取不到的批次只是不补充，不影响名单本身。
 */
async function profilesByStudentId(base,ids,selected){
  const found=new Map();
  const unique=[...new Set(ids)];
  for(let start=0;start<unique.length;start+=50){
    const batch=unique.slice(start,start+50),list=batch.map(id=>`'${id}'`).join(',');
    // 查询异常按原行为向上抛出：没有资料证据就不补字段，但也不静默吞掉故障。
    const rows=await base.query(`SELECT ${selected.map(c=>'`'+c+'`').join(',')} FROM \`${PROFILE_TABLE}\` WHERE \`学号\` IN (${list}) LIMIT ${batch.length*10+10}`);
    if(!Array.isArray(rows)||rows.readMeta?.truncated)continue;
    for(const row of rows){
      if(!row||typeof row!=='object')continue;
      const key=String(row['学号']??'').trim();
      if(!key||!batch.includes(key))continue;
      const bucket=found.get(key);
      if(bucket)bucket.push(row);else found.set(key,[row]);
    }
  }
  return found;
}
export async function participantDirectory(accounts, registrations, base) {
  const ids=new Set(registrations.map(r=>r['账号ID']));
  const result=accounts.filter(a=>ids.has(a.accountId)).map(a=>({...a}));
  const table=(await base.getMetadata()).tables.find(t=>t.name===PROFILE_TABLE);
  if(!table)return result;
  const columns=new Set(table.columns.map(c=>c.name));
  if(!columns.has('学号')||!columns.has('姓名'))return result;
  const selected=['学号','姓名','部门','急救证','红会核心成员'].filter(c=>columns.has(c));
  // Only explicit source values count as yes/no; department and membership codes are not evidence of core membership.
  const yesNo=value=>['是','有','true','yes','1'].includes(String(value).trim().toLowerCase())?'yes':['否','无','false','no','0'].includes(String(value).trim().toLowerCase())?'no':'unknown';
  const wanted=result.map(matchableStudentId).filter(Boolean);
  const grouped=wanted.length&&typeof base.query==='function'?await profilesByStudentId(base,wanted,selected):new Map();
  for(const account of result){
    const sid=matchableStudentId(account);
    if(!sid)continue;
    const rows=grouped.get(sid)||[];
    if(rows.length!==1||String(rows[0]['学号']).trim()!==sid||String(rows[0]['姓名']).trim()!==account.realName)continue;
    account.organizationDepartment=String(rows[0]['部门']||'');
    account.certificate=String(rows[0]['急救证']||'');account.certificateStatus=certificateStatus(rows[0]['急救证']);account.coreMemberStatus=yesNo(rows[0]['红会核心成员']);
  }
  return result;
}
