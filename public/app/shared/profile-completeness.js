import {canonicalCertificate} from './certificates.js';
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
 if(!canonicalCertificate(account.certificate))missing.push('急救证');
 return missing;
}


/** Distinguish contact-edit conflicts from identity matching failures. */
export function profileConflictMessage(mapping){
 const labels={phone:'手机号',department:'院系',grade:'年级',gender:'性别',campus:'校区',wechat:'微信',qq:'QQ',certificate:'急救证'};
 const fields=(mapping.conflictFields||[]).map(key=>labels[key]).filter(Boolean);
 return fields.length?'网站与志愿服务平台的'+fields.join('、')+'存在不同修改，请核对后保存。':'志愿资料暂未关联。';
}
