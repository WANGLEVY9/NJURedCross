import {normalizePermissions} from '../permissions.js';

/** Local account files only. Never infer authority from a display name alone. */
export function grantLocalDeveloperAccess(accounts,{account,expectedName}){
  if(!Array.isArray(accounts)||!account||!expectedName)throw Error('必须提供账号和核对姓名');
  const matches=accounts.filter(row=>[row.accountId,row.username,row.email].includes(account));
  if(matches.length!==1)throw Error('账号必须唯一匹配，不能只按姓名授权');
  const target=matches[0];
  if(![target.realName,target.name,target.label].includes(expectedName))throw Error('账号姓名核对失败');
  if(target.status&&target.status!=='启用')throw Error('不能为停用账号授权');
  if(target.emailVerified!==true)throw Error('账号邮箱尚未验证');
  const updated={...target,role:'super_admin',permissions:normalizePermissions(null,'super_admin')};
  return {
    accounts:accounts.map(row=>row===target?updated:row),
    account:updated,
    previousRole:target.role,
  };
}
