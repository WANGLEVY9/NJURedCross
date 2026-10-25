import {eventMailVariables} from '../mail/templates.js';
export function notificationPreflight(events,rows,accounts){
 const byId=new Map();for(const account of accounts){const id=account.accountId;if(!id)continue;byId.set(id,byId.has(id)?null:account);}
 return rows.map(row=>{
  const event=events.find(e=>e['活动ID']===row['活动ID']);const account=byId.get(row['账号ID']);
  const email=String(account?.email||'').trim();let reason='';
  if(!account)reason='未找到唯一关联账号，请核对资料';
  else if(account.emailVerified!==true)reason='账号邮箱尚未验证';
  else if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||/[\r\n]/.test(email))reason='邮箱缺失或格式无效';
  else if(account.status&&account.status!=='启用')reason='账号已停用';
  else if(!event)reason='所报岗位不存在';
  return {id:row._id,name:row['姓名']||'同学',email:reason?'':email,reason,information:event?eventMailVariables(event,row)['报名信息']:''};
 });
}
