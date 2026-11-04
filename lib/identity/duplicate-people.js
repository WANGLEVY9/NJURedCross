import {ACCOUNT_TABLE,listIdentityRows,findAccountByLogin} from './store.js';
import {PROFILE_TABLE} from './volunteer-profile.js';

export function duplicatePeople(accounts,profiles){
 const groups=new Map();
 for(const [source,rows]of [['账号表',accounts],['个人主页表',profiles]])for(const row of rows){
  const studentId=String(row['学号']||'').trim();if(!studentId)continue;
  if(!groups.has(studentId))groups.set(studentId,[]);
  groups.get(studentId).push({source,id:row._id,name:String(row[source==='账号表'?'真实姓名':'姓名']||'').trim()});
 }
 return [...groups].filter(([,rows])=>['账号表','个人主页表'].some(source=>rows.filter(row=>row.source===source).length>1)||new Set(rows.map(row=>row.name).filter(Boolean)).size>1).map(([studentId,rows])=>({studentId,identityConflict:new Set(rows.map(row=>row.name).filter(Boolean)).size>1,rows}));
}

export async function duplicatePeopleRoute(req,res,ctx){
 const session=ctx.requireSession(req,res);if(!session)return;
 const client=await ctx.getBase(),account=await findAccountByLogin(client,session.username);
 if(account?.role!=='super_admin'||account.status!=='启用'||!account.emailVerified)return ctx.json(res,403,{ok:false,message:'仅已验证的在用超管可以检测重复人员。'});
 const accounts=await listIdentityRows(client,ACCOUNT_TABLE);
 if(!ctx.getProfileBase)return ctx.json(res,503,{ok:false,message:'个人主页数据源未配置，检测未完成。'});
 const source=await ctx.getProfileBase();
 if(ctx.config?.profileBaseUuid&&source.dtableUuid!==ctx.config.profileBaseUuid)return ctx.json(res,503,{ok:false,message:'个人主页数据源不一致，检测未完成。'});
 const profiles=await listIdentityRows(source,PROFILE_TABLE),groups=duplicatePeople(accounts,profiles);
 return ctx.json(res,200,{ok:true,total:groups.length,groups:groups.slice(0,200),checkedAccounts:accounts.length,checkedProfiles:profiles.length});
}
