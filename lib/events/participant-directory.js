/** Read-only enrichment; never calls the profile synchronizer (which can write). */
export async function participantDirectory(accounts, registrations, base) {
  const ids=new Set(registrations.map(r=>r['账号ID']));
  const result=accounts.filter(a=>ids.has(a.accountId)).map(a=>({...a}));
  const table=(await base.getMetadata()).tables.find(t=>t.name==='个人主页（编辑版）');
  if(!table)return result;
  const columns=new Set(table.columns.map(c=>c.name));
  if(!columns.has('学号')||!columns.has('姓名'))return result;
  const selected=['学号','姓名','急救证','红会核心成员'].filter(c=>columns.has(c));
  // Only explicit source values count as yes/no; department and membership codes are not evidence of core membership.
  const yesNo=value=>['是','有','true','yes','1'].includes(String(value).trim().toLowerCase())?'yes':['否','无','false','no','0'].includes(String(value).trim().toLowerCase())?'no':'unknown';
  for(const account of result){
    const sid=account.studentId||String(account.email||'').split('@')[0];
    if(!account.emailVerified||!/^\d{6,20}$/.test(sid)||!account.realName)continue;
    const rows=await base.query(`SELECT ${selected.map(c=>'`'+c+'`').join(',')} FROM \`个人主页（编辑版）\` WHERE \`学号\` = '${sid}' LIMIT 3`);
    if(!Array.isArray(rows)||rows.length!==1||String(rows[0]['学号']).trim()!==sid||String(rows[0]['姓名']).trim()!==account.realName)continue;
    account.certificate=String(rows[0]['急救证']||'');account.certificateStatus=yesNo(rows[0]['急救证']);account.coreMemberStatus=yesNo(rows[0]['红会核心成员']);
  }
  return result;
}
