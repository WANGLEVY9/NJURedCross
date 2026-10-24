/** Required booking identity only. Membership/permissions never derive from these fields. */
export function missingProfileFields(account={}){
 const missing=[],email=String(account.email||'').trim(),name=String(account.realName||'').trim();
 let studentId=String(account.studentId||'').trim();
 if(!studentId&&['platform_admin','super_admin'].includes(account.role)&&account.emailVerified===true)studentId=email.split('@')[0];
 if(!name)missing.push('真实姓名');
 if(!/^\d{6,20}$/.test(studentId))missing.push('学号');
 if(!/^\d{6,20}@(smail\.nju\.edu\.cn|nju\.edu\.cn)$/.test(email)||account.emailVerified!==true)missing.push('已验证校园邮箱');
 else if(studentId&&email.split('@')[0]!==studentId)missing.push('学号与校园邮箱一致性');
 if(!String(account.campus||'').trim())missing.push('校区');
 return missing;
}
