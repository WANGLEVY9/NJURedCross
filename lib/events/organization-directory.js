import {organizationAccess} from './organization-access.js';

const unavailable = () => Object.assign(new Error('暂时无法核验活动组织身份，请稍后重试'), {statusCode:503, code:'event_identity_unavailable'});

/** Exact, bounded account-to-profile joins; never writes a profile or account role. */
export async function organizationDirectory(accounts, base) {
  const ids = [...new Set(accounts.filter(a=>a.emailVerified===true && /^\d{6,20}$/.test(a.studentId||'')).map(a=>a.studentId))];
  const profiles = [];
  for(let offset=0;offset<ids.length;offset+=50){
    const batch=ids.slice(offset,offset+50), selected=batch.map(id=>`'${id}'`).join(',');
    let rows;
    try { rows=await base.query(`SELECT _id,学号,姓名,部门 FROM \`个人主页（编辑版）\` WHERE 学号 IN (${selected}) LIMIT 1000`); }
    catch { throw unavailable(); }
    if(!Array.isArray(rows)||rows.length>=1000||rows.readMeta?.truncated
      ||rows.some(row=>!row||!batch.includes(String(row['学号']||'').trim())))throw unavailable();
    profiles.push(...rows);
  }
  return accounts.map(account=>({...account, organization:organizationAccess(account,profiles,{complete:true})}));
}
