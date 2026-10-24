/** Required booking identity only. Membership/permissions never derive from these fields. */
export function missingProfileFields(account={}){
 const missing=[],email=String(account.email||'').trim(),name=String(account.realName||'').trim();
 let studentId=String(account.studentId||'').trim();
 if(!studentId&&['platform_admin','super_admin'].includes(account.role)&&account.emailVerified===true)studentId=email.split('@')[0];
 if(!name)missing.push('真实姓名');
 if(!/^\d{6,20}$/.test(studentId))missing.push('学号');
 if(!String(account.campus||'').trim())missing.push('校区');
 for(const [key,label] of [['department','院系'],['qq','QQ号'],['wechat','微信号'],['gender','性别'],['phone','手机号']]){
  const value=String(account[key]||'').trim();
  if(!value||(key==='qq'&&!/^\d{5,20}$/.test(value))||(key==='phone'&&!/^1\d{10}$/.test(value)))missing.push(label);
 }
 return missing;
}
